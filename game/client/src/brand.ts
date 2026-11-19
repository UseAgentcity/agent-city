// The Agent City mark: the player's designer-toy figure, head only, in front of the landing page's white stage
// disc on a gold tile. One definition draws it everywhere: the favicon and touch icon (scripts/brand-icons.mjs
// writes the SVG), the landing header, and the tower's signs in the 3D city (canvas).
const INK = '#16171b', GOLD = '#f0b90b', GOLD_DEEP = '#d9a405', SKIN = '#ffdcc2', CHEEK = '#ff8fa3', WHITE = '#ffffff';

/** Shapes on a 64×64 grid, back to front. `mono` parts make up the silhouette used for glows. */
interface Part { d?: string; circle?: [number, number, number]; ellipse?: [number, number, number, number]; fill?: string; stroke?: string; width?: number; alpha?: number; mono?: boolean }
const HEAD: Part[] = [
  { circle: [32, 35, 24], fill: WHITE, stroke: INK, width: 3, mono: true }, // the stage disc
  { circle: [32, 38, 17], fill: SKIN, stroke: INK, width: 2.6 }, // face
  { d: 'M15.5 30.5 C15.5 18.5 22.5 12 32 12 C41.5 12 48.5 18.5 48.5 30.5 Z', fill: GOLD, stroke: INK, width: 2.6 }, // beanie
  { d: 'M14.5 26.5 h35 a2.5 2.5 0 0 1 2.5 2.5 v2 a2.5 2.5 0 0 1 -2.5 2.5 h-35 a2.5 2.5 0 0 1 -2.5 -2.5 v-2 a2.5 2.5 0 0 1 2.5 -2.5 z', fill: GOLD_DEEP, stroke: INK, width: 2.2 }, // ribbed cuff
  { d: 'M29.2 27.8 h5.6 v3.6 h-5.6 z', fill: INK }, // label
  { ellipse: [25.8, 41.5, 3, 3.6], fill: INK }, { ellipse: [38.2, 41.5, 3, 3.6], fill: INK }, // eyes
  { circle: [26.9, 40.1, 1.1], fill: WHITE }, { circle: [39.3, 40.1, 1.1], fill: WHITE },
  { ellipse: [20.5, 46.5, 3.3, 2], fill: CHEEK, alpha: 0.85 }, { ellipse: [43.5, 46.5, 3.3, 2], fill: CHEEK, alpha: 0.85 }, // cheeks
  { d: 'M28.4 47.6 Q32 50.8 35.6 47.6', stroke: INK, width: 2 }, // smile
];

/** The mark as an SVG document. `tile`: a rounded gold tile with an ink outline, so it holds on gold and on browser tabs
 * (favicon, landing header), or full bleed (touch icons, the OS rounds them). */
export function brandSvg(tile: 'rounded' | 'square' = 'rounded'): string {
  const parts = HEAD.map((p) => {
    const paint = `fill="${p.fill ?? 'none'}"${p.stroke ? ` stroke="${p.stroke}" stroke-width="${p.width}" stroke-linecap="round" stroke-linejoin="round"` : ''}${p.alpha ? ` opacity="${p.alpha}"` : ''}`;
    if (p.circle) return `<circle cx="${p.circle[0]}" cy="${p.circle[1]}" r="${p.circle[2]}" ${paint}/>`;
    if (p.ellipse) return `<ellipse cx="${p.ellipse[0]}" cy="${p.ellipse[1]}" rx="${p.ellipse[2]}" ry="${p.ellipse[3]}" ${paint}/>`;
    return `<path d="${p.d}" ${paint}/>`;
  }).join('');
  const rx = tile === 'rounded' ? 14 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
<defs><pattern id="d" width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="2.5" cy="2.5" r=".7" fill="${INK}" opacity=".16"/></pattern></defs>
<rect width="64" height="64" rx="${rx}" fill="${GOLD}"/><rect width="64" height="64" rx="${rx}" fill="url(#d)"/>
${parts}${tile === 'rounded' ? `<rect x="1.5" y="1.5" width="61" height="61" rx="12.5" fill="none" stroke="${INK}" stroke-width="3"/>` : ''}
</svg>
`;
}

/**
 * Draws the mark (no tile) at (x, y), `size` px square, on a 2D canvas. `mono`: a single colour silhouette
 * (the disc only), for glows and alpha maps.
 */
export function drawBrandMark(g: CanvasRenderingContext2D, x: number, y: number, size: number, mono?: string) {
  g.save();
  g.translate(x, y);
  g.scale(size / 64, size / 64);
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const p of HEAD) {
    if (mono && !p.mono) continue;
    const path = new Path2D();
    if (p.circle) path.arc(p.circle[0], p.circle[1], p.circle[2], 0, Math.PI * 2);
    else if (p.ellipse) path.ellipse(p.ellipse[0], p.ellipse[1], p.ellipse[2], p.ellipse[3], 0, 0, Math.PI * 2);
    else path.addPath(new Path2D(p.d!));
    g.globalAlpha = p.alpha ?? 1;
    if (mono) { g.fillStyle = mono; g.fill(path); continue; }
    if (p.fill) { g.fillStyle = p.fill; g.fill(path); }
    if (p.stroke) { g.strokeStyle = p.stroke; g.lineWidth = p.width ?? 2; g.stroke(path); }
  }
  g.restore();
}
