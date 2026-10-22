import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import type { PageContent, LogoResult } from '../src/types.js';

// logo.ts pulls in db.ts -> config.ts; the postgres client is lazy, so dummy values are enough.
process.env.DATABASE_URL ||= 'postgres://u:p@localhost:5432/x';
process.env.GTMA_DATABASE_URL ||= 'postgres://u:p@localhost:5432/x';
process.env.SERVICE_API_KEY ||= 'test';
process.env.OPENAI_API_KEY ||= 'test';

const { parseManifestTable, resolveInputs } = await import('../src/manifest.js');
const { noDashes, spellCode } = await import('../src/text.js');
const { untracedNumbers, unformattedNumbers, runCustomChecks, isFlagged } = await import('../src/custom/checks.js');
const { renderPage, cta, companySlug, pageToken, HOUSE_DEFAULT, TRANSPARENCY_TEXT } = await import('../src/custom/render.js');
const { colorsFrom, paletteFrom, pickBrand, gate, DEFAULT_COLORS } = await import('../src/brand.js');
const { externalSpec, requestValues } = await import('../src/external/run.js');
const { isRelatedManifest, splitManifest, rawCandidates } = await import('../src/related/finders.js');
const { validate, candidates, normalizeDomain } = await import('../src/logo.js');
const { BuildPayload, ReplyRequest } = await import('../src/contract.js');
const { toStoredValue, resolveCredential } = await import('../src/reply/vendors.js');

const kit = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const recipe = fs.readFileSync(path.join(kit, 'example-recipe-custom.md'), 'utf8');
const sample = JSON.parse(fs.readFileSync(path.join(kit, 'sample-payload-build-previews.json'), 'utf8'));
sample.recipe.skill_md = recipe;
const payload = BuildPayload.parse({ ...sample, idempotency_key: 'k' });
const fixture = payload.fixtures[0]!;

test('manifest is parsed from the recipe table', () => {
  const m = parseManifestTable(recipe)!;
  assert.deepEqual(m.map((e) => e.key), [
    'company_domain', 'company_name', 'company_industry', 'company_employee_count',
    'company_dept_distribution', 'company_country_distribution', 'person_full_name',
  ]);
  assert.ok(m.every((e) => e.required && e.fallback === null));
});

test('inputs resolve from fixture inputs and company facts; a missing required one is reported', () => {
  const m = parseManifestTable(recipe)!;
  const ok = resolveInputs(m, fixture, {});
  assert.deepEqual(ok.missingRequired, []);
  assert.equal(ok.values.company_domain, 'datastax.com');
  assert.equal(ok.values.company_employee_count, 375);

  const broken = { ...fixture, inputs: { ...fixture.inputs, company_dept_distribution: { distribution: [] } } };
  assert.deepEqual(resolveInputs(m, broken, {}).missingRequired, ['company_dept_distribution']);
});

test('optional inputs use the manifest fallback', () => {
  const r = resolveInputs([{ key: 'title_choice', required: false, fallback: '1' }], fixture, {});
  assert.deepEqual(r.values, { title_choice: '1' });
  assert.deepEqual(r.usedFallback, ['title_choice']);
});

test('dashes are removed and codes spelled out', () => {
  assert.equal(noDashes('Growth — fast'), 'Growth, fast');
  assert.equal(noDashes('10–20 people'), '10 to 20 people');
  assert.equal(spellCode('GB'), 'United Kingdom');
  assert.equal(spellCode('Engineering'), 'Engineering');
});

test('numbers must trace to payload values (rounding allowed)', () => {
  const sources = { fixture };
  assert.deepEqual(untracedNumbers({ t: 'IT is 38.6% (107 people) of 277' }, sources), []);
  assert.deepEqual(untracedNumbers({ t: 'grew 999 roles' }, sources), [999]);
  // "2 million+" in the prospect's own text may be written out on the page.
  assert.deepEqual(untracedNumbers('reached 2,000,000 people, aiming for 100,000,000', { about: 'touched 2 million+ lives; 100 million+ next' }), []);
  assert.deepEqual(untracedNumbers('reached 3,000,000 people', { about: 'touched 2 million+ lives' }), [3000000]);
});

