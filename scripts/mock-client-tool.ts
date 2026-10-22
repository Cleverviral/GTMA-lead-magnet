// TEST ONLY. A stand-in for a client's own tool ("Connect your own lead magnet"), the same shape
// as the kit's magnet-test/external/mock_client_tool.py: a small benchmark-report generator.
//
//   POST /v1/reports          header x-api-key, body {company_domain, industry, employee_count}
//                             -> {report_id, status, report_url}   (401 on a wrong key, 400 on a missing field)
//   POST /v1/reports-async    -> 202 {job_id}            (a job-id API: not supported, setup must stop)
//   POST /v1/summary          -> {summary}               (text, no link: not supported)
//   GET  /r/<id>              -> the report page, naming the company's domain
//   GET  /_stats              -> how many calls arrived (proves no duplicate items)
//
//   npm run mock:tool    (listens on MOCK_TOOL_PORT, default 8790; key MOCK_TOOL_KEY, default test-key-123)
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.MOCK_TOOL_PORT ?? 8790);
const KEY = process.env.MOCK_TOOL_KEY ?? 'test-key-123';
const reports = new Map<string, Record<string, unknown>>();
let calls = 0;

const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const send = (res: http.ServerResponse, status: number, body: unknown, type = 'application/json') => {
  res.writeHead(status, { 'Content-Type': type });
  res.end(type === 'application/json' ? JSON.stringify(body) : String(body));
};

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    if (req.method === 'GET' && url.pathname === '/_stats') return send(res, 200, { calls, reports: reports.size });
    if (req.method === 'GET' && url.pathname.startsWith('/r/')) {
      const r = reports.get(url.pathname.slice(3));
      if (!r) return send(res, 404, 'not found', 'text/plain');
      return send(res, 200, `<!doctype html><html><body><h1>Benchmark report for ${esc(r.company_domain)}</h1><p>Industry: ${esc(r.industry)} · Employees: ${esc(r.employee_count)}</p></body></html>`, 'text/html');
    }
    if (req.method !== 'POST') return send(res, 404, { error: 'not found' });
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      calls++;
      if (req.headers['x-api-key'] !== KEY) return send(res, 401, { error: 'invalid api key' });
      let body: Record<string, unknown> = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        return send(res, 400, { error: 'body must be JSON' });
      }
      if (url.pathname === '/v1/reports') {
        const miss = ['company_domain', 'industry', 'employee_count'].filter((f) => !body[f]);
        if (miss.length) return send(res, 400, { error: 'missing fields', fields: miss });
        const id = crypto.randomBytes(5).toString('hex');
        reports.set(id, body);
        console.log(`call #${calls} ${body.company_domain} -> report ${id}`);
        return send(res, 200, { report_id: id, status: 'ready', report_url: `http://localhost:${PORT}/r/${id}` });
      }
      if (url.pathname === '/v1/reports-async') return send(res, 202, { job_id: crypto.randomBytes(4).toString('hex'), status: 'queued' });
      if (url.pathname === '/v1/summary') return send(res, 200, { summary: 'A plain text summary, no link.' });
      return send(res, 404, { error: 'not found' });
    });
  })
  .listen(PORT, () => console.log(`stand-in client tool on http://localhost:${PORT} (key ${KEY})`));
