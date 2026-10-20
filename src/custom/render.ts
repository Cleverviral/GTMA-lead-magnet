// The design shell for every custom page (design bundle v3, rulings 38-45 and 54-71). Layout and
// CSS follow the reference build (magnet-service-tool-kit/related-companies-test/e2e_related.py).
// Everything the rules fix (palette, logo tile, CTAs, company-card labels, "could do" heading,
// carousel, transparency block, footer) is drawn here in code, never by the model.
import { isHttpUrl } from '../contract.js';
import { esc } from '../text.js';
import type { Colors, ContentBlock, CtaInfo, Fixture, LogoResult, PageContent, Payload, RelatedCompany } from '../types.js';

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

// Ruling 54b: the house default palette is EMBER ORANGE, used when the client chose
// "no brand colours in mind" (stored as {"default": true}) or has none. Never a grey page.
export const HOUSE_DEFAULT = {
  accent: '#ea580c',
  accent2: '#f97316',
  tag: '#fff7ed',
  ink: '#111827',
  mut: '#64748b',
  line: '#e2e8f0',
  bg: '#f8fafc',
};

// Ruling 65b: exactly this, nothing more.
export const TRANSPARENCY_TEXT = 'This is auto-generated and reviewed by our team. Happy to dive deeper on our introduction call.';

export const RELATED_TAG: Record<RelatedCompany['found_by'], (rc: RelatedCompany) => string> = {
  case_study: () => 'From your case studies',
  lookalike: (rc) => (rc.like ? `Similar to ${rc.like}` : 'Similar to your customers'),
  target_market: () => 'In your market',
};

type ClientLike = Payload['client'];

