import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBlocks, buildTranscriptBlocks, chunk, writeNotion } from '../src/outputs/notion.js';

const result = {
  title: '產品週會',
  topics: [
    { title: '排版問題', points: ['文字被裁切', '間距過大'] },
    { title: '後續測試', points: ['依標準流程重測'] },
  ],
  nextSteps: ['在下週三前重新測試問題頁面'],
  transcript: '第一段。\n第二段。',
};

test('buildBlocks：議題用 heading_3、待辦用可勾的 to_do', () => {
  const blocks = buildBlocks(result);
  const types = blocks.map((b) => b.type);
  assert.deepEqual(types, [
    'heading_2', 'to_do',
    'heading_2', 'heading_3', 'bulleted_list_item', 'bulleted_list_item',
    'heading_3', 'bulleted_list_item',
  ]);
  assert.equal(blocks[0].heading_2.rich_text[0].text.content, "◻️ What's next?",
    '待辦排在議題之前');
  assert.equal(blocks[1].to_do.rich_text[0].text.content, '在下週三前重新測試問題頁面');
  assert.equal(blocks[1].to_do.checked, false, '待辦寫進去時應為未勾選');
  assert.equal(blocks[2].heading_2.rich_text[0].text.content, '📝 Mins');
  assert.equal(blocks[3].heading_3.rich_text[0].text.content, '排版問題');
  assert.equal(blocks[4].bulleted_list_item.rich_text[0].text.content, '文字被裁切');
});

test('buildBlocks：沒有待辦時不產生 What\'s next 區塊', () => {
  const blocks = buildBlocks({ ...result, nextSteps: [] });
  assert.equal(blocks.filter((b) => b.type === 'to_do').length, 0);
  assert.equal(blocks.filter((b) => b.type === 'heading_2').length, 1);
});

test('buildTranscriptBlocks 依段落切塊', () => {
  const blocks = buildTranscriptBlocks(result.transcript);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].paragraph.rich_text[0].text.content, '第一段。');
});

test('buildTranscriptBlocks 超長段落再切', () => {
  const long = 'あ'.repeat(4000);
  const blocks = buildTranscriptBlocks(long, 1900);
  assert.equal(blocks.length, 3); // 1900 + 1900 + 200
});

test('chunk 切成每組 size', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test('writeNotion 建資料庫列（Name+Date）＋逐字稿子頁', async () => {
  const calls = [];
  const appends = [];
  const fakeClient = {
    pages: { create: async (a) => { calls.push(a); return { id: `id${calls.length}`, url: `https://notion.so/${calls.length}` }; } },
    blocks: { children: { append: async (a) => { appends.push(a); } } },
  };
  // 注入 dataSourceId，跳過 databases.retrieve 解析
  const out = await writeNotion(result, { date: '2026-07-31', time: '0905' }, { client: fakeClient, dataSourceId: 'DS' });
  assert.equal(out.type, 'notion');
  assert.equal(out.url, 'https://notion.so/1');
  // 第一次建資料庫列，parent 指向 data source
  assert.equal(calls[0].parent.data_source_id, 'DS');
  assert.equal(calls[0].properties.Name.title[0].text.content, '產品週會');
  assert.equal(calls[0].properties.Date.date.start, '2026-07-31');
  // 第二次建逐字稿子頁，parent 是該列頁面 id
  assert.equal(calls[1].parent.page_id, 'id1');
  assert.equal(calls[1].properties.title.title[0].text.content, '完整逐字稿');
});

test('writeNotion 由 databaseId 解析 data source', async () => {
  const calls = [];
  const fakeClient = {
    databases: { retrieve: async () => ({ data_sources: [{ id: 'DS-from-db' }] }) },
    pages: { create: async (a) => { calls.push(a); return { id: `id${calls.length}`, url: `https://notion.so/${calls.length}` }; } },
    blocks: { children: { append: async () => {} } },
  };
  await writeNotion(result, { date: '2026-07-31', time: '0905' }, { client: fakeClient, databaseId: 'DB' });
  assert.equal(calls[0].parent.data_source_id, 'DS-from-db');
});
