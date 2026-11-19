// Read-only check: run after starting the frontend AND the OpenWorld API.
const base = process.argv[2] || 'http://localhost:5317';
let failed = false;
for (const [label, path, binary] of [
  ['World API', '/api/me', false],
  ['New York map tile', '/api/tiles/v/14/4824/6157', true],
]) {
  try {
    const r = await fetch(new URL(path, base), { signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    if (binary) {
      if (!(r.headers.get('content-type') || '').includes('protobuf')) throw new Error('Expected map protobuf, not HTML');
      const data = await r.arrayBuffer();
      if (!data.byteLength) throw new Error('Empty map tile');
      console.log(`OK ${label}: ${data.byteLength} bytes`);
    } else {
      await r.json();
      console.log(`OK ${label}`);
    }
  } catch (error) {
    failed = true;
    console.error(`FAIL ${label}: ${error.message}`);
  }
}
if (failed) console.error('Start both services from game/: npm run dev. Vite alone cannot serve city maps. GitHub login is separate from map availability.');
process.exitCode = failed ? 1 : 0;
