import { create } from 'zustand';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import type { CoreBox } from '../types/core-box';
import type { DrillRun } from '../types/drill-run';
import type { IntakeApplication, IntakeItem, IntakeReceipt } from '../types/intake';
import { allocateBox, assignLayout } from '../utils/warehouse';
import type { LocationGap } from '../types/storage-location';
import { useBoxStore } from './boxStore';

export class IntakeError extends Error {}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

export interface ConfirmSummary {
  /** 入库单；全部确认失败时为空（整批已退回待入库，已上架箱保留） */
  receipt: IntakeReceipt | null;
  storedCount: number;
  waitingCount: number;
  retried: boolean;
  /** 全部失败时的首条原因 */
  failReason?: string;
}

interface IntakeState {
  applications: IntakeApplication[];
  receipts: IntakeReceipt[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /** 钻探班组提交入库申请（仅待入库箱） */
  submitApplication: (boxIds: string[], applicant: string) => Promise<IntakeApplication>;
  /** 库房管理员按容量和深度确认上架；重试只动挂起那批，已上架的留着 */
  confirmApplication: (applicationId: string, keeper: string) => Promise<ConfirmSummary>;
  /** 整批退回：未上架的回待入库（已上架的留着，需逐箱退回） */
  rejectApplication: (applicationId: string, note: string) => Promise<void>;
  /** 库房管理员退回一只已上架箱 */
  returnStoredBox: (boxId: string, keeper: string, note: string) => Promise<void>;
  /** 库房管理员整单退回（入库单上仍上架的全部退回） */
  returnReceipt: (receiptId: string, keeper: string, note: string) => Promise<void>;
}

/** 入库申请与入库单 */
export const useIntakeStore = create<IntakeState>()((set, get) => ({
  applications: [],
  receipts: [],
  hydrated: false,

  hydrate: async () => {
    const [applications, receipts] = await Promise.all([
      db.applications.orderBy('appliedAt').reverse().toArray(),
      db.receipts.orderBy('confirmedAt').reverse().toArray(),
    ]);
    set({ applications, receipts, hydrated: true });
  },

  submitApplication: async (boxIds, applicant) => {
    if (!boxIds.length) throw new IntakeError('请先勾选要申请入库的岩芯箱');
    const trimmedApplicant = applicant.trim();
    if (!trimmedApplicant) throw new IntakeError('请填写申请人');

    const boxes = await db.boxes.bulkGet(boxIds);
    const present = boxes.filter((b): b is CoreBox => Boolean(b));
    if (present.length !== boxIds.length) throw new IntakeError('部分箱子已不存在，请刷新后重试');
    const locked = present.filter((b) => (b.storageStatus ?? 'pending') !== 'pending');
    if (locked.length) {
      throw new IntakeError(`箱子 ${locked.map((b) => b.boxNo).join('、')} 已在入库流程中，不能重复申请`);
    }
    const holeIds = new Set(present.map((b) => b.holeId));
    if (holeIds.size > 1) throw new IntakeError('同一入库申请只能选择同一钻孔的箱子');

    const appCount = await db.applications.count();
    const application: IntakeApplication = {
      id: uid('app'),
      appNo: `SQ-${todayStamp()}-${String(appCount + 1).padStart(3, '0')}`,
      holeId: present[0].holeId,
      shelfPos: present[0].shelfPos,
      applicant: trimmedApplicant,
      appliedAt: new Date().toISOString(),
      boxIds: present
        .slice()
        .sort((a, b) => a.fromDepth - b.fromDepth || a.toDepth - b.toDepth)
        .map((b) => b.id),
      status: 'submitted',
    };

    await db.transaction('rw', db.boxes, db.applications, async () => {
      await db.applications.put(application);
      await Promise.all(
        present.map((box) =>
          db.boxes.put({ ...box, storageStatus: 'applied', applicationId: application.id, waitReason: undefined }),
        ),
      );
    });

    await syncAfterWrite(set);
    return application;
  },

  confirmApplication: async (applicationId, keeper) => {
    const trimmedKeeper = keeper.trim();
    if (!trimmedKeeper) throw new IntakeError('请填写库房管理员');

    const app = get().applications.find((a) => a.id === applicationId);
    if (!app) throw new IntakeError('入库申请不存在');
    if (app.status === 'confirmed' || app.status === 'rejected') {
      throw new IntakeError(app.status === 'confirmed' ? '该申请已全部上架，无需再确认' : '该申请已退回，不能确认');
    }
    // 重试只动挂起那批：首次确认动 applied，partial 重试只动 waiting
    const retryOnly = app.status === 'partial';

    return db.transaction('rw', db.boxes, db.applications, db.receipts, db.locations, db.runs, async () => {
      const [allBoxes, locations, runs] = await Promise.all([
        db.boxes.toArray(),
        db.locations.toArray(),
        db.runs.toArray(),
      ]);

      const candidates = app.boxIds
        .map((id) => allBoxes.find((b) => b.id === id))
        .filter((b): b is CoreBox => Boolean(b))
        .filter((b) => (retryOnly ? b.storageStatus === 'waiting' : b.storageStatus === 'applied'))
        .sort((a, b) => a.fromDepth - b.fromDepth || a.toDepth - b.toDepth);

      if (!candidates.length) throw new IntakeError('没有需要确认的箱子');

      // 已上架的留着：占用与排架从当前库内状态算起
      const occupancy = new Map<string, number>();
      const storedList: CoreBox[] = [];
      allBoxes
        .filter((b) => b.storageStatus === 'stored' && b.locationId)
        .forEach((b) => {
          occupancy.set(b.locationId!, (occupancy.get(b.locationId!) ?? 0) + 1);
          storedList.push(b);
        });

      const storedItems: IntakeItem[] = [];
      const waitingItems: IntakeItem[] = [];
      const boxPatches = new Map<string, CoreBox>();

      // 入库单（重试时需要据此保留已上架条目、复用空出的排位序号）
      const existing = await db.receipts.where('applicationId').equals(applicationId).first();

      for (const box of candidates) {
        const result = allocateBox(box, locations, occupancy, runs, storedList);
        if (result.stored && result.location) {
          occupancy.set(result.location.id, (occupancy.get(result.location.id) ?? 0) + 1);
          const storedBox: CoreBox = {
            ...box,
            storageStatus: 'stored',
            locationId: result.location.id,
            waitReason: undefined,
          };
          storedList.push(storedBox);
          storedItems.push(result.item);
          boxPatches.set(box.id, storedBox);
        } else {
          waitingItems.push({ ...result.item, stored: false, reason: result.reason });
          boxPatches.set(box.id, {
            ...box,
            storageStatus: 'waiting',
            waitReason: result.reason,
          });
        }
      }

      // 入库单：重试时保留此前已上架条目（上架的不能挤下来）；挂起条目由本次重算替换
      const keptItems = existing?.items.filter((it) => it.stored) ?? [];
      // 历史单据里仍挂起但本次未覆盖（如已不在申请内）的条目原样保留
      const candidateIds = new Set(candidates.map((b) => b.id));
      const carriedWaitingItems = retryOnly
        ? (existing?.items.filter((it) => !it.stored && !candidateIds.has(it.boxId)) ?? [])
        : [];

      // 统一编位置号与断档：每个库位按最终在架箱深度连排；历史在架箱沿用单据位置，新箱补空号
      // 位置号是库位内的物理位，需从全部入库单的在架条目汇总（已退回条目的位置号已清空）
      const allReceipts = await db.receipts.toArray();
      const fixedSeqByBoxAndLocation = new Map<string, Map<string, number>>();
      allReceipts.forEach((rec) => {
        rec.items.forEach((it) => {
          if (it.stored && it.locationId && typeof it.seq === 'number') {
            const map = fixedSeqByBoxAndLocation.get(it.locationId) ?? new Map<string, number>();
            map.set(it.boxId, it.seq);
            fixedSeqByBoxAndLocation.set(it.locationId, map);
          }
        });
      });
      const layoutByLocation = new Map<string, Map<string, { seq: number; gaps: LocationGap[] }>>();
      locations.forEach((loc) => {
        const here = storedList.filter((b) => b.locationId === loc.id).sort((a, b) => a.fromDepth - b.fromDepth || a.toDepth - b.toDepth);
        if (!here.length) return;
        layoutByLocation.set(loc.id, assignLayout(loc, here, fixedSeqByBoxAndLocation.get(loc.id) ?? new Map(), runs));
      });
      const withLayout = (item: IntakeItem): IntakeItem => {
        if (!item.stored || !item.locationId) return item;
        const layout = layoutByLocation.get(item.locationId)?.get(item.boxId);
        return layout ? { ...item, seq: layout.seq, gaps: layout.gaps } : item;
      };
      const freshStoredItems = storedItems.map(withLayout);
      // 此前已上架条目也重算：同库位新落架箱会改变库位内断档形态（位置号保持不变）
      const freshKeptItems = keptItems.map(withLayout);

      const items = [...freshKeptItems, ...freshStoredItems, ...carriedWaitingItems, ...waitingItems];
      // 计数只看本申请当前仍有效的箱子；库房退回（reason 含「退回」）的历史条目不计入
      const activeIds = new Set(app.boxIds);
      const isReturned = (it: IntakeItem) => !it.stored && it.reason?.includes('退回') === true;
      const storedCount = items.filter((it) => it.stored && activeIds.has(it.boxId)).length;
      const waitingCount = items.filter((it) => !it.stored && activeIds.has(it.boxId) && !isReturned(it)).length;

      // 全部失败 → 这批退回待入库；至少一箱上架 → 落成入库单
      let status: IntakeApplication['status'];
      if (storedCount === 0) {
        status = 'failed';
        // 确认失败后这批退回待入库
        boxPatches.forEach((patch, id) => {
          const reason = waitingItems.find((it) => it.boxId === id)?.reason;
          boxPatches.set(id, { ...patch, storageStatus: 'pending', waitReason: reason, applicationId: undefined });
        });
      } else {
        status = waitingCount > 0 ? 'partial' : 'confirmed';
      }

      const now = new Date().toISOString();
      let receipt = existing;
      if (storedCount > 0) {
        const receiptNo = existing?.receiptNo ?? `RK-${todayStamp()}-${String((await db.receipts.count()) + 1).padStart(3, '0')}`;
        const next: IntakeReceipt = {
          id: existing?.id ?? uid('rec'),
          receiptNo,
          applicationId: app.id,
          appNo: app.appNo,
          confirmedAt: now,
          keeper: trimmedKeeper,
          items,
          storedCount,
          waitingCount,
          retried: retryOnly || existing?.retried,
        };
        receipt = next;
        // 回填 receiptId 到本单上架箱
        boxPatches.forEach((patch, id) => {
          if (patch.storageStatus === 'stored') boxPatches.set(id, { ...patch, receiptId: next.id });
        });
        await db.receipts.put(next);
      } else if (existing) {
        // 重试到一箱都没上架：保留历史入库单，不动已上架条目
        receipt = existing;
      }

      const nextApp: IntakeApplication = {
        ...app,
        status,
        note: status === 'failed' ? `确认失败，整批退回待入库：${waitingItems[0]?.reason ?? '库位不满足'}` : app.note,
      };

      await Promise.all([
        db.applications.put(nextApp),
        ...[...boxPatches.values()].map((b) => db.boxes.put(b)),
      ]);

      await syncAfterWrite(set);
      // 全部失败时整批已回待入库（无入库单）；上架的留着
      return { receipt: receipt ?? null, storedCount, waitingCount, retried: retryOnly, failReason: waitingItems[0]?.reason };
    });
  },

  rejectApplication: async (applicationId, note) => {
    const app = get().applications.find((a) => a.id === applicationId);
    if (!app) throw new IntakeError('入库申请不存在');
    if (app.status === 'rejected') throw new IntakeError('该申请已退回');

    await db.transaction('rw', db.boxes, db.applications, async () => {
      const boxes = await db.boxes.bulkGet(app.boxIds);
      await Promise.all(
        boxes
          .filter((b): b is CoreBox => Boolean(b))
          // 未上架的（待确认/排队）整批退回待入库；已上架的留着
          .filter((b) => b.storageStatus === 'applied' || b.storageStatus === 'waiting')
          .map((b) => db.boxes.put({ ...b, storageStatus: 'pending', applicationId: undefined, waitReason: undefined, locationId: undefined })),
      );
      await db.applications.put({ ...app, status: 'rejected', note: note.trim() || '库房管理员退回待入库' });
    });
    await syncAfterWrite(set);
  },

  returnStoredBox: async (boxId, keeper, note) => {
    const trimmed = note.trim();
    if (!trimmed) throw new IntakeError('请填写退回原因');
    const box = await db.boxes.get(boxId);
    if (!box) throw new IntakeError('箱子不存在');
    if (box.storageStatus !== 'stored' || !box.receiptId) throw new IntakeError('该箱未上架，无需退回');

    await db.transaction('rw', db.boxes, db.receipts, db.applications, async () => {
      const receipt = await db.receipts.get(box.receiptId!);
      const items = receipt?.items.map((it) =>
        it.boxId === boxId
          ? {
              ...it,
              stored: false,
              // 腾出库位与排位位置号，供挂起箱重试时按深度补入
              locationId: undefined,
              locationCode: undefined,
              seq: undefined,
              gaps: undefined,
              reason: `库房管理员${keeper.trim() || ''}退回：${trimmed}`,
            }
          : it,
      );
      await db.boxes.put({
        ...box,
        storageStatus: 'pending',
        applicationId: undefined,
        locationId: undefined,
        receiptId: undefined,
        waitReason: undefined,
      });
      if (receipt && items) {
        await db.receipts.put({
          ...receipt,
          items,
          storedCount: items.filter((it) => it.stored).length,
          waitingCount: items.filter((it) => !it.stored).length,
          returned: true,
          returnedAt: new Date().toISOString(),
          returnNote: trimmed,
        });
        // 该申请若仍有排队箱，退回后腾出位置可重试；状态回退为部分挂起
        const app = await db.applications.get(receipt.applicationId);
        if (app && (app.status === 'confirmed' || app.status === 'partial')) {
          const stillWaiting = await db.boxes
            .where('applicationId')
            .equals(app.id)
            .and((b: CoreBox) => b.storageStatus === 'waiting')
            .count();
          if (stillWaiting > 0) {
            await db.applications.put({ ...app, status: 'partial', note: `库房退回 ${box.boxNo} 腾出库位，可重试挂起批` });
          }
        }
      }
    });
    await syncAfterWrite(set);
  },

  returnReceipt: async (receiptId, keeper, note) => {
    const trimmed = note.trim();
    if (!trimmed) throw new IntakeError('请填写退回原因');
    const receipt = await db.receipts.get(receiptId);
    if (!receipt) throw new IntakeError('入库单不存在');

    await db.transaction('rw', db.boxes, db.receipts, async () => {
      const storedIds = receipt.items.filter((it) => it.stored).map((it) => it.boxId);
      const boxes = await db.boxes.bulkGet(storedIds);
      await Promise.all(
        boxes
          .filter((b): b is CoreBox => Boolean(b))
          .map((b) =>
            db.boxes.put({ ...b, storageStatus: 'pending', applicationId: undefined, locationId: undefined, receiptId: undefined, waitReason: undefined }),
          ),
      );
      const items = receipt.items.map((it) =>
        it.stored
          ? {
              ...it,
              stored: false,
              locationId: undefined,
              locationCode: undefined,
              seq: undefined,
              gaps: undefined,
              reason: `库房管理员${keeper.trim() || ''}整单退回：${trimmed}`,
            }
          : it,
      );
      await db.receipts.put({
        ...receipt,
        items,
        storedCount: 0,
        waitingCount: items.length,
        returned: true,
        returnedAt: new Date().toISOString(),
        returnNote: trimmed,
      });
    });
    await syncAfterWrite(set);
  },
}));

/** 写库后同步本 store 与岩芯箱 store（申请/确认会同时改动两边） */
async function syncAfterWrite(set: (partial: Partial<IntakeState>) => void): Promise<void> {
  const [applications, receipts, boxes] = await Promise.all([
    db.applications.orderBy('appliedAt').reverse().toArray(),
    db.receipts.orderBy('confirmedAt').reverse().toArray(),
    db.boxes.orderBy('boxNo').toArray(),
  ]);
  set({ applications, receipts });
  useBoxStore.setState({ boxes });
}
