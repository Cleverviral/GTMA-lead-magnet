import './net.js';
import crypto from 'node:crypto';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { config } from './config.js';
import { BuildPayload, isLeadReference, ReplyRequest } from './contract.js';
import { ensureSchema, pageByToken, sql } from './db.js';
import { runBuild } from './build.js';
import { produceForReply } from './reply/produce.js';
import type { BuildResponse, Endpoint } from './types.js';

const app = Fastify({
  bodyLimit: 5 * 1024 * 1024,
  logger: { redact: ['req.headers.authorization'] },
});

const keyBuf = Buffer.from(config.serviceApiKey);
function authorized(header: unknown): boolean {
  const given = Buffer.from(String(header ?? '').replace(/^Bearer\s+/i, ''));
  return given.length === keyBuf.length && crypto.timingSafeEqual(given, keyBuf);
}

const sign = (body: string): string => `sha256=${crypto.createHmac('sha256', config.serviceApiKey).update(body).digest('hex')}`;

async function postCallback(url: string, response: BuildResponse, log: FastifyRequest['log']): Promise<void> {
  const body = JSON.stringify(response);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Magnet-Signature': sign(body) },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return;
      log.warn({ status: res.status }, 'callback rejected');
    } catch (e) {
      log.warn({ err: e instanceof Error ? e.message : String(e) }, 'callback failed');
    }
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
  }
  log.error('callback gave up after 4 attempts');
}

function buildRoute(endpoint: Endpoint) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!authorized(req.headers.authorization)) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = BuildPayload.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid payload', issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    }
    const payload = parsed.data;
    if (endpoint === 'produce' && payload.fixtures.length !== 1) {
      return reply.code(400).send({ error: 'produce takes exactly one fixture' });
    }
    if (payload.callback_url) {
      runBuild(payload, endpoint)
        .then((res) => postCallback(payload.callback_url!, res, req.log))
        .catch((e: Error) => req.log.error({ err: e.message }, 'async build failed'));
      return reply.code(202).send({ accepted: true, lead_magnet_id: payload.lead_magnet_id, runtime_id: payload.runtime_id ?? null });
    }
    return runBuild(payload, endpoint);
  };
}

// Last resort: an uncaught error (a DB constraint, a bug) must never leak internals to a caller.
// Found by pressure testing — an invalid reply_id crashed with a raw Postgres FK message.
app.setErrorHandler((err, req, reply) => {
  req.log.error({ err }, 'unhandled error');
  if (reply.statusCode < 400) reply.code(500);
  return reply.send({ error: 'internal_error', message: 'the request could not be completed' });
});

const REPLY_HTTP: Record<string, number> = { not_found: 404, ambiguous: 409, held: 409 };

// Reply time: the autoresponder sends only a lead reference {sequencer, campaign_id, lead_id}
// (+ reply_id). The generator reads everything else from Postgres itself.
async function replyRoute(req: FastifyRequest, reply: FastifyReply) {
  if (!authorized(req.headers.authorization)) return reply.code(401).send({ error: 'unauthorized' });
  const parsed = ReplyRequest.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'invalid request', issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
  }
  const res = await produceForReply(parsed.data);
  return reply.code(REPLY_HTTP[res.status] ?? 200).send(res);
}

const legacyProduce = buildRoute('produce');

app.post('/magnet/build-previews', buildRoute('build-previews'));
// The contract's reply-time endpoint. A full single-fixture payload is still accepted (older callers).
app.post('/magnet/produce', (req: FastifyRequest, reply: FastifyReply) => (isLeadReference(req.body) ? replyRoute(req, reply) : legacyProduce(req, reply)));
// Same as /magnet/produce with a lead reference (kept for callers already wired to it).
app.post('/magnet/produce-for-reply', replyRoute);

app.get('/health', async () => {
  await sql`select 1`;
  return { ok: true };
});

// Hosted pages: {hosted_base_url}/{company-slug}-{code} (ruling 88; older pages keep their
// 22-character tokens). noindex, no scripts allowed.
app.get('/:token', async (req: FastifyRequest<{ Params: { token: string } }>, reply: FastifyReply) => {
  const { token } = req.params;
  const html = /^[A-Za-z0-9_-]{3,64}$/.test(token) ? await pageByToken(token) : null;
  reply.header('X-Robots-Tag', 'noindex, nofollow').header('Referrer-Policy', 'no-referrer');
  if (!html) return reply.code(404).type('text/plain').send('Not found');
  return reply
    .header('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'")
    .header('X-Content-Type-Options', 'nosniff')
    .header('Cache-Control', 'private, max-age=300')
    .type('text/html; charset=utf-8')
    .send(html);
});

await ensureSchema();
await app.listen({ port: config.port, host: config.host });
