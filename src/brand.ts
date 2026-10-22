// The PROSPECT's brand colour for a custom page (ruling 89), ported from
// skills/fetch_brand_colors.py. First usable colour wins:
//   1. <meta name="theme-color"> (or msapplication-TileColor) on the homepage
//   2. the main colour of the prospect's logo (the logo kit's file)
//   3. a CSS custom property named like the brand (--primary, --brand, --accent, ...)
//   4. the most used colour across the homepage's CSS (at least 5 uses)
// Website-builder and widget presets never count. Every candidate goes through the gate: a real
// colour (saturation >= 0.30, lightness 0.15 to 0.80), darkened in its own hue until white text
// reads on it (contrast 3:1). Nothing passes -> the ember-orange default.
//
// Cached in memory per domain (30 days found, 7 days fallback). Kept out of the database on
// purpose: no new tables (the service's storage shares GTMA's production database).
import sharp from 'sharp';
import { getPublic, normalizeDomain } from './logo.js';
import type { Colors, LogoResult } from './types.js';

export const EMBER = { accent: '#ea580c', accent2: '#f97316', tag: '#fff7ed' };
const NEUTRALS = { ink: '#111827', mut: '#64748b', line: '#e2e8f0', bg: '#f8fafc' };

const PRESETS = new Set([
  '#00d084', '#0693e3', '#9b51e0', '#cf2e2e', '#ff6900', '#fcb900', '#7bdcb5', '#8ed1fc',
  '#abb8c3', '#f78da7', '#eb144c', '#313131', '#32373c', '#0073aa', '#005177', '#2271b1',
  '#135e96', '#1e73be', '#007bff', '#6c757d', '#28a745', '#dc3545', '#ffc107', '#17a2b8',
  '#0d6efd', '#198754', '#0dcaf0', '#6610f2', '#6f42c1', '#d63384', '#fd7e14', '#20c997',
  '#da532c', '#2b5797', '#00aba9', '#2d89ef', '#603cba', '#9f00a7', '#b91d47', '#ffc40d',
  '#1e7145', '#ee1111', '#5897fb', '#3875d7',
]);
const BRAND_VAR = /--[\w-]*(?:primary|brand|accent|main|theme)[\w-]*\s*:\s*(#[0-9a-fA-F]{3,6}\b|rgba?\([^)]*\))/g;

export function toHex(v: string): string | null {
  const s = v.trim().toLowerCase();
  const h = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/)?.[1];
  if (h) return '#' + (h.length === 3 ? [...h].map((c) => c + c).join('') : h);
  const m = s.match(/^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)(?:[ ,/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    if (m[4] && !m[4].endsWith('%') && Number(m[4]) < 0.5) return null;
    return '#' + [m[1], m[2], m[3]].map((x) => Math.min(255, Number(x)).toString(16).padStart(2, '0')).join('');
  }
  return null;
}

const rgb = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];

// Same maths as Python's colorsys.rgb_to_hls / hls_to_rgb.
function rgbToHls([r, g, b]: [number, number, number]): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, l, 0];
  const d = max - min;
  const s = l <= 0.5 ? d / (max + min) : d / (2 - max - min);
  const rc = (max - r) / d;
  const gc = (max - g) / d;
  const bc = (max - b) / d;
  const h = r === max ? bc - gc : g === max ? 2 + rc - bc : 4 + gc - rc;
  return [(((h / 6) % 1) + 1) % 1, l, s];
}

function hlsToRgb(h: number, l: number, s: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const m2 = l <= 0.5 ? l * (1 + s) : l + s - l * s;
  const m1 = 2 * l - m2;
  const v = (hue: number): number => {
    const x = ((hue % 1) + 1) % 1;
    if (x < 1 / 6) return m1 + (m2 - m1) * x * 6;
    if (x < 0.5) return m2;
    if (x < 2 / 3) return m1 + (m2 - m1) * (2 / 3 - x) * 6;
    return m1;
  };
  return [v(h + 1 / 3), v(h), v(h - 1 / 3)];
}

const fromRgb = (c: [number, number, number]): string => '#' + c.map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');

