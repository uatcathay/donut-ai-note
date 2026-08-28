import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteCompleted, listCompleted, takeCompleted, removeCompleted, clearCompleted } from '../src/completed.js';

const result = (title) => ({
  title, topics: [{ title: 'T', points: ['a'] }], nextSteps: [],
  transcript: 't', destination: { type: 'notion', url: 'https://x' },
});

test('分析成功後記下來，清單才有東西可以顯示', () => {
  clearCompleted();
  noteCompleted('錄音_2026-08-28_1420_設計評審.webm', result('設計評審'));
  const items = listCompleted();
  assert.equal(items.length, 1);
  assert.equal(items[0].title, '設計評審');
  assert.equal(items[0].id, '錄音_2026-08-28_1420_設計評審.webm');
});

// 這是通知，不是資料：筆記的永久位置是 Notion 或桌面的 .md。
// 看完（返回）或直接按「移除」都會把它拿掉。
test('移除之後就不再出現', () => {
  clearCompleted();
  noteCompleted('a.webm', result('甲'));
  noteCompleted('b.webm', result('乙'));
  assert.equal(removeCompleted('a.webm'), true);
  assert.deepEqual(listCompleted().map((i) => i.id), ['b.webm']);
});

test('移除不存在的項目回 false，不會拋錯', () => {
  clearCompleted();
  assert.equal(removeCompleted('沒這個.webm'), false);
});

// 摘要頁要拿完整結果來畫，清單本身不需要背著逐字稿到處跑
test('takeCompleted 取得完整結果，供摘要頁顯示', () => {
  clearCompleted();
  noteCompleted('a.webm', result('甲'));
  const got = takeCompleted('a.webm');
  assert.equal(got.title, '甲');
  assert.deepEqual(got.topics, [{ title: 'T', points: ['a'] }]);
  assert.equal(got.destination.type, 'notion');
});

test('takeCompleted 取不到就回 null', () => {
  clearCompleted();
  assert.equal(takeCompleted('沒這個.webm'), null);
});

test('最新完成的排在最前面', () => {
  clearCompleted();
  noteCompleted('a.webm', result('甲'));
  noteCompleted('b.webm', result('乙'));
  assert.deepEqual(listCompleted().map((i) => i.id), ['b.webm', 'a.webm']);
});

// 同一筆錄音重試成功時不該留下兩列
test('同一個 id 再次完成只保留一列', () => {
  clearCompleted();
  noteCompleted('a.webm', result('舊標題'));
  noteCompleted('a.webm', result('新標題'));
  const items = listCompleted();
  assert.equal(items.length, 1);
  assert.equal(items[0].title, '新標題');
});
