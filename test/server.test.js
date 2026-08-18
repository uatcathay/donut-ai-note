import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../src/errors.js';
import { checkConfig, createApp } from '../src/server.js';

test('checkConfig 缺 GEMINI_API_KEY 提出警告', () => {
  const w = checkConfig({});
  assert.ok(w.some((m) => m.includes('GEMINI_API_KEY')));
});
test('checkConfig 有 key 但無 Notion 提示改走 md', () => {
  const w = checkConfig({ GEMINI_API_KEY: 'x' });
  assert.ok(w.some((m) => m.includes('.md')));
});

async function postAudio(port, { title = '會議' } = {}) {
  const fd = new FormData();
  fd.set('title', title);
  fd.set('audio', new Blob([Buffer.from('abc')], { type: 'audio/webm' }), 'a.webm');
  const res = await fetch(`http://localhost:${port}/api/process`, { method: 'POST', body: fd });
  return { status: res.status, body: await res.json() };
}

test('POST /api/process 成功回傳結果', async () => {
  const app = createApp({
    processMeeting: async (input) => ({
      title: input.userTitle, summary: 's', keyPoints: ['a'], transcript: 't',
      destination: { type: 'markdown', filePath: '/x.md' },
    }),
  });
  const server = app.listen(0);
  const { port } = server.address();
  const { status, body } = await postAudio(port, { title: 'Hi' });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.title, 'Hi');
  assert.equal(body.destination.type, 'markdown');
  server.close();
});

test('POST /api/process 分析失敗回 ok:false 與 stage', async () => {
  const app = createApp({
    processMeeting: async () => { throw new AppError('analyze', '額度用完'); },
  });
  const server = app.listen(0);
  const { port } = server.address();
  const { status, body } = await postAudio(port);
  assert.equal(status, 400);
  assert.equal(body.ok, false);
  assert.equal(body.stage, 'analyze');
  assert.equal(body.message, '額度用完');
  server.close();
});

test('POST /api/process 無音檔回 400 upload', async () => {
  const app = createApp({
    processMeeting: async () => { throw new Error('should not be called'); },
  });
  const server = app.listen(0);
  const { port } = server.address();
  const fd = new FormData();
  fd.set('title', '測試');
  const res = await fetch(`http://localhost:${port}/api/process`, { method: 'POST', body: fd });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.ok, false);
  assert.equal(body.stage, 'upload');
  server.close();
});

test('GET /api/pending 列出待重試的錄音', async (t) => {
  const app = createApp({
    processMeeting: async () => ({}),
    listRecordings: async () => [{ id: 'a.webm', label: '20260818 14:19', sizeBytes: 42 }],
  });
  const server = app.listen(0);
  t.after(() => server.close());
  const { port } = server.address();
  const res = await fetch(`http://localhost:${port}/api/pending`);
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).items[0].label, '20260818 14:19');
});

test('分析進行中時擋下重試——同時跑兩個會搶進度顯示，也讓 503 更容易發生', async (t) => {
  const app = createApp({
    processMeeting: async () => { throw new Error('不該被呼叫'); },
    isAnalyzing: () => true,
  });
  const server = app.listen(0);
  t.after(() => server.close());
  const { port } = server.address();
  const res = await fetch(
    `http://localhost:${port}/api/pending/${encodeURIComponent('錄音_2026-08-18_1419_週會.webm')}/retry`,
    { method: 'POST' });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.match(body.message, /分析進行中/);
});

test('重試不存在或不合法的 id 回 404，不讓 id 指到目錄外', async (t) => {
  const app = createApp({ processMeeting: async () => ({}), isAnalyzing: () => false });
  const server = app.listen(0);
  t.after(() => server.close());
  const { port } = server.address();
  const res = await fetch(
    `http://localhost:${port}/api/pending/${encodeURIComponent('../../etc/passwd')}/retry`,
    { method: 'POST' });
  assert.equal(res.status, 404);
});

test('DELETE /api/pending/:id 丟掉不想再分析的錄音', async (t) => {
  let deleted = null;
  const app = createApp({
    processMeeting: async () => ({}),
    discardRecording: async (p) => { deleted = p; },
  });
  const server = app.listen(0);
  t.after(() => server.close());
  const { port } = server.address();
  const res = await fetch(
    `http://localhost:${port}/api/pending/${encodeURIComponent('錄音_2026-08-18_1419_週會.webm')}`,
    { method: 'DELETE' });
  assert.equal(res.status, 200);
  assert.match(deleted, /錄音_2026-08-18_1419_週會\.webm$/);
});

test('GET /api/progress 讓前端問得到分析進度', async (t) => {
  const app = createApp({ processMeeting: async () => ({}) });
  const server = app.listen(0);
  t.after(() => server.close());
  const { port } = server.address();
  const res = await fetch(`http://localhost:${port}/api/progress`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { active: false });
});

test('/shutdown 已移除（伺服器改為常駐，關窗不再結束程序）', async (t) => {
  const app = createApp({ processMeeting: async () => ({}) });
  const server = app.listen(0);
  t.after(() => server.close());
  const { port } = server.address();
  const res = await fetch(`http://localhost:${port}/shutdown`, { method: 'POST' });
  assert.equal(res.status, 404);
});

test('GET /manifest.webmanifest 提供可安裝 PWA 的必要欄位', async () => {
  const app = createApp({ processMeeting: async () => ({}) });
  const server = app.listen(0);
  const { port } = server.address();
  const res = await fetch(`http://localhost:${port}/manifest.webmanifest`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/manifest\+json/);
  const m = await res.json();
  assert.equal(m.name, 'Browser AI Note');
  assert.equal(m.start_url, '/');
  assert.equal(m.display, 'standalone');
  const sizes = m.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192'), '缺 192x192 圖示');
  assert.ok(sizes.includes('512x512'), '缺 512x512 圖示');
  server.close();
});

test('manifest 宣告的圖示檔實際取得得到', async () => {
  const app = createApp({ processMeeting: async () => ({}) });
  const server = app.listen(0);
  const { port } = server.address();
  for (const p of ['/icons/icon-192.png', '/icons/icon-512.png']) {
    const res = await fetch(`http://localhost:${port}${p}`);
    assert.equal(res.status, 200, `${p} 取不到`);
    assert.match(res.headers.get('content-type'), /image\/png/);
  }
  server.close();
});
