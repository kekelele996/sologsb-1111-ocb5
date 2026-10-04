import { create } from 'zustand';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import type { BoxStatus, CoreBox } from '../types/core-box';

export interface BoxInput {
  boxNo: string;
  holeId: string;
  fromDepth: number;
  toDepth: number;
  slots: number;
  slotLength: number;
  boxedAt: string;
  shelfPos?: string;
  damagedSlots: number[];
  operator: string;
  remark?: string;
}

interface BoxState {
  boxes: CoreBox[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  addBox: (input: BoxInput) => Promise<CoreBox>;
  updateBox: (id: string, patch: Partial<BoxInput>) => Promise<void>;
  removeBox: (id: string) => Promise<void>;
  /** 标记/取消破损格（仅待入库箱可改） */
  toggleDamagedSlot: (id: string, slot: number) => Promise<void>;
}

export function isEditable(box: CoreBox | undefined): boolean {
  return !box?.status || box.status === 'pending';
}

/** 岩芯箱与格位分配；未入库箱由钻探班组改删，已报/已上架箱锁定 */
export const useBoxStore = create<BoxState>()((set, get) => ({
  boxes: [],
  hydrated: false,

  hydrate: async () => {
    const boxes = await db.boxes.orderBy('boxNo').toArray();
    set({ boxes, hydrated: true });
  },

  addBox: async (input) => {
    const status: BoxStatus = 'pending';
    const box: CoreBox = {
      id: uid('box'),
      boxNo: input.boxNo.trim(),
      holeId: input.holeId,
      fromDepth: Number(input.fromDepth) || 0,
      toDepth: Number(input.toDepth) || 0,
      slots: Number(input.slots) || 0,
      slotLength: Number(input.slotLength) || 0,
      boxedAt: input.boxedAt,
      shelfPos: input.shelfPos ?? '',
      damagedSlots: input.damagedSlots ?? [],
      operator: input.operator.trim(),
      remark: input.remark?.trim() || undefined,
      status,
      locationId: '',
      inboundOrderId: '',
    };
    await db.boxes.put(box);
    set({ boxes: [...get().boxes, box] });
    return box;
  },

  updateBox: async (id, patch) => {
    const current = get().boxes.find((b) => b.id === id);
    if (!current) return;
    if (!isEditable(current)) throw new Error(`箱 ${current.boxNo} 已提交入库申请或已上架，钻探班组不能修改，请由库房管理员退回`);
    const next: CoreBox = { ...current, ...patch };
    await db.boxes.put(next);
    set({ boxes: get().boxes.map((b) => (b.id === id ? next : b)) });
  },

  removeBox: async (id) => {
    const current = get().boxes.find((b) => b.id === id);
    if (!current) return;
    if (!isEditable(current)) throw new Error(`箱 ${current.boxNo} 已提交入库申请或已上架，不能删除，请由库房管理员退回`);
    await db.boxes.delete(id);
    set({ boxes: get().boxes.filter((b) => b.id !== id) });
  },

  toggleDamagedSlot: async (id, slot) => {
    const current = get().boxes.find((b) => b.id === id);
    if (!current || !isEditable(current)) return;
    const damagedSlots = current.damagedSlots.includes(slot)
      ? current.damagedSlots.filter((s) => s !== slot)
      : [...current.damagedSlots, slot].sort((a, b) => a - b);
    const next: CoreBox = { ...current, damagedSlots };
    await db.boxes.put(next);
    set({ boxes: get().boxes.map((b) => (b.id === id ? next : b)) });
  },
}));
