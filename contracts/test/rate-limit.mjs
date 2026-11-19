import assert from 'node:assert/strict';
import { arenaClientKey, createGameServer } from '../service/game-server.mjs';

assert.equal(arenaClientKey('127.0.0.1', '203.0.113.9'), '203.0.113.9');
assert.equal(arenaClientKey('::ffff:127.0.0.1', '2001:db8::1'), '2001:db8::1');
assert.equal(arenaClientKey('127.0.0.1', 'not-an-ip'), '127.0.0.1');
assert.equal(arenaClientKey('198.51.100.4', '203.0.113.9'), '198.51.100.4');
assert.equal(arenaClientKey('', undefined), 'unknown');

const server = createGameServer({
  tycoon: { snapshot() { return { lots: [] }; } },
  origin: 'http://localhost:5317', ratePerMinute: 2,
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const api = `http://127.0.0.1:${server.address().port}`;
const hit = async (client) => (await fetch(`${api}/api/arena/tycoon`, { headers: client ? { 'x-arena-client': client } : {} })).status;
try {
  assert.deepEqual([await hit('203.0.113.9'), await hit('203.0.113.9'), await hit('203.0.113.9')], [200, 200, 429]);
  assert.deepEqual([await hit('203.0.113.10'), await hit('203.0.113.10')], [200, 200]);
  assert.equal(await hit('203.0.113.9'), 429);
  assert.deepEqual([await hit(), await hit(), await hit()], [200, 200, 429]);
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(() => resolve()));
}
console.log('PASS: arena rate limit is per real client; a direct peer cannot pick another bucket');
