// Where the player is, in Agent City terms, for any UI (phone apps, front desks, HUD) without threading
// hooks through every installer. main.ts drives it; UIs read `currentCity()` and call the travel actions.
import type { GeoPlace } from '../../../shared/types.ts';
import { ARENA_CITIES, TRAVEL_CITIES, arenaCityAt, travelCityAt, type ArenaCity, type TravelCity } from './capabilities.ts';

export interface CityState {
  /** Quick-travel city you're in (null somewhere else on Earth, or in a classic preset city). */
  city: TravelCity | null;
  /** The arena city you're in, or null: explore and watch only, races are being prepared here. */
  arena: ArenaCity | null;
  /** Display name for where you are: [zh, en]. */
  name: [string, string];
}

export interface CityActions {
  /** Go to a quick-travel city (teleport, or restart the world there when it needs the Agent Tower). */
  travel(id: string): void;
  /** Go to the open arena city's Agent Tower. */
  goArena(): void;
}

let state: CityState = { city: null, arena: null, name: ['这座城市', 'this city'] };
let actions: CityActions | null = null;
const listeners = new Set<(s: CityState) => void>();

export function currentCity(): CityState { return state; }
export function cityActions(): CityActions | null { return actions; }
export function onCityChange(fn: (s: CityState) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

/** The arena city that's open right now (Times Square), for "go watch" buttons. */
export const openArena = (): ArenaCity => ARENA_CITIES[0];
export { TRAVEL_CITIES };

export function setCityActions(a: CityActions) { actions = a; }

// The Agent Tower is built with the world, so reaching the arena from another city restarts the world
// there: the landing page reads this once and starts straight in (no detour through the old workspace).
const BOOT_KEY = 'agent-city:boot';
export function bootInto(place: GeoPlace) {
  try { sessionStorage.setItem(BOOT_KEY, JSON.stringify(place)); } catch { /* private mode: plain reload */ }
  location.reload();
}
export function takeBoot(): GeoPlace | null {
  try {
    const raw = sessionStorage.getItem(BOOT_KEY);
    sessionStorage.removeItem(BOOT_KEY);
    const p = raw ? JSON.parse(raw) as GeoPlace : null;
    return p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && typeof p.name === 'string' ? p : null;
  } catch { return null; }
}

/** Called by main.ts as the player moves; fires listeners only when the city or arena status changes. */
export function updateCity(pos: { lat: number; lon: number } | null, fallbackName?: string) {
  const city = travelCityAt(pos), arena = arenaCityAt(pos);
  const name: [string, string] = city ? city.name : arena ? arena.name : [fallbackName || '这座城市', fallbackName || 'this city'];
  if (state.city?.id === city?.id && state.arena?.id === arena?.id && state.name[1] === name[1]) return;
  state = { city, arena, name };
  for (const fn of listeners) fn(state);
}
