// Mechanical checks for a custom page (design bundle v3). Booleans: true = pass, except the
// FLAG_CHECKS, which are flags (true = a fallback was used; GTMA surfaces it, the page is fine).
import { countryName, esc, visibleText } from '../text.js';
import type { Colors, CtaInfo, Fixture, LogoResult, PageContent, Payload, ResolvedInputs } from '../types.js';
import { RELATED_TAG, TRANSPARENCY_TEXT, footerLine, type CarouselResult } from './render.js';

export { FLAG_CHECKS, isFlagged } from './flags.js';

const NUM = /\d[\d,]*(?:\.\d+)?/g;
// "2 million+", "1.5bn", "40k" in source text: the page may write them out in full.
const SCALED = /(\d+(?:\.\d+)?)\s*(thousand|million|billion|k|m|mn|bn)\b/gi;
const SCALE: Record<string, number> = { thousand: 1e3, k: 1e3, million: 1e6, m: 1e6, mn: 1e6, billion: 1e9, bn: 1e9 };
const CATCH_ALL_TEAM = /general business|^\s*other\s*$|management\s*&\s*general|unknown/i;

function collectNumbers(value: unknown, out: Set<number> = new Set()): Set<number> {
  if (typeof value === 'number' && Number.isFinite(value)) out.add(value);
  else if (typeof value === 'string') {
    for (const m of value.match(NUM) ?? []) out.add(Number(m.replace(/,/g, '')));
    for (const [, n, unit] of value.matchAll(SCALED)) out.add(Math.round(Number(n) * SCALE[unit!.toLowerCase()]!));
  }
  else if (Array.isArray(value)) value.forEach((v) => collectNumbers(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectNumbers(v, out));
  return out;
}

function decimals(n: number): number {
  const s = String(n);
  return s.includes('.') ? s.split('.')[1]!.length : 0;
}

// Rule 6: every number on the page traces to a payload value (rounding allowed, new figures not).
export function untracedNumbers(content: unknown, sources: unknown): number[] {
  const known = [...collectNumbers(sources)];
  const used = collectNumbers(content);
  return [...used].filter((n) => {
    const d = decimals(n);
    return !known.some((p) => p === n || Number(p.toFixed(d)) === n);
  });
}

export function placeholderHits(text: string): string[] {
  const patterns = [/\{\{|\}\}|\{%|%\}/, /\bundefined\b/, /\bNaN\b/, /\[object Object\]/, /\bnull\b/, / None /, /<[a-z_][a-z0-9_ ]{0,30}>/i, /\b(TODO|TBD|lorem ipsum)\b/i];
  return patterns.filter((p) => p.test(text)).map(String);
}

// Numbers formatted the same everywhere: no bare 1234 once separators, decimals and years are set aside.
export function unformattedNumbers(text: string): string[] {
  const rest = text
    .replace(/\d{1,3}(?:,\d{3})+(?:\.\d+)?/g, ' ')
    .replace(/\d+\.\d+%?/g, ' ')
    .replace(/\b(?:19|20)\d\d\b/g, ' ');
  return rest.match(/\b\d{4,}\b/g) ?? [];
}

function dataLabels(content: PageContent): unknown[] {
  const labels: unknown[] = [];
  for (const b of content.blocks) {
    if (b.type === 'bars' || b.type === 'company') labels.push(...b.items.map((i) => i.label));
    if (b.type === 'table') labels.push(...b.rows.flat());
    if (b.type === 'stats') labels.push(...b.items.map((i) => i.value));
  }
  return labels;
}

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

export interface RunChecksArgs {
  html: string;
  content: PageContent;
  payload: Payload;
  fixture: Fixture;
  resolved: ResolvedInputs;
  logo: LogoResult;
  colors: Colors;
  ctaInfo: CtaInfo;
  carousel: CarouselResult;
  related: boolean;
}

export interface RunChecksResult {
  checks: Record<string, boolean>;
  notes: string[];
  untraced: number[];
}

export function runCustomChecks({ html, content, payload, fixture, resolved, logo, colors, ctaInfo, carousel, related }: RunChecksArgs): RunChecksResult {
  const text = visibleText(html);
  const company = fixture.company as Record<string, unknown>;
  const companyName = (company?.company_name as string | undefined) ?? '';
  const relatedCos = fixture.related_companies ?? [];
  const notes: string[] = [];

  // Scanned from the rendered text, not the raw content object: the object also carries fields
  // that never reach the page (e.g. proofpoint_indexes), which are not page claims.
  const untraced = untracedNumbers(text, {
    fixture,
    client: payload.client,
    play: payload.play,
    play_constants: payload.recipe.play_constants,
    proofpoints: payload.proofpoints,
    resources: payload.resources,
    magnet: { promise: payload.magnet.promise, description: payload.magnet.description },
    skill_md: payload.recipe.skill_md,
  });
  if (untraced.length) notes.push(`numbers not found in the payload: ${untraced.join(', ')}`);

  const placeholders = placeholderHits(text);
  if (placeholders.length) notes.push(`placeholder-like text: ${placeholders.join(' ')}`);

  const rawCodes = dataLabels(content).filter((l) => countryName(String(l).trim()));
  if (rawCodes.length) notes.push(`raw codes in data labels: ${rawCodes.join(', ')}`);

  const unformatted = unformattedNumbers(text);
  if (unformatted.length) notes.push(`numbers without thousands separators: ${unformatted.join(', ')}`);

  const badActions = content.actions.filter(
    (a) => !a.team.trim() || CATCH_ALL_TEAM.test(a.team) || !`${a.title} ${a.body}`.toLowerCase().includes(a.team.toLowerCase()),
  );
  if (badActions.length) notes.push(`actions without a real buying team: ${badActions.map((a) => a.title).join('; ')}`);

  const sharesWithoutBase = content.blocks.filter(
    (b) => ((b.type === 'bars' && b.scale === 'percent') || b.type === 'company') && b.items.length > 0 && !b.base?.trim(),
  );
  if (sharesWithoutBase.length) notes.push(`${sharesWithoutBase.length} share chart(s) without a stated base`);

  const footer = html.match(/<footer>([\s\S]*?)<\/footer>/)?.[1] ?? '';
  const hrefCount = html.split(`href="${esc(ctaInfo.href)}"`).length - 1;
  const hasLogoTile = html.includes('class="plogo');

  const checks: Record<string, boolean> = {
    inputs_present: resolved.missingRequired.length === 0,
    no_placeholders: placeholders.length === 0,
    prospect_named: Boolean(companyName) && text.includes(companyName) && (!fixture.first_name || text.includes(fixture.first_name)),
    client_named: text.includes(payload.client.client_name),
    client_brand_colors: html.includes(colors.accent),
    default_palette_used: !colors.fromClient,
    logo_gate_respected: logo.ok ? hasLogoTile : !hasLogoTile,
    no_em_dashes: !/[–—]/.test(text),
    cta_top_and_bottom: hrefCount >= 2 && (text.match(/Book a call/g) ?? []).length >= 2,
    poc_named_in_cta: Boolean(ctaInfo.poc) && text.includes(`Book a call with ${ctaInfo.poc}`),
    cta_fallback_used: ctaInfo.fallbackUsed,
    carousel_present: carousel.cards.length > 0,
    transparency_block: text.includes(TRANSPARENCY_TEXT),
    so_what_section: text.includes(`What ${companyName} could do with this`) && content.actions.length >= 2,
    action_names_a_buyer_team: content.actions.length > 0 && badActions.length === 0,
    one_line_footer: footer === esc(footerLine(payload.client, fixture, companyName)),
    no_internal_vocab: !/client card|recipe|magnet description|supplied for|generated from|data source/i.test(text),
    no_gendered_pronoun: !/\b(he|she|him|his|hers|her)\b/i.test(text),
    no_trend_overclaim: !/\b(?:is|are) (?:growing|shrinking|moving)\b|\bhiring is moving\b|\b(?:upward|downward|growth) trend\b|\btrending\b/i.test(text),
    shares_base_stated: sharesWithoutBase.length === 0,
    consistent_thousands: unformatted.length === 0,
    no_unknown_text: !/\bunknown\b/i.test(text),
    codes_spelled_out: rawCodes.length === 0,
    numbers_traceable: untraced.length === 0,
    noindex: /<meta name="robots" content="noindex/.test(html),
  };

  if (related) {
    const shown = new Set(content.blocks.filter((b) => b.type === 'company').map((b) => (b as { index: number }).index));
    checks.three_related_companies = relatedCos.length === 3;
    checks.prospect_not_a_subject = relatedCos.every(
      (rc) => norm(rc.name) !== norm(companyName) && (!rc.domain || norm(rc.domain) !== norm(company?.primary_domain)),
    );
    checks.honest_source_label = relatedCos.length > 0 && relatedCos.every((rc) => text.includes(rc.name) && text.includes(RELATED_TAG[rc.found_by](rc)));
    checks.every_related_company_shown = relatedCos.length > 0 && relatedCos.every((_, i) => shown.has(i));
    if (relatedCos.length < 3) notes.push(`only ${relatedCos.length} related compan${relatedCos.length === 1 ? 'y' : 'ies'} could be found`);
  }

  if (!colors.fromClient) notes.push('client has no brand colours (or chose the default): house default palette used');
  if (!checks.poc_named_in_cta) notes.push('client.booking_poc_name missing; closing CTA has no contact name');
  if (ctaInfo.fallbackUsed) notes.push('client.booking_url missing or invalid; CTA links to client.website');
  if (!checks.carousel_present) notes.push('no approved case studies and no client resources: carousel omitted');
  if (!logo.ok) notes.push(`no prospect logo (${logo.reason}); tile hidden`);
  return { checks, notes, untraced };
}