function luminance(h: string): number {
  const c = rgb(h).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
export const contrastWithWhite = (h: string): number => 1.05 / (luminance(h) + 0.05);

// null if unusable, else the (possibly darkened) colour.
export function gate(input: string | null): string | null {
  if (!input || PRESETS.has(input)) return null;
  let h = input;
  const [hh, l0, s] = rgbToHls(rgb(h));
  let l = l0;
  if (s < 0.3 || l < 0.15 || l > 0.8) return null;
  while (contrastWithWhite(h) < 3 && l > 0.15) {
    l -= 0.03;
    h = fromRgb(hlsToRgb(hh, l, s));
  }
  return contrastWithWhite(h) >= 3 ? h : null;
}

const shade = (h: string, lNew: number, sScale = 1): string => {
  const [hh, , s] = rgbToHls(rgb(h));
  return fromRgb(hlsToRgb(hh, lNew, Math.min(1, s * sScale)));
};

async function logoColour(png: Buffer): Promise<string | null> {
  try {
    const { data } = await sharp(png).ensureAlpha().resize(64, 64, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
    const counts = new Map<string, number>();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! < 128) continue;
      const hx = '#' + [data[i]!, data[i + 1]!, data[i + 2]!].map((c) => (Math.floor(c / 8) * 8).toString(16).padStart(2, '0')).join('');
      if (gate(hx)) counts.set(hx, (counts.get(hx) ?? 0) + 1);
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return best && best[1] >= 40 ? best[0] : null;
  } catch {
    return null;
  }
}

export interface BrandPalette {
  accent: string;
  accent2: string;
  tag: string;
  source: 'theme_color' | 'logo' | 'css_brand_variable' | 'css_most_used' | 'default';
  picked: string | null;
  tried: string[];
}

export function paletteFrom(colour: string, source: BrandPalette['source'], picked: string, tried: string[]): BrandPalette {
  const [, l] = rgbToHls(rgb(colour));
  return { accent: colour, accent2: shade(colour, Math.min(0.62, l + 0.12)), tag: shade(colour, 0.96, 0.6), source, picked, tried };
}

// Pure part, testable without the network: pick the colour from the page and its CSS.
export async function pickBrand(html: string, css: string, logoPng: Buffer | null): Promise<BrandPalette> {
  const tried: string[] = [];
  const cands: [BrandPalette['source'], string | null][] = [];
  for (const m of html.matchAll(/<meta[^>]+name=["'](?:theme-color|msapplication-TileColor)["'][^>]*content=["']([^"']+)/gi)) {
    cands.push(['theme_color', toHex(m[1]!)]);
  }
  if (logoPng) cands.push(['logo', await logoColour(logoPng)]);
  for (const m of css.matchAll(BRAND_VAR)) cands.push(['css_brand_variable', toHex(m[1]!)]);
  const freq = new Map<string, number>();
  for (const v of css.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]*\)/g) ?? []) {
    const h = toHex(v);
    if (h && gate(h)) freq.set(h, (freq.get(h) ?? 0) + 1);
  }
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= 5) cands.push(['css_most_used', top[0]]);

  for (const [source, h] of cands) {
    const g = gate(h);
    tried.push(`${source}:${h}${g ? '' : ' (failed gate)'}`);
    if (g) return paletteFrom(g, source, h!, tried);
  }
  return { ...EMBER, source: 'default', picked: null, tried };
}

async function fetchCss(html: string, base: string): Promise<string> {
  let css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join(' ');
  const hrefs = [...html.matchAll(/<link[^>]+rel=["']?stylesheet["']?[^>]*href=["']([^"']+)/gi)].map((m) => m[1]!).slice(0, 4);
  const sheets = await Promise.all(
    hrefs.map(async (href) => {
      try {
        const r = await getPublic(new URL(href, base).toString(), 800_000, 10_000);
        return r.status === 200 ? r.data.toString('utf8') : '';
      } catch {
        return '';
      }
    }),
  );
  css += ' ' + sheets.join(' ');
  return css;
}

const cache = new Map<string, { at: number; value: BrandPalette }>();
const DAY = 86_400_000;

export async function prospectPalette(rawDomain: unknown, logo: LogoResult): Promise<BrandPalette> {
  const domain = normalizeDomain(rawDomain);
  if (!domain) return { ...EMBER, source: 'default', picked: null, tried: ['no valid domain'] };
  const hit = cache.get(domain);
  if (hit && Date.now() - hit.at < (hit.value.source === 'default' ? 7 : 30) * DAY) return hit.value;

  let html = '';
  let css = '';
  const tried: string[] = [];
  try {
    const home = await getPublic(`https://${domain}/`, 1_500_000);
    html = home.data.toString('utf8');
    css = await fetchCss(html, home.finalUrl);
  } catch (e) {
    tried.push(`homepage failed (${e instanceof Error ? e.message : String(e)})`);
  }
  const png = logo.ok ? Buffer.from(logo.dataUri.split(',')[1] ?? '', 'base64') : null;
  const value = await pickBrand(html, css, png);
  value.tried = [...tried, ...value.tried];
  cache.set(domain, { at: Date.now(), value });
  return value;
}

export function colorsFrom(p: BrandPalette): Colors {
  return { fromProspect: p.source !== 'default', source: p.source, accent: p.accent, accent2: p.accent2, tag: p.tag, ...NEUTRALS };
}

export const DEFAULT_COLORS: Colors = colorsFrom({ ...EMBER, source: 'default', picked: null, tried: [] });