const content: PageContent = {
  missing_required_inputs: [],
  page_title: 'Signal map for DataStax',
  topbar_label: 'Data Magnet · signal map for',
  headline: 'Prepared for Ryan at DataStax',
  subheadline: 'People signals worth tracking at DataStax.',
  blocks: [
    { type: 'stats', items: [{ value: '375', label: 'people on LinkedIn' }] },
    { type: 'section', heading: 'By country', intro: null },
    {
      type: 'bars',
      heading: null,
      base: 'Country shares below are of the 277 profiles with a known country.',
      scale: 'percent',
      items: [{ label: 'United States', value: 61.01, display: '169 (61.01%)' }],
    },
    { type: 'cards', items: [{ title: 'New hires in Information Technology', body: '107 people, 38.63%.' }] },
  ],
  actions: [
    { title: 'Time your outreach', body: 'Reach the Information Technology team (107 people) when they add people.', team: 'Information Technology' },
    { title: 'Prioritise accounts', body: 'Point your Sales & Business Development conversations at where that team sits.', team: 'Sales & Business Development' },
  ],
  proof_heading: 'Why teams pick Data Magnet',
  proofpoint_indexes: [],
  closing_heading: 'Want this map live?',
  closing_body: 'Book 15 minutes with us and we will set it up for DataStax.',
};

// The prospect's own colour, as the brand pull would return it (ruling 89).
const PROSPECT_COLORS = colorsFrom(paletteFrom('#16a34a', 'theme_color', '#16a34a', []));
type Overrides = {
  client?: typeof payload.client; logo?: LogoResult; c?: PageContent; p?: Partial<typeof payload>; fx?: typeof fixture;
  related?: boolean; colors?: typeof PROSPECT_COLORS;
};

function renderAndCheck({ client = payload.client, logo = { ok: false, reason: 'test' } as LogoResult, c = content, p: extra = {}, fx = fixture, related = false, colors = PROSPECT_COLORS }: Overrides = {}) {
  const p = { ...payload, ...extra, client };
  const ctaInfo = cta(client)!;
  const resolved = resolveInputs(parseManifestTable(recipe), fx, {});
  const { html, carousel } = renderPage({ content: c, payload: p, fixture: fx, logo, colors, ctaInfo });
  return { html, carousel, ...runCustomChecks({ html, content: c, payload: p, fixture: fx, resolved, logo, colors, ctaInfo, carousel, related }) };
}

test('a well-formed page passes every always-rule check', () => {
  const { checks, notes, html } = renderAndCheck();
  const failing = Object.entries(checks).filter(([k, v]) => isFlagged(k, v));
  assert.deepEqual(failing, [], notes.join('\n'));
  assert.ok(html.includes('#16a34a'));
  assert.ok(!html.includes('class="plogo'), 'no logo -> tile hidden');
});

test('v3 page rules: transparency block, could-do section, one-line footer, no source line', () => {
  const { html, checks } = renderAndCheck();
  assert.ok(html.includes(TRANSPARENCY_TEXT));
  assert.ok(html.includes('What DataStax could do with this'));
  assert.match(html, /<footer>Prepared by Data Magnet · datamagnet\.co for Ryan, DataStax\.<\/footer>/);
  assert.ok(!/Source:/.test(html));
  assert.equal(checks.one_line_footer, true);
  assert.equal(checks.transparency_block, true);
});

test('no prospect colour passing the check renders the ember-orange default (never grey)', () => {
  const { html, checks } = renderAndCheck({ colors: DEFAULT_COLORS });
  assert.ok(html.includes(`--a:${HOUSE_DEFAULT.accent};`));
  assert.equal(checks.default_palette_used, true);
  assert.equal(checks.prospect_brand_colors, true);
  assert.equal(renderAndCheck().checks.default_palette_used, false);
});

test('the prospect colour comes from theme-color, then the CSS; presets and greys never count', async () => {
  const fromMeta = await pickBrand('<meta name="theme-color" content="#1d4ed8">', '', null);
  assert.equal(fromMeta.source, 'theme_color');
  assert.equal(fromMeta.accent, '#1d4ed8');
  // a WordPress preset and a grey fail the gate; the brand CSS variable wins
  const fromCss = await pickBrand('<meta name="theme-color" content="#0073aa"><meta name="theme-color" content="#888888">', ':root{--brand-primary:#7c3aed}', null);
  assert.equal(fromCss.source, 'css_brand_variable');
  const nothing = await pickBrand('', 'body{color:#333}', null);
  assert.equal(nothing.source, 'default');
  assert.equal(nothing.accent, HOUSE_DEFAULT.accent);
  // a light brand colour is darkened in its own hue until white text reads on it
  const darkened = gate('#38bdf8');
  assert.ok(darkened && darkened !== '#38bdf8');
  assert.equal(gate('#f5f5f5'), null);
});

