import { create } from 'zustand';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import type { CoreBox } from '../types/core-box';
import type { InboundOrder } from '../types/inbound-order';
import { checkAdmission, itemsOf, nextOrderNo } from '../utils/inbound';
import { useBoxStore } from './boxStore';
import { useLocationStore } from './locationStore';
import { useRunStore } from './runStore';

export interface ConfirmResult {
  outcome: 'stored' | 'queued' | 'failed';
  reason?: string;
  orderId: string;
}

interface InboundState {
  orders: InboundOrder[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /** 钻探班组提交入库申请（仅待入库箱可提交） */
  submitApplication: (locationId: string, boxIds: string[], applicant: string) => Promise<InboundOrder>;
  /** 班组撤回申请：整单回到待入库（仅待确认单） */
  withdrawApplication: (orderId: string) => Promise<void>;
  /** 库房管理员确认上架；容量到顶排队，深度不合整批失败退回 */
  confirmOrder: (orderId: string, keeper: string) => Promise<ConfirmResult>;
  /** 库房管理员把待确认申请整批退回（上了入库单的箱子由管理员退回） */
  rejectOrder: (orderId: string, keeper: string, reason: string) => Promise<void>;
  /** 已上架箱由库房管理员退回（箱子回待入库，入库单保留） */
  returnBox: (boxId: string, keeper: string) => Promise<void>;
  /** 该库位是否有排队（待确认且放不下）的单，等腾位后可重试 */
  queuedOrdersOf: (locationId: string) => InboundOrder[];
  refresh: () => Promise<void>;
}

async function persistBoxes(boxes: CoreBox[]): Promise<void> {
  await db.boxes.bulkPut(boxes);
  const byId = new Map(boxes.map((box) => [box.id, box]));
  useBoxStore.setState((state) => ({
    boxes: state.boxes.map((box) => byId.get(box.id) ?? box),
  }));
}

function snapshotBoxes(order: InboundOrder): CoreBox[] {
  const all = useBoxStore.getState().boxes;
  return order.items
    .map((item) => all.find((box) => box.id === item.boxId))
    .filter((box): box is CoreBox => Boolean(box));
}

/** 入库申请与上架确认 */
export const useInboundStore = create<InboundState>()((set, get) => ({
  orders: [],
  hydrated: false,

  hydrate: async () => {
    const orders = await db.inboundOrders.orderBy('submittedAt').reverse().toArray();
    set({ orders, hydrated: true });
  },

  refresh: async () => {
    const orders = await db.inboundOrders.orderBy('submittedAt').reverse().toArray();
    set({ orders });
  },

  submitApplication: async (locationId, boxIds, applicant) => {
    const location = useLocationStore.getState().locations.find((loc) => loc.id === locationId);
    if (!location) throw new Error('请选择库位');
    if (boxIds.length === 0) throw new Error('请先勾选要申请入库的箱子');

    const all = useBoxStore.getState().boxes;
    const batch = boxIds
      .map((id) => all.find((box) => box.id === id))
      .filter((box): box is CoreBox => Boolean(box));
    const illegal = batch.find((box) => box.status && box.status !== 'pending');
    if (illegal) throw new Error(`箱 ${illegal.boxNo} 不是待入库状态，不能重复提交`);

    const order: InboundOrder = {
      id: uid('inbound'),
      orderNo: nextOrderNo(useInboundStore.getState().orders.map((o) => o.orderNo)),
      locationId,
      applicant: applicant.trim() || '钻探班组',
      submittedAt: new Date().toISOString(),
      status: 'submitted',
      items: itemsOf(batch),
      gaps: [],
    };
    const nextBoxes = batch.map((box) => ({
      ...box,
      status: 'submitted' as const,
      inboundOrderId: order.id,
    }));

    await db.transaction('rw', db.inboundOrders, db.boxes, async () => {
      await db.inboundOrders.put(order);
      await db.boxes.bulkPut(nextBoxes);
    });
    await persistBoxes(nextBoxes);
    await get().refresh();
    return order;
  },

  withdrawApplication: async (orderId) => {
    const order = get().orders.find((o) => o.id === orderId);
    if (!order || order.status !== 'submitted') throw new Error('只有待确认的申请可以撤回');
    const all = useBoxStore.getState().boxes;
    const nextBoxes = order.items
      .map((item) => all.find((box) => box.id === item.boxId))
      .filter((box): box is CoreBox => box !== undefined && box.status === 'submitted' && box.inboundOrderId === orderId)
      .map((box) => ({ ...box, status: 'pending' as const, inboundOrderId: orderId }));

    await db.transaction('rw', db.inboundOrders, db.boxes, async () => {
      await db.inboundOrders.delete(orderId);
      await db.boxes.bulkPut(nextBoxes);
    });
    await persistBoxes(nextBoxes);
    await get().refresh();
  },

  confirmOrder: async (orderId, keeper) => {
    const order = get().orders.find((o) => o.id === orderId);
    if (!order) throw new Error('入库单不存在');
    if (order.status === 'stored') throw new Error('该单已上架');

    const location = useLocationStore.getState().locations.find((loc) => loc.id === order.locationId);
    if (!location) throw new Error('库位已不存在，无法确认');

    const all = useBoxStore.getState().boxes;
    const runs = useRunStore.getState().runs;

    // 重试只动挂起那批：按最新箱子刷新快照；已删除/状态不符的箱子直接判失败
    const batch = order.items
      .map((item) => all.find((box) => box.id === item.boxId))
      .filter((box): box is CoreBox => Boolean(box));
    const missing = order.items.filter((item) => !batch.some((box) => box.id === item.boxId));
    const badState = batch.filter((box) => box.status !== 'submitted' || box.inboundOrderId !== orderId);

    // 排队按提交先后：同库位更早挂起的申请箱先占位，本批不能插队
    const batchIds = new Set(batch.map((box) => box.id));
    const queuedAhead = get()
      .orders.filter(
        (o) =>
          o.id !== order.id &&
          o.status === 'submitted' &&
          o.locationId === order.locationId &&
          o.submittedAt < order.submittedAt,
      )
      .flatMap((o) => o.items.map((item) => all.find((box) => box.id === item.boxId)))
      .filter((box): box is CoreBox => box !== undefined && box.status === 'submitted' && !batchIds.has(box.id));

    let result: ConfirmResult;

    if (missing.length || badState.length) {
      const reasonParts: string[] = [];
      if (missing.length) reasonParts.push(`箱 ${missing.map((i) => i.boxNo).join('、')} 已不存在`);
      if (badState.length) reasonParts.push(`箱 ${badState.map((b) => b.boxNo).join('、')} 状态已变化`);
      result = { outcome: 'failed', reason: `这批退回待入库：${reasonParts.join('；')}`, orderId };
    } else {
      const admission = checkAdmission(location, batch, all, runs, queuedAhead);
      if (admission.ok) {
        result = { outcome: 'stored', orderId };
      } else if (admission.queued) {
        result = { outcome: 'queued', reason: admission.reason, orderId };
      } else {
        result = { outcome: 'failed', reason: admission.reason, orderId };
      }
    }

    const nowIso = new Date().toISOString();

    if (result.outcome === 'queued') {
      // 容量到顶：单子挂着排队，箱子保持已报待上架，已上架箱不动
      return result;
    }

    const nextOrder: InboundOrder =
      result.outcome === 'stored'
        ? {
            ...order,
            items: itemsOf(batch),
            status: 'stored',
            keeper: keeper.trim() || '库房管理员',
            confirmedAt: nowIso,
            failReason: undefined,
            gaps: checkAdmission(location, batch, all, runs, queuedAhead).gaps,
          }
        : {
            ...order,
            items: itemsOf(batch),
            status: 'failed',
            confirmedAt: nowIso,
            failReason: result.reason,
          };

    const nextBoxes: CoreBox[] =
      result.outcome === 'stored'
        ? batch.map((box) => ({
            ...box,
            status: 'stored' as const,
            locationId: location.id,
            shelfPos: location.shelfPos,
            inboundOrderId: order.id,
          }))
        : // 确认失败：这批退回待入库，上架的留着
          batch.map((box) => ({
            ...box,
            status: 'pending' as const,
            locationId: '',
            inboundOrderId: order.id,
          }));

    await db.transaction('rw', db.inboundOrders, db.boxes, async () => {
      await db.inboundOrders.put(nextOrder);
      await db.boxes.bulkPut(nextBoxes);
    });
    await persistBoxes(nextBoxes);
    await get().refresh();
    return result;
  },

  rejectOrder: async (orderId, keeper, reason) => {
    const order = get().orders.find((o) => o.id === orderId);
    if (!order) throw new Error('入库单不存在');
    if (order.status !== 'submitted') throw new Error('只有待确认的申请可以退回');
    if (!reason.trim()) throw new Error('请填写退回原因');

    const all = useBoxStore.getState().boxes;
    const nextBoxes: CoreBox[] = order.items
      .map((item) => all.find((box) => box.id === item.boxId))
      .filter((box): box is CoreBox => box !== undefined && box.status === 'submitted' && box.inboundOrderId === orderId)
      .map((box) => ({ ...box, status: 'pending' as const, locationId: '', inboundOrderId: orderId }));
    const nextOrder: InboundOrder = {
      ...order,
      status: 'failed',
      confirmedAt: new Date().toISOString(),
      keeper: keeper.trim() || '库房管理员',
      failReason: `库房管理员退回：${reason.trim()}`,
    };

    await db.transaction('rw', db.inboundOrders, db.boxes, async () => {
      await db.inboundOrders.put(nextOrder);
      await db.boxes.bulkPut(nextBoxes);
    });
    await persistBoxes(nextBoxes);
    await get().refresh();
  },

  returnBox: async (boxId, keeper) => {
    const all = useBoxStore.getState().boxes;
    const box = all.find((b) => b.id === boxId);
    if (!box) throw new Error('箱子不存在');
    if (box.status !== 'stored') throw new Error('只有已上架的箱子可以退回');
    if (!keeper.trim()) throw new Error('请填写退回收尾的库房管理员');

    // 退回后该位置空出：重算该库位历史断档（剩余已上架箱连着排）
    const nextBox: CoreBox = { ...box, status: 'pending', locationId: '' };
    await db.boxes.put(nextBox);
    await persistBoxes([nextBox]);
    await get().refresh();
  },

  queuedOrdersOf: (locationId) => {
    const all = useBoxStore.getState().boxes;
    const locations = useLocationStore.getState().locations;
    const location = locations.find((loc) => loc.id === locationId);
    if (!location) return [];
    const runs = useRunStore.getState().runs;
    const allOrders = get().orders;
    return allOrders.filter((order) => {
      if (order.status !== 'submitted' || order.locationId !== locationId) return false;
      const batchIds = new Set(order.items.map((item) => item.boxId));
      const queuedAhead = allOrders
        .filter((o) => o.id !== order.id && o.status === 'submitted' && o.locationId === locationId && o.submittedAt < order.submittedAt)
        .flatMap((o) => o.items.map((item) => all.find((box) => box.id === item.boxId)))
        .filter((box): box is CoreBox => box !== undefined && box.status === 'submitted' && !batchIds.has(box.id));
      const batch = snapshotBoxes(order);
      const admission = checkAdmission(location, batch, all, runs, queuedAhead);
      return admission.queued;
    });
  },
}));
