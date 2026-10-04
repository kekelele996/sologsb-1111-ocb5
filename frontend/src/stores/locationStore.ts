import { create } from 'zustand';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import type { StorageLocation } from '../types/storage-location';
import { nextLocationCode } from '../utils/warehouse';

export interface LocationInput {
  shelfPos: string;
  holeId: string;
  fromDepth: number;
  toDepth: number;
  capacity: number;
  remark?: string;
}

/** 库位仍有已上架箱时不能改容量/管段，也不能删 */
export class LocationInUseError extends Error {}

interface LocationState {
  locations: StorageLocation[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  suggestCode: (shelfPos: string) => string;
  addLocation: (input: LocationInput) => Promise<StorageLocation>;
  updateLocation: (id: string, patch: Partial<LocationInput>) => Promise<void>;
  removeLocation: (id: string) => Promise<void>;
}

/** 库位（架位下装几箱、管到哪段） */
export const useLocationStore = create<LocationState>()((set, get) => ({
  locations: [],
  hydrated: false,

  hydrate: async () => {
    const locations = await db.locations.orderBy('code').toArray();
    set({ locations, hydrated: true });
  },

  suggestCode: (shelfPos) => nextLocationCode(shelfPos, get().locations),

  addLocation: async (input) => {
    const location: StorageLocation = {
      id: uid('loc'),
      code: nextLocationCode(input.shelfPos, get().locations),
      shelfPos: input.shelfPos,
      holeId: input.holeId,
      fromDepth: Number(input.fromDepth) || 0,
      toDepth: Number(input.toDepth) || 0,
      capacity: Number(input.capacity) || 0,
      remark: input.remark?.trim() || undefined,
    };
    await db.locations.put(location);
    set({ locations: [...get().locations, location].sort((a, b) => a.code.localeCompare(b.code)) });
    return location;
  },

  updateLocation: async (id, patch) => {
    const current = get().locations.find((l) => l.id === id);
    if (!current) return;
    const next: StorageLocation = { ...current, ...patch };
    await db.locations.put(next);
    set({ locations: get().locations.map((l) => (l.id === id ? next : l)) });
  },

  removeLocation: async (id) => {
    await db.locations.delete(id);
    set({ locations: get().locations.filter((l) => l.id !== id) });
  },
}));
