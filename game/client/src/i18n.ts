// The site is English. setLanguage still exists so tests can render the Chinese copy.
// New UI text should call t(zh, en) at the source. Older text that is built in many
// places is translated from the ZH_TEXT / ZH_PATTERNS tables below by localizeDocument().
export const LANGUAGE_KEY = 'agent-city-language';

let lang: 'zh' | 'en' = 'en';

export function isZh() { return lang === 'zh'; }
export function language() { return lang; }
const stampLang = () => {
  const root = typeof document === 'undefined' ? null : document.documentElement;
  if (root) root.lang = lang === 'zh' ? 'zh-CN' : 'en';
};
stampLang();
export function setLanguage(next: 'zh' | 'en') {
  lang = next;
  try { localStorage.setItem(LANGUAGE_KEY, next); } catch { /* this visit only */ }
  stampLang();
}
export function t(zh: string, en: string) { return lang === 'zh' ? zh : en; }

const ZH_TEXT = new Map<string, string>();
const ZH_PATTERNS: Array<[RegExp, string | ((...m: string[]) => string)]> = [];

/** Exact English strings (trimmed) and their Chinese. */
export function addText(pairs: Array<[string, string]>) { for (const [en, zh] of pairs) ZH_TEXT.set(en, zh); }
/** English templates with variable parts. */
export function addPatterns(pairs: Array<[RegExp, string | ((...m: string[]) => string)]>) { ZH_PATTERNS.push(...pairs); }

/** Chinese for an English UI string, or null when there is none. */
export function zhFor(text: string): string | null {
  const s = text.trim();
  if (!s || !/[A-Za-z]/.test(s)) return null;
  const whole = segment(s);
  if (whole != null) return text.replace(s, whole);
  // "71 floors · Burj Khalifa": translate the parts we know, keep names we don't.
  if (!s.includes('·')) return null;
  const parts = s.split(/(\s*·\s*)/);
  let hit = false;
  const out = parts.map((p, i) => {
    if (i % 2) return p;
    const z = segment(p);
    if (z != null) hit = true;
    return z ?? p;
  }).join('');
  return hit ? text.replace(s, out) : null;
}

function segment(s: string): string | null {
  const hit = ZH_TEXT.get(s);
  if (hit != null) return hit;
  for (const [re, to] of ZH_PATTERNS) {
    if (!re.test(s)) continue;
    return typeof to === 'string' ? s.replace(re, to) : s.replace(re, to as (...m: string[]) => string);
  }
  return null;
}

/** Translate a string when Chinese is on (for canvas text and toasts built from English). */
export function tr(text: string) { return lang === 'zh' ? zhFor(text) ?? text : text; }

const ATTRS = ['title', 'placeholder', 'aria-label', 'data-tip'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'TEXTAREA', 'KBD']);

function localizeNode(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) {
    const parent = root.parentElement;
    if (parent && !SKIP.has(parent.tagName) && !parent.closest('[data-no-i18n]')) {
      const out = zhFor(root.nodeValue ?? '');
      if (out != null && out !== root.nodeValue) root.nodeValue = out;
    }
    return;
  }
  if (!(root instanceof Element) || SKIP.has(root.tagName) || root.closest('[data-no-i18n]')) return;
  for (const a of ATTRS) {
    const v = root.getAttribute(a);
    if (v) { const out = zhFor(v); if (out != null && out !== v) root.setAttribute(a, out); }
  }
  for (const child of root.childNodes) localizeNode(child);
}

let canvasPatched = false;
/** Text drawn into 3D textures (signs, screens, monitors) goes through the same tables. */
export function localizeCanvas() {
  if (lang !== 'zh' || canvasPatched || typeof CanvasRenderingContext2D === 'undefined') return;
  canvasPatched = true;
  for (const C of [CanvasRenderingContext2D, typeof OffscreenCanvasRenderingContext2D === 'undefined' ? null : OffscreenCanvasRenderingContext2D]) {
    if (!C) continue;
    const p = C.prototype as CanvasRenderingContext2D;
    const fill = p.fillText, stroke = p.strokeText, measure = p.measureText;
    p.fillText = function (text: string, x: number, y: number, maxWidth?: number) {
      const s = tr(String(text));
      return maxWidth === undefined ? fill.call(this, s, x, y) : fill.call(this, s, x, y, maxWidth);
    };
    p.strokeText = function (text: string, x: number, y: number, maxWidth?: number) {
      const s = tr(String(text));
      return maxWidth === undefined ? stroke.call(this, s, x, y) : stroke.call(this, s, x, y, maxWidth);
    };
    p.measureText = function (text: string) { return measure.call(this, tr(String(text))); };
  }
}

let observing = false;
/** Keep every DOM string in Chinese as the game builds and rebuilds its UI. */
export function localizeDocument() {
  if (lang !== 'zh' || observing) return;
  observing = true;
  document.documentElement.lang = 'zh-CN';
  localizeNode(document.body);
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') localizeNode(r.target);
      else if (r.type === 'attributes') { if (r.target instanceof Element) localizeAttrs(r.target); }
      else for (const n of r.addedNodes) localizeNode(n);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
function localizeAttrs(el: Element) {
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v) { const out = zhFor(v); if (out != null && out !== v) el.setAttribute(a, out); }
  }
}
