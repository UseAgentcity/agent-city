import test from 'node:test';
import assert from 'node:assert/strict';
import { arenaCityAt, mapOpen, travelCityAt, TRAVEL_CITIES } from '../city/capabilities.ts';
import { cityScreenAds } from '../city/screens.ts';
import type { Screen, Shop, TycoonCity } from './tycoon.ts';

const at = (id: string) => TRAVEL_CITIES.find((c) => c.id === id)!.place;

test('Times Square is the only open map', () => {
  assert.equal(arenaCityAt(at('new-york'))?.id, 'new-york');
  assert.equal(arenaCityAt({ lat: 40.7583622, lon: -73.98661256 })?.id, 'new-york');
  assert.equal(arenaCityAt({ lat: 25.1972, lon: 55.2744 }), null);
  assert.equal(arenaCityAt(null), null);
  assert.equal(mapOpen(at('new-york')), true);
  assert.equal(mapOpen({ lat: 25.1972, lon: 55.2744 }), false);
  assert.equal(mapOpen({ lat: 35.6595, lon: 139.7005 }), false);
  assert.deepEqual(TRAVEL_CITIES.map((c) => c.id), ['new-york']);
  assert.equal(travelCityAt({ lat: 0, lon: 0 }), null);
});

test('city screens show Agent ads first, then the city slots and the season leader', () => {
  const none = cityScreenAds(null, true);
  assert.equal(none.length, 2, 'no city: the two house slots only');
  const shop = (name: string, profit: number): Shop => ({
    agent: name, name, demo: false, lot: 'sq-c1', cash: 20000 + profit, profit, rep: 1, boost: 0, price: 'standard', inventory: 0,
    brand: { name: name.toUpperCase(), slogan: '', color: '#f0b90b' }, memo: '', defaults: 0, evicted: 0, daysOpen: 3, cobrands: [], today: null, history: [],
    deposit: 0, tokens: 0, tokensSpent: 0, spent: { licence: 0, lease: 0, ads: 0, upgrades: 0 }, upgrades: { signage: 0, decor: 0, hours: 0 },
    servedTotal: 0, screenScore: 0, cat: 'coffee', score: 77, scoreParts: null, bestAd: false,
  });
  const screen = (id: number, title: string | null): Screen => ({ id, tier: id ? 'street' : 'main', owner: title ? 'a' : null, paid: title ? 900 : 0,
    ad: title ? { title, sub: 'hi', bg: ['#000000', '#111111'], fg: '#ffffff', shape: 'bars' } : null });
  const city = { screens: [screen(1, 'second'), screen(0, 'first'), screen(2, null)], standings: [shop('lina.ai', 4200)] } as unknown as TycoonCity;
  const ads = cityScreenAds(city, true);
  assert.deepEqual(ads.slice(0, 2).map((a) => a.title), ['FIRST', 'SECOND'], 'won ads, in screen order, upper-cased');
  assert.equal(ads.length, 5);
  assert.equal(ads[4].title, 'LINA.AI');
  assert.match(ads[4].sub, /77/);
});
