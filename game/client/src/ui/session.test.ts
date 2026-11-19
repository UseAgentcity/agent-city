// node --import tsx --test client/src/ui/session.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k),
};
const { saveSession, loadSession } = await import('../session.ts');

const dubai = { name: 'Burj Khalifa', label: 'Dubai', lat: 25.1972, lon: 55.2744, countryCode: 'ae', kind: 'attraction' };
const base = { lat: 25.2, lon: 55.27, agl: 0, facing: 0, inside: null, hour: 16.5, phoneApp: null, label: 'Downtown Dubai' };

test('the Agent Tower demo flag survives a save and load', () => {
  saveSession({ ...base, start: dubai, businessDemo: true });
  assert.equal(loadSession()?.businessDemo, true);
});

test('an ordinary city session is not marked as the demo', () => {
  saveSession({ ...base, start: { name: 'Times Square', label: 'New York', lat: 40.758, lon: -73.9855, countryCode: 'us', kind: 'attraction' } });
  assert.equal(loadSession()?.businessDemo, undefined);
});
