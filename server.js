// 自分専用の秘書アプリ
// Node.js 標準モジュールのみで動作します（追加インストール不要）
// 起動: node server.js  →  ブラウザで http://localhost:3000 を開く

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

// ---- データの読み書き -------------------------------------------------

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    return {
      memos: Array.isArray(data.memos) ? data.memos : [],
      tasks: Array.isArray(data.tasks) ? data.tasks : [],
      reflections: Array.isArray(data.reflections) ? data.reflections : [],
    };
  } catch (e) {
    // ファイルが無い / 壊れている場合は空データで開始
    return { memos: [], tasks: [], reflections: [] };
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function newId() {
  return crypto.randomBytes(8).toString('hex');
}

// ---- API ハンドラ -----------------------------------------------------

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) req.destroy(); // 過大なリクエストを拒否
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function handleApi(req, res, url) {
  const data = loadData();

  // 一覧取得
  if (req.method === 'GET' && url === '/api/state') {
    return sendJson(res, 200, data);
  }

  // メモ追加
  if (req.method === 'POST' && url === '/api/memos') {
    const body = await readBody(req);
    const title = (body.title || '').toString().trim();
    const content = (body.content || '').toString().trim();
    if (!title && !content) {
      return sendJson(res, 400, { error: 'タイトルか本文を入力してください' });
    }
    const memo = {
      id: newId(),
      title,
      content,
      createdAt: new Date().toISOString(),
    };
    data.memos.unshift(memo);
    saveData(data);
    return sendJson(res, 201, memo);
  }

  // タスク追加
  if (req.method === 'POST' && url === '/api/tasks') {
    const body = await readBody(req);
    const text = (body.text || '').toString().trim();
    if (!text) {
      return sendJson(res, 400, { error: 'タスク内容を入力してください' });
    }
    const task = {
      id: newId(),
      text,
      done: false,
      createdAt: new Date().toISOString(),
    };
    data.tasks.unshift(task);
    saveData(data);
    return sendJson(res, 201, task);
  }

  // メモ削除
  const memoMatch = url.match(/^\/api\/memos\/([a-f0-9]+)$/);
  if (memoMatch && req.method === 'DELETE') {
    const id = memoMatch[1];
    const idx = data.memos.findIndex((m) => m.id === id);
    if (idx === -1) return sendJson(res, 404, { error: 'メモが見つかりません' });
    const removed = data.memos.splice(idx, 1)[0];
    saveData(data);
    return sendJson(res, 200, removed);
  }

  // 週次振り返りの記録（同じ週なら上書き、無ければ追加）
  if (req.method === 'POST' && url === '/api/reflections') {
    const body = await readBody(req);
    const week = (body.week || '').toString().trim();
    const comment = (body.comment || '').toString().trim();
    if (!/^\d{4}-W\d{2}$/.test(week)) {
      return sendJson(res, 400, { error: '週を選択してください' });
    }
    if (!comment) {
      return sendJson(res, 400, { error: '振り返りコメントを入力してください' });
    }
    const existing = data.reflections.find((r) => r.week === week);
    let reflection;
    if (existing) {
      existing.comment = comment;
      existing.updatedAt = new Date().toISOString();
      reflection = existing;
    } else {
      reflection = {
        id: newId(),
        week,
        comment,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      data.reflections.push(reflection);
    }
    // 週の新しい順に並べ替え
    data.reflections.sort((a, b) => (a.week < b.week ? 1 : a.week > b.week ? -1 : 0));
    saveData(data);
    return sendJson(res, 201, reflection);
  }

  // 週次振り返りの削除
  const reflMatch = url.match(/^\/api\/reflections\/([a-f0-9]+)$/);
  if (reflMatch && req.method === 'DELETE') {
    const id = reflMatch[1];
    const idx = data.reflections.findIndex((r) => r.id === id);
    if (idx === -1) return sendJson(res, 404, { error: '振り返りが見つかりません' });
    const removed = data.reflections.splice(idx, 1)[0];
    saveData(data);
    return sendJson(res, 200, removed);
  }

  // タスク更新（完了状態の切り替え）
  const taskMatch = url.match(/^\/api\/tasks\/([a-f0-9]+)$/);
  if (taskMatch) {
    const id = taskMatch[1];
    const idx = data.tasks.findIndex((t) => t.id === id);
    if (idx === -1) return sendJson(res, 404, { error: 'タスクが見つかりません' });

    if (req.method === 'PATCH') {
      const body = await readBody(req);
      if (typeof body.done === 'boolean') data.tasks[idx].done = body.done;
      saveData(data);
      return sendJson(res, 200, data.tasks[idx]);
    }

    if (req.method === 'DELETE') {
      const removed = data.tasks.splice(idx, 1)[0];
      saveData(data);
      return sendJson(res, 200, removed);
    }
  }

  return sendJson(res, 404, { error: 'Not found' });
}

// ---- サーバ本体 -------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  try {
    if (url.startsWith('/api/')) {
      return await handleApi(req, res, url);
    }

    if (url === '/' || url === '/index.html') {
      const html = fs.readFileSync(path.join(__dirname, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  } catch (e) {
    sendJson(res, 500, { error: 'サーバエラー: ' + e.message });
  }
});

server.listen(PORT, () => {
  console.log(`秘書アプリを起動しました → http://localhost:${PORT}`);
  console.log(`データ保存先: ${DATA_FILE}`);
  console.log('終了するには Ctrl + C を押してください。');
});
