// ChatGPT風チャット（Workers AI + D1）
// ログインの代わりに、ブラウザごとに発行したランダムID（X-Client-Id ヘッダー）で会話履歴を分けます。
const MODEL = '@cf/openai/gpt-oss-120b';
const SYSTEM_PROMPT =
  'あなたは親切で有能なAIアシスタントです。ユーザーの言語（基本は日本語）で、わかりやすく丁寧に答えてください。';
const MAX_MESSAGE = 4000;
const HISTORY_LIMIT = 20; // AIに渡す直近のメッセージ数
const LIST_LIMIT = 100;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function getClientId(request) {
  const id = request.headers.get('X-Client-Id') || '';
  return /^[A-Za-z0-9-]{16,64}$/.test(id) ? id : null;
}

async function findConversation(env, clientId, id) {
  return env.DB.prepare('SELECT id, title FROM conversations WHERE id = ? AND client_id = ?')
    .bind(id, clientId).first();
}

async function listConversations(env, clientId) {
  const { results } = await env.DB.prepare(
    'SELECT id, title, updated_at AS updatedAt FROM conversations WHERE client_id = ? ORDER BY updated_at DESC LIMIT ?'
  ).bind(clientId, LIST_LIMIT).all();
  return json(results);
}

async function getConversation(env, clientId, id) {
  const conv = await findConversation(env, clientId, id);
  if (!conv) return json({ error: '会話が見つかりません' }, 404);
  const { results } = await env.DB.prepare(
    'SELECT role, content, created_at AS createdAt FROM messages WHERE conversation_id = ? ORDER BY id'
  ).bind(id).all();
  return json({ ...conv, messages: results });
}

async function deleteConversation(env, clientId, id) {
  const conv = await findConversation(env, clientId, id);
  if (!conv) return json({ error: '会話が見つかりません' }, 404);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM messages WHERE conversation_id = ?').bind(id),
    env.DB.prepare('DELETE FROM conversations WHERE id = ?').bind(id),
  ]);
  return json({ ok: true });
}

// Workers AI のストリーム（SSE）の1行分から本文の差分を取り出す。
// モデルによって {response: "..."} 形式と OpenAI 互換の {choices:[{delta:{content}}]} 形式があるので両対応。
function extractDelta(data) {
  if (typeof data.response === 'string') return data.response;
  const choice = data.choices && data.choices[0];
  if (choice) {
    if (choice.delta && typeof choice.delta.content === 'string') return choice.delta.content;
    if (choice.message && typeof choice.message.content === 'string') return choice.message.content;
  }
  return '';
}

// ストリームでない応答から本文を取り出す
function extractText(result) {
  if (!result) return '';
  if (typeof result.response === 'string') return result.response;
  const choice = result.choices && result.choices[0];
  if (choice && choice.message && typeof choice.message.content === 'string') return choice.message.content;
  if (typeof result.output_text === 'string') return result.output_text;
  return '';
}

async function chat(request, env, ctx, clientId) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: '送信内容が正しくありません' }, 400);
  }
  const message = String(body.message || '').trim();
  if (!message) return json({ error: 'メッセージを入力してください' }, 400);
  if (message.length > MAX_MESSAGE) {
    return json({ error: `メッセージは${MAX_MESSAGE}文字以内にしてください` }, 400);
  }

  const now = new Date().toISOString();
  let conversationId = body.conversationId ? String(body.conversationId) : '';
  if (conversationId) {
    if (!(await findConversation(env, clientId, conversationId))) {
      return json({ error: '会話が見つかりません' }, 404);
    }
  } else {
    conversationId = crypto.randomUUID();
    const title = message.replace(/\s+/g, ' ').slice(0, 30);
    await env.DB.prepare(
      'INSERT INTO conversations (id, client_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(conversationId, clientId, title, now, now).run();
  }

  await env.DB.batch([
    env.DB.prepare('INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)')
      .bind(conversationId, 'user', message, now),
    env.DB.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').bind(now, conversationId),
  ]);

  // 直近の会話履歴をAIに渡す（今送ったメッセージも含む）
  const { results: history } = await env.DB.prepare(
    'SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?'
  ).bind(conversationId, HISTORY_LIMIT).all();
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...history.reverse()];

  let aiResult;
  try {
    aiResult = await env.AI.run(MODEL, { messages, stream: true });
  } catch (err) {
    console.error('Workers AI error', err);
    return json({ error: 'AIの呼び出しに失敗しました。しばらくしてからもう一度お試しください。', conversationId }, 502);
  }

  // 画面へは「data: {"text":"差分"}」の形に整えて流し、最後に全文を D1 に保存する
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const send = (obj) => writer.write(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

  const pump = async () => {
    let full = '';
    try {
      if (aiResult instanceof ReadableStream) {
        const reader = aiResult.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          const lines = buffer.split('\n');
          buffer = lines.pop();
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const payload = trimmed.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
              const delta = extractDelta(JSON.parse(payload));
              if (delta) {
                full += delta;
                await send({ text: delta });
              }
            } catch {}
          }
        }
      } else {
        full = extractText(aiResult);
        if (full) await send({ text: full });
      }
      if (!full) {
        full = '（すみません、うまく回答を作れませんでした。もう一度お試しください。）';
        await send({ text: full });
      }
    } catch (err) {
      console.error('stream error', err);
      await send({ error: '回答の途中でエラーが発生しました' }).catch(() => {});
    } finally {
      if (full) {
        const doneAt = new Date().toISOString();
        await env.DB.batch([
          env.DB.prepare('INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)')
            .bind(conversationId, 'assistant', full, doneAt),
          env.DB.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').bind(doneAt, conversationId),
        ]).catch((err) => console.error('save error', err));
      }
      await send({ done: true }).catch(() => {});
      await writer.close().catch(() => {});
    }
  };
  ctx.waitUntil(pump());

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Conversation-Id': conversationId,
    },
  });
}

// /api/chat と /api/conversations 以下を処理する。該当しなければ null を返す
export async function handleChat(request, env, ctx) {
  const { pathname } = new URL(request.url);
  if (pathname !== '/api/chat' && !pathname.startsWith('/api/conversations')) return null;

  const clientId = getClientId(request);
  if (!clientId) return json({ error: 'クライアントIDがありません' }, 400);

  if (pathname === '/api/chat') {
    if (request.method === 'POST') return chat(request, env, ctx, clientId);
    return json({ error: 'Method Not Allowed' }, 405);
  }
  if (pathname === '/api/conversations') {
    if (request.method === 'GET') return listConversations(env, clientId);
    return json({ error: 'Method Not Allowed' }, 405);
  }
  const m = pathname.match(/^\/api\/conversations\/([A-Za-z0-9-]+)$/);
  if (m) {
    if (request.method === 'GET') return getConversation(env, clientId, m[1]);
    if (request.method === 'DELETE') return deleteConversation(env, clientId, m[1]);
    return json({ error: 'Method Not Allowed' }, 405);
  }
  return json({ error: 'Not Found' }, 404);
}
