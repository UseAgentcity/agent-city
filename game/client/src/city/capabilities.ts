// What each city offers in Agent City. Every city can be explored and watched from; races run only
// where the arena backend has a lane. Adding a city means adding it here once its backend lane exists.
import type { GeoPlace } from '../../../shared/types.ts';

export type Lane = 'bounty' | 'walletOp';

export interface ArenaCity {
  id: string;
  name: [zh: string, en: string];
  lat: number;
  lon: number;
  /** How far from the center still counts as this city (km). */
  radiusKm: number;
  /** Lanes the backend runs here. */
  lanes: Lane[];
  /** Where the Agent Tower (the arena's lobby) stands. */
  towerAt: GeoPlace;
}

export interface TravelCity {
  id: string;
  name: [zh: string, en: string];
  sub: [zh: string, en: string];
  place: GeoPlace;
}

export const TIMES_SQUARE: GeoPlace = { name: 'Times Square', label: 'Times Square, New York, United States', lat: 40.758, lon: -73.9855, countryCode: 'us', kind: 'square' };

export const ARENA_CITIES: ArenaCity[] = [
  { id: 'new-york', name: ['纽约', 'New York'], lat: TIMES_SQUARE.lat, lon: TIMES_SQUARE.lon, radiusKm: 3, lanes: ['bounty'], towerAt: TIMES_SQUARE },
];

const MAP_KM = 3;
export function mapOpen(p: { lat: number; lon: number } | null | undefined): boolean {
  return !!p && distanceKm(p, TIMES_SQUARE) <= MAP_KM;
}

export function playableBounds() {
  const dLat = MAP_KM / 111;
  const dLon = MAP_KM / (111 * Math.cos(TIMES_SQUARE.lat * Math.PI / 180));
  return { minLat: TIMES_SQUARE.lat - dLat, maxLat: TIMES_SQUARE.lat + dLat, minLon: TIMES_SQUARE.lon - dLon, maxLon: TIMES_SQUARE.lon + dLon };
}

export const TRAVEL_CITIES: TravelCity[] = [
  { id: 'new-york', name: ['纽约', 'New York'], sub: ['时代广场 · Agent 商战', 'Times Square · Agent Tycoon'], place: TIMES_SQUARE },
];

const R = 6371;
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The arena city at a spot, or null where races aren't open (explore and watch only). */
export function arenaCityAt(p: { lat: number; lon: number } | null | undefined): ArenaCity | null {
  if (!p) return null;
  return ARENA_CITIES.find((c) => distanceKm(p, c) <= c.radiusKm) ?? null;
}

/** The quick-travel city a spot belongs to (within 60 km), for naming where you are. */
export function travelCityAt(p: { lat: number; lon: number } | null | undefined): TravelCity | null {
  if (!p) return null;
  return TRAVEL_CITIES.find((c) => distanceKm(p, c.place) <= 60) ?? null;
}
