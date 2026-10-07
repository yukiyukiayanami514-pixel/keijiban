// カンタン掲示板（Cloudflare Workers + D1）
// 画面（public/）は静的アセットとして配信し、/api/posts だけをこのコードで処理します。
const MAX_NAME = 30;
const MAX_MESSAGE = 1000;
const LIST_LIMIT = 500;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function listPosts(env) {
  const { results } = await env.DB.prepare(
    'SELECT id, name, message, created_at AS createdAt FROM posts ORDER BY id DESC LIMIT ?'
  ).bind(LIST_LIMIT).all();
  return json(results.reverse());
}

async function createPost(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: '送信内容が正しくありません' }, 400);
  }
  const name = String(body.name || '').trim().slice(0, MAX_NAME) || '名無しさん';
  const message = String(body.message || '').trim();
  if (!message) return json({ error: '本文を入力してください' }, 400);
  if (message.length > MAX_MESSAGE) {
    return json({ error: `本文は${MAX_MESSAGE}文字以内にしてください` }, 400);
  }
  const createdAt = new Date().toISOString();
  const row = await env.DB.prepare(
    'INSERT INTO posts (name, message, created_at) VALUES (?, ?, ?) RETURNING id'
  ).bind(name, message, createdAt).first();
  return json({ id: row.id, name, message, createdAt }, 201);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/posts') {
      if (request.method === 'GET') return listPosts(env);
      if (request.method === 'POST') return createPost(request, env);
      return json({ error: 'Method Not Allowed' }, 405);
    }
    return env.ASSETS.fetch(request);
  },
};