test('page links are the company name plus a short random code', () => {
  assert.equal(companySlug('Millennium Information Services, Inc.'), 'millennium-information-services');
  assert.equal(companySlug('Lovesac Store Co.'), 'lovesac-store');
  assert.equal(companySlug('Société Générale'), 'societe-generale');
  assert.equal(companySlug('株式会社'), 'page');
  assert.match(pageToken('Datassential'), /^datassential-[a-z2-9]{6}$/);
  assert.notEqual(pageToken('Datassential'), pageToken('Datassential'));
});

test('bottom of the page: transparency line, case studies, "Book a call with us", footer; centred and bold', () => {
  const { html, checks } = renderAndCheck();
  assert.ok(html.indexOf('class="tblock"') < html.indexOf('class="carousel"'));
  assert.ok(html.indexOf('class="carousel"') < html.indexOf('class="cta"'));
  assert.ok(html.indexOf('class="cta"') < html.indexOf('<footer>'));
  assert.ok(html.includes('Book a call with us →'));
  assert.equal(checks.bottom_order, true);
  assert.equal(checks.closing_centred_bold, true);
  assert.equal(checks.no_client_logo, true);
});

test('the booking contact is never named on the page', () => {
  const named: PageContent = { ...content, closing_body: 'Book time with Mayank.' };
  const { checks } = renderAndCheck({ c: named, client: { ...payload.client, booking_poc_name: 'Mayank' } });
  assert.equal(checks.cta_about_next_step_not_a_person, false);
});

test('carousel: case studies first, then the client resources, otherwise omitted and flagged', () => {
  const withProof = renderAndCheck({ p: { proofpoints: [{ kind: 'case_study', statement: 'Acme cut refresh time in half.' }] } });
  assert.equal(withProof.carousel.kind, 'proofpoints');
  const withResources = renderAndCheck();
  assert.equal(withResources.carousel.kind, 'resources');
  assert.ok(withResources.html.includes('href="https://docs.datamagnet.co"'));
  assert.ok(withResources.html.includes('Resources from Data Magnet'));
  const none = renderAndCheck({ p: { resources: [] } });
  assert.equal(none.carousel.kind, 'none');
  assert.equal(none.checks.carousel_present, false);
});

test('an action naming a catch-all team, a bare 4-digit number and a gendered pronoun are caught', () => {
  const bad: PageContent = {
    ...content,
    blocks: [...content.blocks, { type: 'paragraph', text: 'Her team has 3534 people and it is growing.' }],
    actions: [{ title: 'Grow', body: 'Talk to General Business & Management.', team: 'General Business & Management' }],
  };
  const { checks } = renderAndCheck({ c: bad });
  assert.equal(checks.action_names_a_buyer_team, false);
  assert.equal(checks.so_what_section, false);
  assert.equal(checks.consistent_thousands, false);
  assert.equal(checks.no_gendered_pronoun, false);
  assert.equal(checks.no_trend_overclaim, false);
});

test('standard names like ISO 27001 are not counts that need thousands separators', () => {
  assert.deepEqual(unformattedNumbers('Certified to ISO 9001 and ISO/IEC 27001, SOC 2 audited.'), []);
  assert.deepEqual(unformattedNumbers('A team of 3534 people.'), ['3534']);
});

test('a passing logo is shown in the tile', () => {
  const { checks, html } = renderAndCheck({ logo: { ok: true, source: 'site_icon', dataUri: 'data:image/png;base64,AAAA', hasTransparency: true } });
  assert.ok(html.includes('class="plogo pad"'));
  assert.equal(checks.logo_gate_respected, true);
});

test('missing booking link falls back to the client website and is flagged', () => {
  const { checks } = renderAndCheck({ client: { ...payload.client, booking_url: null } });
  assert.equal(checks.cta_fallback_used, true);
  assert.equal(checks.cta_about_next_step_not_a_person, true);
  assert.equal(checks.cta_top_and_bottom, true);
});

test('invented numbers and raw codes are caught', () => {
  const bad: PageContent = {
    ...content,
    blocks: [
      { type: 'bars', heading: null, base: null, scale: 'relative', items: [{ label: 'GB', value: 23, display: '23' }] },
      { type: 'paragraph', text: 'They will hire 4321 people.' },
    ],
  };
  const { checks } = renderAndCheck({ c: bad });
  assert.equal(checks.codes_spelled_out, false);
  assert.equal(checks.numbers_traceable, false);
});

test('model text is escaped, never injected as HTML', () => {
  const evil: PageContent = { ...content, headline: '<script>alert(1)</script>' };
  const { html } = renderAndCheck({ c: evil });
  assert.ok(!html.includes('<script>'));
});

