import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 4150);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function loadExpenses() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveExpenses(items) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(items, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) reject(new Error('Body too large'));
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (pathname === '/api/expenses' && req.method === 'GET') {
    const status = (url.searchParams.get('status') || '').trim();
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    let items = loadExpenses();

    if (status && status !== 'ALL') {
      items = items.filter((item) => item.status === status);
    } else if (q) {
      items = items.filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.requester.toLowerCase().includes(q) ||
          item.category.toLowerCase().includes(q)
      );
    }

    const delayMs = status === 'PENDING_L2_APPROVAL' ? 350 : 30;
    setTimeout(() => sendJson(res, 200, { items }), delayMs);
    return;
  }

  if (pathname === '/api/expenses' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const amount = Number(body.amount);
      if (!body.title || !body.requester || !Number.isFinite(amount) || amount <= 0) {
        sendJson(res, 400, { error: 'title, requester, and positive amount are required' });
        return;
      }
      const items = loadExpenses();
      const created = {
        id: `exp_${crypto.randomBytes(4).toString('hex')}`,
        title: String(body.title).trim(),
        category: String(body.category || 'General').trim(),
        requester: String(body.requester).trim(),
        amount,
        status: 'PENDING_L2_APPROVAL',
        createdAt: new Date().toISOString(),
      };
      items.unshift(created);
      saveExpenses(items);
      sendJson(res, 201, created);
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  const approveMatch = pathname.match(/^\/api\/expenses\/([^/]+)\/approve$/);
  if (approveMatch && req.method === 'PATCH') {
    const id = approveMatch[1];
    const items = loadExpenses();
    const target = items.find((item) => item.id === id);
    if (!target) {
      sendJson(res, 404, { error: 'Expense not found' });
      return;
    }
    target.status = 'APPROVE';
    saveExpenses(items);
    setTimeout(() => sendJson(res, 200, target), 250);
    return;
  }

  const itemMatch = pathname.match(/^\/api\/expenses\/([^/]+)$/);
  if (itemMatch && req.method === 'DELETE') {
    const id = itemMatch[1];
    const items = loadExpenses();
    const next = items.filter((item) => item.id !== id);
    if (next.length === items.length) {
      sendJson(res, 404, { error: 'Expense not found' });
      return;
    }
    saveExpenses(next);
    sendJson(res, 200, { deleted: id });
    return;
  }

  const safePath = pathname === '/' ? '/index.html' : pathname;
  const fullPath = path.resolve(PUBLIC_DIR, `.${safePath}`);
  if (!fullPath.startsWith(PUBLIC_DIR) || !fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const ext = path.extname(fullPath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(fullPath).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`SpendPulse listening on http://127.0.0.1:${PORT}`);
});
