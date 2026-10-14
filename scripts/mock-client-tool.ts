// TEST ONLY. A stand-in for a client's tool API, shaped like the NewsEngine contract in
// fixtures/example-recipe-external-WIP.md, so the external path can run end to end locally.
//
//   POST /stories/marketing/draft   header x-ne-key: mock-key, body {"topic": "..."}
//        -> {storyId, titles: [3], url}        (403 on a wrong key, 400 without a topic)
//   GET  /story/<id>                -> the draft page (what the prospect would open)
//   GET  /_stats                    -> how many POSTs arrived (proves no duplicate artifacts)
//
//   npm run mock:tool    (listens on MOCK_TOOL_PORT, default 9090)
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.MOCK_TOOL_PORT ?? 9090);
const KEY = 'mock-key';
const stories = new Map<string, { topic: string; titles: string[] }>();
let posts = 0;

const send = (res: http.ServerResponse, status: number, body: unknown, type = 'application/json') => {
  res.writeHead(status, { 'Content-Type': type });
  res.end(type === 'application/json' ? JSON.stringify(body) : String(body));
};

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    if (req.method === 'GET' && url.pathname === '/_stats') return send(res, 200, { posts, stories: stories.size });
    if (req.method === 'GET' && url.pathname.startsWith('/story/')) {
      const s = stories.get(url.pathname.split('/')[2] ?? '');
      if (!s) return send(res, 404, 'not found', 'text/plain');
      const title = s.titles[Number(url.searchParams.get('titleId') ?? 1) - 1] ?? s.titles[0];
      return send(res, 200, `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1><p>Draft press release. ${s.topic}.</p><p>Edit the draft, pick a title, and publish through the newswire.</p></body></html>`, 'text/html');
    }
    if (req.method === 'POST' && url.pathname === '/stories/marketing/draft') {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        posts++;
        if (req.headers['x-ne-key'] !== KEY) return send(res, req.headers['x-ne-key'] ? 403 : 400, { error: req.headers['x-ne-key'] ? 'Unauthorized' : 'missing header x-ne-key' });
        let topic: unknown;
        try {
          topic = JSON.parse(raw).topic;
        } catch {
          return send(res, 400, { error: 'body must be JSON' });
        }
        if (typeof topic !== 'string' || !topic.trim()) return send(res, 400, { error: 'topic is required' });
        const storyId = crypto.randomBytes(6).toString('hex');
        const titles = [`${topic}`, `Growth update: ${topic}`, `Announcing: ${topic}`];
        stories.set(storyId, { topic, titles });
        console.log(`POST #${posts} topic="${topic}" -> story ${storyId}`);
        return send(res, 200, { storyId, titles, url: `http://localhost:${PORT}/story/${storyId}` });
      });
      return;
    }
    send(res, 404, { error: 'no such route' });
  })
  .listen(PORT, () => console.log(`mock client tool listening on http://localhost:${PORT}`));