const png = (w: number, h: number, flat = false): Promise<Buffer> =>
  sharp({ create: { width: w, height: h, channels: 4, background: { r: 20, g: 120, b: 60, alpha: 1 } } })
    .composite(flat ? [] : [{ input: Buffer.from(`<svg width="${w}" height="${h}"><circle cx="${w / 2}" cy="${h / 2}" r="${w / 4}" fill="white"/></svg>`), top: 0, left: 0 }])
    .png()
    .toBuffer();

test('logo quality gate', async () => {
  assert.equal((await validate(await png(128, 128))).ok, true);
  const tooSmall = await validate(await png(48, 48));
  assert.match(tooSmall.ok ? '' : tooSmall.reason, /too small/);
  const notSquare = await validate(await png(200, 100));
  assert.match(notSquare.ok ? '' : notSquare.reason, /not square/);
  const blank = await validate(await png(128, 128, true));
  assert.match(blank.ok ? '' : blank.reason, /blank/);
  const notImage = await validate(Buffer.from('<html>nope</html>'));
  assert.equal(notImage.ok ? '' : notImage.reason, 'not an image');
});

test('icon candidates prefer apple-touch-icon, then large icons, then the root fallback', () => {
  const html = '<link rel="icon" href="/fav16.png" sizes="16x16"><link rel="icon" href="/big.png" sizes="192x192"><link rel="apple-touch-icon" href="/apple.png">';
  assert.deepEqual(candidates(html, 'https://acme.com/'), ['https://acme.com/apple.png', 'https://acme.com/big.png', 'https://acme.com/apple-touch-icon.png']);
  assert.equal(normalizeDomain('https://www.Acme.com/about'), 'acme.com');
  assert.equal(normalizeDomain('localhost'), null);
});

test('a Blitz response is stored without its echo and found flag (same shape GTMA stores)', () => {
  const res = { found: true, company_linkedin_url: 'https://www.linkedin.com/company/x', total_employees: 189, distribution: [{ department: 'IT', count: 26 }] };
  assert.deepEqual(toStoredValue(res, ['company_linkedin_url']), { total_employees: 189, distribution: [{ department: 'IT', count: 26 }] });
  assert.equal(toStoredValue({ found: true, company_linkedin_url: 'x' }, ['company_linkedin_url']), null);
});

test('the reply request needs only the lead reference', () => {
  const ok = ReplyRequest.parse({ sequencer: 'email_bison', sequencer_campaign_id: 107, sequencer_lead_id: '103430' });
  assert.equal(ok.sequencer_campaign_id, '107');
  assert.equal(ReplyRequest.safeParse({ sequencer: 'email_bison', sequencer_campaign_id: '107' }).success, false);
  // the contract's names for the same fields
  const v5 = ReplyRequest.parse({ sequencer: 'email_bison', campaign_id: '107', lead_id: 103430, reply_id: 42 });
  assert.equal(v5.sequencer_campaign_id, '107');
  assert.equal(v5.sequencer_lead_id, '103430');
});

const externalPayload = (integration: Record<string, unknown>, outputContract: Record<string, unknown> = {}) =>
  BuildPayload.parse({
    ...sample,
    idempotency_key: 'k',
    recipe: { ...sample.recipe, output_contract: { deliverable: 'html_link', ...outputContract } },
    magnet: { ...sample.magnet, kind: 'external', integration: { base_url: 'http://localhost:8790', credential: 'test-key-123', ...integration } },
  });

