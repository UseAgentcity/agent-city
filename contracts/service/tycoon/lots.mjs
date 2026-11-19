// The first-batch business lots: real storefronts in Midtown taken from the game's own OpenStreetMap
// buildings (`key` is the building's footprint key in the 3D city), plus Winter Village stalls in
// Bryant Park. A lot keeps only its place and trade; the sign shows the Agent that leases it.
// Tier is set by distance to the Times Square bowtie: A < 70 m, B < 150 m, C beyond.

export const DISTRICTS = {
  square: { zh: '时代广场', en: 'Times Square', lat: 40.7580, lon: -73.9855 },
  theater: { zh: '百老汇剧院区', en: 'Theater District', lat: 40.7586, lon: -73.9868 },
  market: { zh: '布莱恩特公园冬季集市', en: 'Bryant Park Winter Market', lat: 40.7536, lon: -73.9838 },
};

export const LOTS = [
  // Times Square: coffee
  { id: 'sq-c1', district: 'square', cat: 'coffee', tier: 'A', lat: 40.756785, lon: -73.985629, key: 26180788640 },
  { id: 'sq-c2', district: 'square', cat: 'coffee', tier: 'B', lat: 40.759893, lon: -73.985245, key: 41584499872 },
  { id: 'sq-c3', district: 'square', cat: 'coffee', tier: 'B', lat: 40.757863, lon: -73.983976, key: 42344195527 },
  { id: 'sq-c4', district: 'square', cat: 'coffee', tier: 'C', lat: 40.758137, lon: -73.983095, key: 42587322752 },
  // Times Square: souvenirs
  { id: 'sq-g1', district: 'square', cat: 'gifts', tier: 'A', lat: 40.757771, lon: -73.985962, key: 41383383841 },
  { id: 'sq-g2', district: 'square', cat: 'gifts', tier: 'A', lat: 40.758108, lon: -73.984877, key: 41450295201 },
  { id: 'sq-g3', district: 'square', cat: 'gifts', tier: 'C', lat: 40.759646, lon: -73.98701, key: 42441322731 },
  { id: 'sq-g4', district: 'square', cat: 'gifts', tier: 'C', lat: 40.758178, lon: -73.988551, key: 42583894592 },
  // Times Square: dining
  { id: 'sq-d1', district: 'square', cat: 'dining', tier: 'A', lat: 40.759277, lon: -73.985422, key: 42345044485 },
  { id: 'sq-d2', district: 'square', cat: 'dining', tier: 'A', lat: 40.756787, lon: -73.985375, key: 570416493 },
  { id: 'sq-d3', district: 'square', cat: 'dining', tier: 'B', lat: 40.757974, lon: -73.984287, key: 42344197295 },
  { id: 'sq-d4', district: 'square', cat: 'dining', tier: 'B', lat: 40.757533, lon: -73.987254, key: 42349631362 },
  // Times Square: apparel
  { id: 'sq-a1', district: 'square', cat: 'apparel', tier: 'A', lat: 40.758962, lon: -73.985587, key: 570492486 },
  { id: 'sq-a2', district: 'square', cat: 'apparel', tier: 'B', lat: 40.757308, lon: -73.986888, key: 297690723 },
  { id: 'sq-a3', district: 'square', cat: 'apparel', tier: 'B', lat: 40.755907, lon: -73.987533, key: 297690729 },
  { id: 'sq-a4', district: 'square', cat: 'apparel', tier: 'C', lat: 40.760138, lon: -73.983548, key: 42348553606 },
  // Theater District: theatres
  { id: 'th-t1', district: 'theater', cat: 'theatre', tier: 'A', lat: 40.7586, lon: -73.986159, key: 297690734 },
  { id: 'th-t2', district: 'theater', cat: 'theatre', tier: 'B', lat: 40.759039, lon: -73.986743, key: 42344316013 },
  { id: 'th-t3', district: 'theater', cat: 'theatre', tier: 'B', lat: 40.758417, lon: -73.98708, key: 571868968 },
  { id: 'th-t4', district: 'theater', cat: 'theatre', tier: 'B', lat: 40.758074, lon: -73.987299, key: 570492329 },
  // Theater District: bars
  { id: 'th-b1', district: 'theater', cat: 'bar', tier: 'B', lat: 40.756784, lon: -73.985286, key: 42344194566 },
  { id: 'th-b2', district: 'theater', cat: 'bar', tier: 'B', lat: 40.759557, lon: -73.986424, key: 297690722 },
  { id: 'th-b3', district: 'theater', cat: 'bar', tier: 'C', lat: 40.760446, lon: -73.98621, key: 570492490 },
  { id: 'th-b4', district: 'theater', cat: 'bar', tier: 'C', lat: 40.758412, lon: -73.98328, key: 42347934885 },
  // Bryant Park Winter Market: a row of stalls about 8 m apart along the south side of the lawn
  ...Array.from({ length: 8 }, (_, i) => ({
    id: `mk-s${i + 1}`, district: 'market', cat: 'stall', tier: 'S', lat: 40.7534, lon: +(-73.98445 + i * 0.0001).toFixed(6), key: null,
  })),
];
