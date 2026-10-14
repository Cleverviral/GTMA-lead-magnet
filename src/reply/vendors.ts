// Calls one data_tools tool for a generation_time input. The tool row supplies method, path and
// credential_ref (a pointer to an env var); only each vendor's base URL and auth style live here,
// plus the native tools (no vendor endpoint) the generator runs itself.
import type { ToolRow } from '../gtma.js';
import { homepageResearch } from './homepage.js';

const VENDORS: Record<string, { base: string; auth: (key: string) => Record<string, string> }> = {
  blitz: { base: 'https://api.blitz-api.ai', auth: (key) => ({ 'x-api-key': key }) },
};

const NATIVE: Record<string, (inputs: Record<string, unknown>) => Promise<ToolOutcome>> = {
  'web.homepage_research.native': homepageResearch,
};

export type ToolOutcome = { ok: true; value: unknown } | { ok: false; reason: string };

// credential_ref is a pointer, never a secret: 'BLITZ_API_KEY' or 'ENV:NE_API_KEY' both name an env var.
export function resolveCredential(ref: string | null | undefined): string | undefined {
  if (!ref) return undefined;
  return process.env[ref.replace(/^ENV:/i, '').trim()] || undefined;
}

// The vendor echoes the request identity and a `found` flag; the stored value is everything else
// (e.g. {distribution, total_employees}), matching what GTMA's own enrichment runs store.
export function toStoredValue(response: Record<string, unknown>, inputKeys: string[]): unknown {
  const value = Object.fromEntries(Object.entries(response).filter(([k]) => k !== 'found' && !inputKeys.includes(k)));
  return Object.keys(value).length ? value : null;
}

export async function callTool(tool: ToolRow, inputs: Record<string, unknown>): Promise<ToolOutcome> {
  if (tool.status !== 'active') return { ok: false, reason: `tool ${tool.tool_id} is ${tool.status}` };
  const native = NATIVE[tool.tool_id];
  const vendor = VENDORS[tool.vendor];
  if (!native && (!vendor || !tool.method || !tool.path)) return { ok: false, reason: `tool ${tool.tool_id} is not callable by the generator yet` };
  const key = resolveCredential(tool.credential_ref);
  if (tool.credential_ref && !key) return { ok: false, reason: `credential ${tool.credential_ref} is not configured on the generator` };

  if (native) {
    try {
      return await native(inputs);
    } catch (e) {
      return { ok: false, reason: `${tool.tool_id} failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  let res: Response;
  try {
    res = await fetch(vendor!.base + tool.path, {
      method: tool.method!,
      headers: { ...vendor!.auth(key ?? ''), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: tool.method === 'GET' ? undefined : JSON.stringify(inputs),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    return { ok: false, reason: `${tool.tool_id} unreachable: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!res.ok) {
    await res.body?.cancel();
    return { ok: false, reason: `${tool.tool_id} returned HTTP ${res.status}` };
  }
  const json = (await res.json()) as Record<string, unknown>;
  if (json.found === false) return { ok: false, reason: `${tool.tool_id} found no data for this entity` };
  const value = toStoredValue(json, Object.keys(inputs));
  return value === null ? { ok: false, reason: `${tool.tool_id} returned an empty result` } : { ok: true, value };
}
