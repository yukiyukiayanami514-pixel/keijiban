// カンタン掲示板サーバー（外部ライブラリ不要。Node.js だけで動きます）
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'posts.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_NAME = 30;
const MAX_MESSAGE = 1000;
const MAX_POSTS = 500;

function loadPosts() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function savePosts(posts) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(posts, null, 2));
}

let posts = loadPosts();
let nextId = posts.reduce((max, p) => Math.max(max, p.id), 0) + 1;

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 10_000) {
        reject(new Error('too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function serveStatic(req, res) {
  const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not Found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/posts')) {
    if (req.method === 'GET') {
      return sendJson(res, 200, posts);
    }
    if (req.method === 'POST') {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return sendJson(res, 400, { error: '送信内容が正しくありません' });
      }
      const name = String(body.name || '').trim().slice(0, MAX_NAME) || '名無しさん';
      const message = String(body.message || '').trim();
      if (!message) return sendJson(res, 400, { error: '本文を入力してください' });
      if (message.length > MAX_MESSAGE) {
        return sendJson(res, 400, { error: `本文は${MAX_MESSAGE}文字以内にしてください` });
      }
      const post = { id: nextId++, name, message, createdAt: new Date().toISOString() };
      posts.push(post);
      if (posts.length > MAX_POSTS) posts = posts.slice(-MAX_POSTS);
      savePosts(posts);
      return sendJson(res, 201, post);
    }
    return sendJson(res, 405, { error: 'Method Not Allowed' });
  }
  if (req.method === 'GET') return serveStatic(req, res);
  res.writeHead(405);
  res.end();
});

server.listen(PORT, () => {
  console.log(`掲示板を起動しました: http://localhost:${PORT}`);
});