function tint(hex: string, amount = 0.9): string {
  const h = hex.length === 4 ? hex.replace(/^#(.)(.)(.)$/, '#$1$1$2$2$3$3') : hex.slice(0, 7);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (c: number) => Math.round(c + (255 - c) * amount).toString(16).padStart(2, '0');
  return `#${mix(r!)}${mix(g!)}${mix(b!)}`;
}

// Rule 1: palette = the CLIENT's brand_colors when it has a usable accent; otherwise the whole
// house default (a half-client, half-default page would look broken).
export function palette(brandColors: Record<string, unknown> = {}): Colors {
  const pick = (k: string): string | null => {
    const v = brandColors[k];
    return typeof v === 'string' && HEX.test(v) ? v : null;
  };
  const accent = pick('accent') ?? pick('primary');
  if (!accent || brandColors.default === true) return { fromClient: false, ...HOUSE_DEFAULT };
  return {
    fromClient: true,
    accent,
    accent2: pick('accent2') ?? pick('secondary') ?? accent,
    tag: pick('tag') ?? tint(accent),
    ink: pick('ink') ?? pick('text') ?? HOUSE_DEFAULT.ink,
    mut: pick('mut') ?? pick('muted') ?? HOUSE_DEFAULT.mut,
    line: pick('line') ?? pick('border') ?? HOUSE_DEFAULT.line,
    bg: pick('bg') ?? pick('background') ?? HOUSE_DEFAULT.bg,
  };
}

// Rule 3: booking link + POC from the card; missing -> client website and FLAG it. Never invent.
export function cta(client: ClientLike): CtaInfo | null {
  if (isHttpUrl(client.booking_url)) {
    return { href: client.booking_url, poc: client.booking_poc_name?.trim() || null, fallbackUsed: false };
  }
  if (isHttpUrl(client.website)) return { href: client.website, poc: client.booking_poc_name?.trim() || null, fallbackUsed: true };
  return null;
}

// Numbers are formatted the same everywhere: 1,234.
export const fmt = (n: number): string => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

const CSS = `
body{margin:0;font-family:-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--ink);line-height:1.5;padding-bottom:56px}
*{box-sizing:border-box}
.wrap{max-width:760px;margin:0 auto;padding:0 16px}
.topbar{position:sticky;top:0;background:#fff;border-bottom:1px solid var(--line);z-index:5}
.topin{max-width:760px;margin:0 auto;padding:10px 16px;display:flex;align-items:center;gap:12px}
.plogo{flex:none;width:56px;height:56px;border-radius:14px;background:#fff;border:1px solid var(--line);overflow:hidden;display:grid;place-items:center}
.plogo img{width:100%;height:100%;object-fit:cover;display:block}
.plogo.pad img{object-fit:contain;padding:7px}
.topname{min-width:0}
.topname b{display:block;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.topname span{display:block;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--a);font-weight:700}
.cta-btn{margin-left:auto;flex:none;background:var(--a);color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:9px 16px;border-radius:999px;white-space:nowrap}
.cta-btn:hover{background:var(--a2)}
header{padding:30px 0 14px}
h1{font-size:30px;margin:6px 0 4px;line-height:1.15}
.sub{color:var(--mut);margin:0}
h2{font-size:19px;margin:30px 0 12px;border-left:4px solid var(--a);padding-left:10px}
.intro{color:var(--mut);margin:-4px 0 12px}
p.para{margin:10px 0}
.facts{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}
.fact{background:#fff;border:1px solid var(--line);border-radius:8px;padding:8px 14px;font-size:14px}
.fact b{display:block;font-size:16px}
.bars h3{font-size:15px;margin:18px 0 6px}
.base{margin:0 0 6px;font-size:12.5px;color:var(--mut)}
.row{display:grid;grid-template-columns:240px 1fr 130px;gap:10px;align-items:center;margin:7px 0;font-size:14px}
.lbl{text-align:right;color:var(--mut)}
.track{background:#e9eef3;border-radius:4px;height:12px}
.fill{background:linear-gradient(90deg,var(--a),var(--a2));height:12px;border-radius:4px;min-width:2px}
.val{white-space:nowrap}
.rc{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin:12px 0}
.rch{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.rch b{font-size:17px}
.tag{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--a);background:var(--tag);padding:2px 8px;border-radius:999px}
.hc{margin:2px 0 0;font-size:15px}
.note{margin:8px 0 0;font-size:14px}
.sig{background:#fff;border:1px solid var(--line);border-left:4px solid var(--a);border-radius:8px;padding:12px 16px;margin:10px 0}
.sig h4{margin:0 0 4px}
.sig p{margin:0;color:var(--mut);font-size:14px}
ul.lst,ol.lst{padding-left:22px;margin:10px 0}
ul.lst.check{list-style:none;padding-left:0}
ul.lst.check li::before{content:"\\2713";color:var(--a);font-weight:700;margin-right:8px}
.tbl{overflow-x:auto;margin:12px 0}
table{border-collapse:collapse;width:100%;background:#fff;font-size:14px}
th,td{border:1px solid var(--line);padding:8px 10px;text-align:left}
th{background:var(--bg);color:var(--mut);font-weight:600}
.score{background:#fff;border:1px solid var(--line);border-radius:10px;padding:16px;margin:12px 0}
.score .num{font-size:28px;font-weight:800;color:var(--a)}
.score .num span{font-size:15px;color:var(--mut);font-weight:600}
.score .track{margin:8px 0}
.callout{background:#fff;border:1px solid var(--line);border-top:4px solid var(--a);border-radius:10px;padding:14px 16px;margin:14px 0}
.acts{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.act{background:#fff;border:1px solid var(--line);border-left:4px solid var(--a);border-radius:10px;padding:14px 16px}
.act b{display:block;margin-bottom:4px}
.act p{margin:0;font-size:14px;color:var(--mut)}
.carousel{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;padding:4px 0 10px}
.ccard{display:block;background:#fff;border:1px solid var(--line);border-top:4px solid var(--a);border-radius:10px;padding:14px 16px;text-decoration:none;color:inherit}
.ccard h4{margin:0 0 4px;font-size:15px}
.ccard p{margin:0;font-size:13px;color:var(--mut)}
.tblock{display:flex;gap:12px;background:#fff;border:1px solid var(--line);border-left:4px solid var(--a);border-radius:12px;padding:16px 18px;margin-top:26px;font-weight:600;font-size:15px}
.tblock .ic{flex:none;width:22px;height:22px;border:2px solid var(--a);border-radius:50%;color:var(--a);display:grid;place-items:center;font-size:13px}
.cta{background:var(--ink);color:#fff;border-radius:12px;padding:26px 24px;margin-top:26px;text-align:center}
.cta h3{margin:0 0 6px;font-size:22px}
.cta p{margin:0 0 14px;color:#cbd5e1;font-size:14px}
.cta a{display:inline-block;background:var(--a);color:#fff;text-decoration:none;font-weight:700;padding:12px 26px;border-radius:999px}
footer{color:var(--mut);font-size:12px;margin-top:28px}
@media(max-width:560px){.row{grid-template-columns:1fr;gap:2px}.lbl{text-align:left}h1{font-size:25px}
.topname span{display:none}.plogo{width:40px;height:40px;border-radius:10px}.cta-btn{padding:8px 12px;font-size:13px}}
`;

type BarItem = { label: string; value: number; display: string };

function barRows(items: BarItem[], scale: 'percent' | 'relative'): string {
  const max = Math.max(...items.map((i) => i.value), 0) || 1;
  return items
    .map((i) => {
      const width = scale === 'percent' ? i.value : (i.value / max) * 100;
      const w = Math.max(0, Math.min(100, width)).toFixed(2);
      return `<div class="row"><div class="lbl">${esc(i.label)}</div><div class="track"><div class="fill" style="width:${w}%"></div></div><div class="val">${esc(i.display)}</div></div>`;
    })
    .join('');
}

// A related company's card (rulings 63-64). Its name, its honest "how we found it" tag and its
// LinkedIn headcount come from the finder result, never from the model.
function companyCard(b: Extract<ContentBlock, { type: 'company' }>, related: RelatedCompany[]): string {
  const rc = related[b.index];
  if (!rc) return '';
  const headcount = typeof rc.employee_count === 'number' ? `<p class="hc"><b>${fmt(rc.employee_count)}</b> people on LinkedIn</p>` : '';
  return `<div class="rc"><div class="rch"><b>${esc(rc.name)}</b><span class="tag">${esc(RELATED_TAG[rc.found_by](rc))}</span></div>${headcount}${
    b.base ? `<p class="base">${esc(b.base)}</p>` : ''
  }${barRows(b.items, 'percent')}${b.note ? `<p class="note">${esc(b.note)}</p>` : ''}</div>`;
}

function renderBlock(b: ContentBlock, related: RelatedCompany[]): string {
  switch (b.type) {
    case 'section':
      return `<h2>${esc(b.heading)}</h2>${b.intro ? `<p class="intro">${esc(b.intro)}</p>` : ''}`;
    case 'paragraph':
      return `<p class="para">${esc(b.text)}</p>`;
    case 'stats':
      return `<div class="facts">${b.items.map((i) => `<div class="fact"><b>${esc(i.value)}</b>${esc(i.label)}</div>`).join('')}</div>`;
    case 'bars':
      return `<div class="bars">${b.heading ? `<h3>${esc(b.heading)}</h3>` : ''}${b.base ? `<p class="base">${esc(b.base)}</p>` : ''}${barRows(b.items, b.scale)}</div>`;
    case 'company':
      return companyCard(b, related);
    case 'cards':
      return b.items.map((i) => `<div class="sig"><h4>${esc(i.title)}</h4><p>${esc(i.body)}</p></div>`).join('');
    case 'list': {
      const tag = b.style === 'number' ? 'ol' : 'ul';
      return `<${tag} class="lst ${b.style}">${b.items.map((i) => `<li>${esc(i)}</li>`).join('')}</${tag}>`;
    }
    case 'table':
      return `<div class="tbl"><table><thead><tr>${b.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${b.rows
        .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
        .join('')}</tbody></table></div>`;
    case 'score': {
      const pct = b.max > 0 ? Math.max(0, Math.min(100, (b.value / b.max) * 100)).toFixed(2) : '0';
      return `<div class="score"><div>${esc(b.label)}</div><div class="num">${esc(fmt(b.value))} <span>/ ${esc(fmt(b.max))}</span></div><div class="track"><div class="fill" style="width:${pct}%"></div></div><div>${esc(b.verdict)}</div></div>`;
    }
    case 'callout':
      return `<div class="callout">${esc(b.text)}</div>`;
    default:
      return '';
  }
}

export interface CarouselResult {
  kind: 'proofpoints' | 'resources' | 'none';
  cards: { title: string; body: string; url: string | null }[];
}

// Ruling 57: approved case studies first, then the client's own resources, otherwise omitted.
// Never filler derived from the magnet's own description; no source line under it (57a).
export function carouselCards(content: PageContent, payload: Pick<Payload, 'proofpoints' | 'resources'>): CarouselResult {
  const { proofpoints, resources } = payload;
  if (proofpoints.length) {
    const idx = content.proofpoint_indexes.filter((i) => Number.isInteger(i) && i >= 0 && i < proofpoints.length);
    const chosen = idx.length ? [...new Set(idx)].map((i) => proofpoints[i]!) : proofpoints;
    return { kind: 'proofpoints', cards: chosen.map((p) => ({ title: kindTitle(p.kind), body: p.statement, url: null })) };
  }
  if (resources.length) {
    return { kind: 'resources', cards: resources.map((r) => ({ title: r.title, body: r.description ?? '', url: r.url })) };
  }
  return { kind: 'none', cards: [] };
}

function kindTitle(kind: string | null | undefined): string {
  const k = (kind ?? '').replace(/_/g, ' ').trim();
  return k ? k[0]!.toUpperCase() + k.slice(1) : 'Proof';
}

export function firstName(fixture: Fixture): string {
  return (fixture.first_name ?? fixture.full_name?.split(/\s+/)[0] ?? '').trim();
}

export function siteName(website: string | null | undefined): string | null {
  return isHttpUrl(website) ? new URL(website).hostname.replace(/^www\./, '') : null;
}

// Ruling 55: one fixed line, nothing about where the data came from.
export function footerLine(client: ClientLike, fixture: Fixture, companyName: string): string {
  const site = siteName(client.website);
  return `Prepared by ${client.client_name}${site ? ` · ${site}` : ''} for ${firstName(fixture)}, ${companyName}.`;
}

export interface RenderPageArgs {
  content: PageContent;
  payload: Payload;
  fixture: Fixture;
  logo: LogoResult;
  colors: Colors;
  ctaInfo: CtaInfo;
}

export interface RenderPageResult {
  html: string;
  carousel: CarouselResult;
}

export function renderPage({ content, payload, fixture, logo, colors, ctaInfo }: RenderPageArgs): RenderPageResult {
  const { client } = payload;
  const companyName = ((fixture.company as Record<string, unknown>)?.company_name as string | undefined) ?? '';
  const related = fixture.related_companies ?? [];
  const logoHtml = logo.ok
    ? `<span class="plogo${logo.hasTransparency ? ' pad' : ''}"><img src="${logo.dataUri}" alt="${esc(companyName)} logo" width="56" height="56"></span>`
    : '';

  const actionsHtml = content.actions.length
    ? `<h2>What ${esc(companyName)} could do with this</h2><div class="acts">${content.actions
        .map((a) => `<div class="act"><b>${esc(a.title)}</b><p>${esc(a.body)}</p></div>`)
        .join('')}</div>`
    : '';

  const carousel = carouselCards(content, payload);
  const heading = carousel.kind === 'resources' ? `Resources from ${client.client_name}` : content.proof_heading;
  const carouselHtml = carousel.cards.length
    ? `<h2>${esc(heading)}</h2><div class="carousel">${carousel.cards
        .map((c) =>
          c.url
            ? `<a class="ccard" href="${esc(c.url)}" rel="noopener"><h4>${esc(c.title)}</h4>${c.body ? `<p>${esc(c.body)}</p>` : ''}</a>`
            : `<div class="ccard"><h4>${esc(c.title)}</h4><p>${esc(c.body)}</p></div>`,
        )
        .join('')}</div>`
    : '';

  const closingLabel = ctaInfo.poc ? `Book a call with ${ctaInfo.poc}` : 'Book a call';

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">
<title>${esc(content.page_title)}</title>
<style>:root{--a:${colors.accent};--a2:${colors.accent2};--tag:${colors.tag};--ink:${colors.ink};--mut:${colors.mut};--line:${colors.line};--bg:${colors.bg}}${CSS}</style>
</head><body>
<div class="topbar"><div class="topin">${logoHtml}<div class="topname"><span>${esc(content.topbar_label)}</span><b>${esc(companyName)}</b></div><a class="cta-btn" href="${esc(ctaInfo.href)}" rel="noopener">Book a call →</a></div></div>
<div class="wrap">
<header><h1>${esc(content.headline)}</h1><p class="sub">${esc(content.subheadline)}</p></header>
${content.blocks.map((b) => renderBlock(b, related)).join('\n')}
${actionsHtml}
${carouselHtml}
<div class="tblock"><span class="ic">i</span><span>${esc(TRANSPARENCY_TEXT)}</span></div>
<div class="cta"><h3>${esc(content.closing_heading)}</h3><p>${esc(content.closing_body)}</p><a href="${esc(ctaInfo.href)}" rel="noopener">${esc(closingLabel)} →</a></div>
<footer>${esc(footerLine(client, fixture, companyName))}</footer>
</div></body></html>`;
  return { html, carousel };
}