test('external setup: the frozen recipe carries the mapping and link field; unsupported logins stop', () => {
  const frozen = {
    method: 'POST', header: 'x-api-key', link_field: 'report_url',
    request_mapping: [
      { field: 'company_domain', data_key: 'company_domain' },
      { field: 'industry', data_key: 'company_industry' },
      { field: 'employee_count', data_key: 'company_employee_count' },
    ],
  };
  const spec = externalSpec(externalPayload({ auth_kind: 'api_key', endpoint_path: '/v1/reports' }, frozen));
  assert.ok(!('error' in spec), JSON.stringify(spec));
  if ('error' in spec) return;
  const { body, missing } = requestValues(spec, fixture, { values: {}, missingRequired: [], usedFallback: [] }, {});
  assert.deepEqual(missing, []);
  assert.deepEqual(body, { company_domain: 'datastax.com', industry: fixture.company.industry, employee_count: 375 });
  for (const auth_kind of ['oauth2', 'none']) {
    const s = externalSpec(externalPayload({ auth_kind, endpoint_path: '/v1/reports' }, frozen));
    assert.ok('error' in s && /login method isn't supported/.test(s.error));
  }
  const noLink = externalSpec(externalPayload({ auth_kind: 'bearer', endpoint_path: '/v1/reports' }, { ...frozen, link_field: undefined }));
  assert.ok('error' in noLink && /link field/.test(noLink.error));
});

test('credential pointers resolve to env vars, with or without the ENV: prefix, never to a literal', () => {
  process.env.TEST_TOOL_KEY = 'secret-123';
  assert.equal(resolveCredential('TEST_TOOL_KEY'), 'secret-123');
  assert.equal(resolveCredential('ENV:TEST_TOOL_KEY'), 'secret-123');
  assert.equal(resolveCredential('ENV:NOT_SET_ANYWHERE'), undefined);
  assert.equal(resolveCredential(null), undefined);
});

test('a magnet is about related companies exactly when its inputs list a finder key', () => {
  const m = [
    { key: 'company_domain', source: 'lead_list', required: true },
    { key: 'company_case_study_customers', source: 'generation_time', required: false },
    { key: 'company_target_market', source: 'generation_time', required: false },
    { key: 'company_dept_distribution', source: 'generation_time', required: false },
  ];
  assert.equal(isRelatedManifest(m), true);
  assert.equal(isRelatedManifest(m.filter((e) => !e.key.startsWith('company_case') && !e.key.startsWith('company_target'))), false);
  const split = splitManifest(m, true);
  assert.deepEqual(split.prospect.map((e) => e.key), ['company_domain']);
  assert.deepEqual(split.perCompany.map((e) => e.key), ['company_dept_distribution']);
  assert.deepEqual(splitManifest(m, false).perCompany, []);
});

test('finder 1 reads customer names from case-study slugs, logo alt text and story headlines; press logos never count', () => {
  const page = {
    url: 'https://www.acme.com/customers/',
    html: `<a href="/case-studies/general-mills/">x</a><img alt="Gallo logo"><img alt="Acme logo"><img alt="Forbes">
           <img alt="arrow"><h3>How Lovesac built a cleaner supply chain</h3><img alt="The Wall Street Journal">`,
  };
  const names = rawCandidates('acme.com', [page]);
  assert.ok(names.includes('General Mills'));
  assert.ok(names.includes('Gallo'));
  assert.ok(names.includes('Lovesac'));
  for (const n of ['Acme', 'Forbes', 'arrow', 'The Wall Street Journal']) assert.ok(!names.includes(n), n);
});

test('a related company card shows its honest label and headcount from the finder, and the related checks pass', () => {
  const fx = {
    ...fixture,
    related_companies: [
      { name: 'General Mills', domain: 'generalmills.com', linkedin_url: 'https://www.linkedin.com/company/general-mills', industry: 'Manufacturing', employee_count: 25163, hq_country: 'United States', found_by: 'case_study' as const, like: null, inputs: {}, unavailable_inputs: [] },
      { name: 'GALLO', domain: 'gallo.com', linkedin_url: 'https://www.linkedin.com/company/gallo', industry: 'Beverage Manufacturing', employee_count: 5469, hq_country: 'United States', found_by: 'case_study' as const, like: null, inputs: {}, unavailable_inputs: [] },
      { name: 'Patagonia', domain: 'patagonia.com', linkedin_url: 'https://www.linkedin.com/company/patagonia', industry: 'Retail', employee_count: 9000, hq_country: 'United States', found_by: 'lookalike' as const, like: 'Lovesac', inputs: {}, unavailable_inputs: [] },
    ],
  };
  const card = (index: number) => ({
    type: 'company' as const, index, base: 'Team shares below are of the 2,181 profiles with a known team.',
    items: [{ label: 'Sales & Business Development', value: 21.2, display: '462 (21.2%)' }], note: 'Watch new hires in Sales & Business Development.',
  });
  const c: PageContent = { ...content, blocks: [{ type: 'section', heading: 'Hiring at companies you work with', intro: null }, card(0), card(1), card(2)] };
  const { html, checks } = renderAndCheck({ c, fx, related: true });
  assert.ok(html.includes('From your case studies'));
  assert.ok(html.includes('Similar to Lovesac'));
  assert.ok(html.includes('<b>25,163</b> people on LinkedIn'));
  for (const k of ['three_related_companies', 'prospect_not_a_subject', 'honest_source_label', 'every_related_company_shown', 'shares_base_stated']) {
    assert.equal(checks[k], true, k);
  }
});
