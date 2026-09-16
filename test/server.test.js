import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../src/errors.js';
import { checkConfig, createApp, listenLoopback, LOOPBACKS } from '../src/server.js';
import { noteQuotaExhausted, clearQuota } from '../src/quota.js';
import { noteCompleted, listCompleted, clearCompleted } from '../src/completed.js';

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

// 分析失敗不再由回應表達——那時候使用者早就離開這一頁了。
// 失敗會讓錄音留在清單上（狀態待分析、附上原因），回應本身照樣是成功收件。
test('POST /api/process 就算分析注定失敗，收件本身仍回成功', async (t) => {
  const app = createApp({
    saveRecording: async (buf, name) => `/tmp/${name}`,
    isAnalyzing: () => false,
    processMeeting: async () => { throw new AppError('analyze', '額度用完'); },
  });
  const server = app.listen(0);
  t.after(() => server.close());
  const { status, body } = await postAudio(server.address().port);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
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

// 沒有 API 查得到「現在還剩多少額度」，唯一的信號是曾經撞到 429。
// 前端在錄音開始後問這支，決定要不要提醒使用者分析可能會失敗。
test('GET /api/quota：沒撞過額度時不需要提醒', async (t) => {
  clearQuota();
  const app = createApp({ processMeeting: async () => ({}) });
  const server = app.listen(0);
  t.after(() => server.close());
  const { port } = server.address();
  const res = await fetch(`http://localhost:${port}/api/quota`);
  assert.deepEqual(await res.json(), { exhausted: false });
});

test('GET /api/quota：撞過額度就回報，並附上看得懂的重置時間', async (t) => {
  clearQuota();
  noteQuotaExhausted(new Date(Date.now() + 3_600_000));
  t.after(() => clearQuota());
  const app = createApp({ processMeeting: async () => ({}) });
  const server = app.listen(0);
  t.after(() => server.close());
  const { port } = server.address();
  const body = await (await fetch(`http://localhost:${port}/api/quota`)).json();
  assert.equal(body.exhausted, true);
  assert.match(body.resetLabel, /^(今天|明天) \d{2}:\d{2}$/);
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

// ── 分析改成在背景跑 ──────────────────────────────────────
// 原本 POST /api/process 會一路等到分析完才回應，前端因此被「處理中」那頁綁住，
// 沒辦法在等待期間開始錄下一場會議。現在錄音一落地就回應，分析自己在背景跑。

test('POST /api/process 錄音一落地就回應，不等分析跑完', async (t) => {
  let analyzing = false;
  const saved = [];
  let release;
  const blocked = new Promise((r) => { release = r; });
  const app = createApp({
    saveRecording: async (buf, name) => { saved.push(name); return `/tmp/${name}`; },
    isAnalyzing: () => analyzing,
    processMeeting: async () => { analyzing = true; await blocked; return {}; },
  });
  const server = app.listen(0);
  t.after(() => { release(); server.close(); });

  const t0 = Date.now();
  const { status, body } = await postAudio(server.address().port, { title: '設計評審' });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.ok(Date.now() - t0 < 1000, '不該等分析完成才回應');
  assert.match(body.id, /^錄音_.+設計評審\./, '要回傳錄音 id，清單才標得出是哪一筆');
  assert.equal(saved.length, 1, '回應之前錄音就該落地');
  assert.equal(body.started, true, '分析真的開始了，前端才跳到處理中那頁');
});

test('POST /api/process 在已有分析進行中時只存檔，不動手分析', async (t) => {
  const saved = [];
  let analyzed = 0;
  const app = createApp({
    saveRecording: async (buf, name) => { saved.push(name); return `/tmp/${name}`; },
    isAnalyzing: () => true,
    processMeeting: async () => { analyzed += 1; return {}; },
  });
  const server = app.listen(0);
  t.after(() => server.close());
  const { body } = await postAudio(server.address().port);
  assert.equal(body.ok, true);
  assert.equal(saved.length, 1, '錄音一定要留下來');
  assert.equal(analyzed, 0, '兩個分析並行會搶進度狀態，也讓 503 機率加倍');
  assert.equal(body.started, false,
    '沒開始分析就別跳到處理中那頁——那頁會顯示成正在跑，但其實沒有');
});

// ── 清單合併三種狀態 ─────────────────────────────────────
test('GET /api/jobs 合併待分析、分析中、已完成', async (t) => {
  clearCompleted();
  noteCompleted('錄音_2026-08-28_1000_專案同步.webm', {
    title: '專案同步', topics: [{ title: 'T', points: ['a'] }], nextSteps: [],
    transcript: 't', destination: { type: 'notion', url: 'https://x' },
  });
  const app = createApp({
    processMeeting: async () => ({}),
    listRecordings: async () => [
      { id: 'a.webm', label: '甲（20260828 14:20）', title: '甲', savedAt: '20260828 14:20', sizeBytes: 100 },
      { id: 'b.webm', label: '乙（20260828 15:05）', title: '乙', savedAt: '20260828 15:05', sizeBytes: 200 },
    ],
    getProgress: () => ({ active: true, stage: 'analyze', elapsedMs: 134000, retry: null, recordingId: 'a.webm' }),
  });
  const server = app.listen(0);
  t.after(() => { server.close(); clearCompleted(); });
  const { items } = await (await fetch(`http://localhost:${server.address().port}/api/jobs`)).json();

  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.equal(byId['a.webm'].state, 'analyzing', '進度指名的那一筆要標成分析中');
  assert.equal(byId['a.webm'].elapsedMs, 134000);
  assert.equal(byId['b.webm'].state, 'pending', '其餘磁碟上的錄音都是待分析');
  assert.equal(byId['錄音_2026-08-28_1000_專案同步.webm'].state, 'done');
  assert.equal(byId['錄音_2026-08-28_1000_專案同步.webm'].title, '專案同步');
});

test('GET /api/jobs 沒有分析在跑時，磁碟上的都是待分析', async (t) => {
  clearCompleted();
  const app = createApp({
    processMeeting: async () => ({}),
    listRecordings: async () => [{ id: 'a.webm', label: '甲', sizeBytes: 100 }],
    getProgress: () => ({ active: false }),
  });
  const server = app.listen(0);
  t.after(() => server.close());
  const { items } = await (await fetch(`http://localhost:${server.address().port}/api/jobs`)).json();
  assert.deepEqual(items.map((i) => i.state), ['pending']);
});

// ── 已完成那一列 ────────────────────────────────────────
test('GET /api/completed/:id 取得摘要內容供摘要頁顯示', async (t) => {
  clearCompleted();
  noteCompleted('a.webm', {
    title: '設計評審', topics: [{ title: '議題', points: ['重點'] }], nextSteps: ['待辦'],
    transcript: 't', destination: { type: 'notion', url: 'https://x' },
  });
  const app = createApp({ processMeeting: async () => ({}) });
  const server = app.listen(0);
  t.after(() => { server.close(); clearCompleted(); });
  const body = await (await fetch(`http://localhost:${server.address().port}/api/completed/a.webm`)).json();
  assert.equal(body.title, '設計評審');
  assert.deepEqual(body.nextSteps, ['待辦']);
});

test('DELETE /api/completed/:id 把那一列移除，不動 Notion 上的筆記', async (t) => {
  clearCompleted();
  noteCompleted('a.webm', { title: '甲', topics: [], nextSteps: [], transcript: 't', destination: {} });
  const app = createApp({ processMeeting: async () => ({}) });
  const server = app.listen(0);
  t.after(() => { server.close(); clearCompleted(); });
  const port = server.address().port;
  const res = await fetch(`http://localhost:${port}/api/completed/a.webm`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  assert.equal(listCompleted().length, 0);
});

// localhost 在 macOS 同時解析成 ::1 與 127.0.0.1，而且優先走 IPv6。
// 只綁 IPv4 的話，另一個綁通配位址的開發伺服器會吃下 ::1，於是 localhost:<port>
// 靜默地變成它——兩邊都啟動成功、都沒報錯，是最難察覺的一種衝突（實際發生過）。
test('綁定兩個 loopback，後來者才會拿到明確的「埠號已被使用」', () => {
  const calls = [];
  const fakeApp = { listen: (port, host, cb) => { calls.push([port, host]); cb?.(); return { on() {} }; } };
  const servers = listenLoopback(fakeApp, 3737);
  assert.deepEqual(calls, [[3737, '127.0.0.1'], [3737, '::1']]);
  assert.equal(servers.length, 2);
});

test('LOOPBACKS 只含 loopback 位址，不含通配——通配會讓同網段的人連得進來', () => {
  assert.deepEqual(LOOPBACKS, ['127.0.0.1', '::1']);
  assert.ok(!LOOPBACKS.includes('0.0.0.0') && !LOOPBACKS.includes('::'));
});

// IPv6 被關掉的機器上綁 ::1 會失敗，但 IPv4 那個還能用，不該讓整個工具起不來
test('其中一個位址綁不起來時只記錄，不讓程序掛掉', () => {
  const handlers = [];
  const fakeApp = {
    listen: (port, host, cb) => {
      cb?.();
      return { on: (ev, fn) => { if (ev === 'error') handlers.push({ host, fn }); } };
    },
  };
  const logged = [];
  listenLoopback(fakeApp, 3737, (m) => logged.push(m));
  assert.equal(handlers.length, 2, '每個位址都要掛上 error 處理');
  handlers[1].fn(new Error('EAFNOSUPPORT'));
  assert.equal(logged.length, 1);
  assert.match(logged[0], /::1/);
});

// 登記已完成到刪掉錄音之間，同一筆同時存在於已完成清單與磁碟上。
// 不去重的話畫面會出現兩列同名的東西，一列已完成、一列待分析。
test('GET /api/jobs：已完成的那筆不會同時以待分析再列一次', async (t) => {
  clearCompleted();
  noteCompleted('a.webm', { title: '甲', topics: [], nextSteps: [], transcript: 't', destination: {} });
  const app = createApp({
    processMeeting: async () => ({}),
    listRecordings: async () => [{ id: 'a.webm', label: '甲', sizeBytes: 100 }],
    getProgress: () => ({ active: false }),
  });
  const server = app.listen(0);
  t.after(() => { server.close(); clearCompleted(); });
  const { items } = await (await fetch(`http://localhost:${server.address().port}/api/jobs`)).json();
  assert.equal(items.length, 1);
  assert.equal(items[0].state, 'done');
});
