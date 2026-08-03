import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../src/errors.js';
import { checkConfig, createApp, makeShutdown } from '../src/server.js';

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

test('POST /shutdown 回 200 並呼叫 onShutdown（注入 spy，不真的退出）', async () => {
  let called = 0;
  const app = createApp({
    processMeeting: async () => ({}),
    onShutdown: () => { called += 1; },
  });
  const server = app.listen(0);
  const { port } = server.address();
  const res = await fetch(`http://localhost:${port}/shutdown`, { method: 'POST' });
  assert.equal(res.status, 200);
  assert.equal(called, 1);
  server.close();
});

test('makeShutdown：App 模式下收到 /shutdown 會真的結束程序', () => {
  let exited = 0;
  const shutdown = makeShutdown({ APP_MODE: '1' }, { exit: () => { exited += 1; } });
  shutdown();
  assert.equal(exited, 1);
});

test('makeShutdown：非 App 模式（一般分頁開發）收到 /shutdown 不結束程序', () => {
  let exited = 0;
  const shutdown = makeShutdown({}, { exit: () => { exited += 1; }, log: () => {} });
  shutdown();
  assert.equal(exited, 0);
});

test('makeShutdown：非 App 模式忽略時會留下提示訊息', () => {
  const lines = [];
  const shutdown = makeShutdown({}, { exit: () => {}, log: (m) => lines.push(m) });
  shutdown();
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes('/shutdown'));
});
