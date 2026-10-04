import { create } from 'zustand';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import type { StorageLocation } from '../types/storage-location';
import { storedCountOf } from '../utils/inbound';
import { useBoxStore } from './boxStore';

export interface LocationInput {
  code: string;
  shelfPos: string;
  holeId: string;
  capacity: number;
  fromDepth: number;
  toDepth: number;
  keeper: string;
  remark?: string;
}

interface LocationState {
  locations: StorageLocation[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  addLocation: (input: LocationInput) => Promise<StorageLocation>;
  updateLocation: (id: string, patch: Partial<LocationInput>) => Promise<void>;
  removeLocation: (id: string) => Promise<void>;
  /** 库位已上架箱数 */
  occupied: (id: string) => number;
}

/** 库位台账：库房管理员按架位编出库位，写明容量与管段 */
export const useLocationStore = create<LocationState>()((set, get) => ({
  locations: [],
  hydrated: false,

  hydrate: async () => {
    const locations = await db.locations.orderBy('code').toArray();
    set({ locations, hydrated: true });
  },

  addLocation: async (input) => {
    const location: StorageLocation = {
      id: uid('loc'),
      code: input.code.trim(),
      shelfPos: input.shelfPos,
      holeId: input.holeId ?? '',
      capacity: Number(input.capacity) || 0,
      fromDepth: Number(input.fromDepth) || 0,
      toDepth: Number(input.toDepth) || 0,
      createdAt: new Date().toISOString(),
      keeper: input.keeper.trim() || '库房管理员',
      remark: input.remark?.trim() || undefined,
    };
    await db.locations.put(location);
    set({ locations: [...get().locations, location].sort((a, b) => a.code.localeCompare(b.code)) });
    return location;
  },

  updateLocation: async (id, patch) => {
    const current = get().locations.find((loc) => loc.id === id);
    if (!current) return;
    const next: StorageLocation = { ...current, ...patch };
    await db.locations.put(next);
    set({ locations: get().locations.map((loc) => (loc.id === id ? next : loc)) });
  },

  removeLocation: async (id) => {
    await db.locations.delete(id);
    set({ locations: get().locations.filter((loc) => loc.id !== id) });
  },

  occupied: (id) => storedCountOf(id, useBoxStore.getState().boxes),
}));
