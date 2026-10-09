/** Save slots in localStorage (browser only). */
import { isSaveData, type SaveData } from './save';

export const SLOTS = ['auto', '1', '2', '3'] as const;
export type Slot = (typeof SLOTS)[number];

export interface SlotMeta {
  slot: Slot;
  savedAt: string;
  mapName: string;
  mapKey: string;
  day: number;
  money: number;
}

const key = (slot: Slot) => `kotabaru.save.${slot}`;
const metaKey = (slot: Slot) => `kotabaru.saveMeta.${slot}`;

export function writeSlot(slot: Slot, data: SaveData): boolean {
  try {
    localStorage.setItem(key(slot), JSON.stringify(data));
    const meta: SlotMeta = { slot, savedAt: data.savedAt, mapName: data.mapName, mapKey: data.mapKey, day: data.day, money: data.money };
    localStorage.setItem(metaKey(slot), JSON.stringify(meta));
    return true;
  } catch {
    return false; // storage full or unavailable
  }
}

export function readSlot(slot: Slot): SaveData | null {
  try {
    const raw = localStorage.getItem(key(slot));
    if (!raw) return null;
    const data = JSON.parse(raw);
    return isSaveData(data) ? data : null;
  } catch {
    return null;
  }
}

export function slotMeta(slot: Slot): SlotMeta | null {
  try {
    const raw = localStorage.getItem(metaKey(slot));
    return raw ? (JSON.parse(raw) as SlotMeta) : null;
  } catch {
    return null;
  }
}

export function deleteSlot(slot: Slot) {
  try {
    localStorage.removeItem(key(slot));
    localStorage.removeItem(metaKey(slot));
  } catch { /* ignore */ }
}
