import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBlocks, buildTranscriptBlocks, chunk, writeNotion } from '../src/outputs/notion.js';

const result = {
  title: '產品週會',
  summary: '討論了 A。',
  keyPoints: ['決定做 A', '下週追 B'],
  transcript: '第一段。\n第二段。',
};

test('buildBlocks 結構正確', () => {
  const blocks = buildBlocks(result, '2026-07-31');
  assert.match(blocks[0].paragraph.rich_text[0].text.content, /📅 2026-07-31/);
  assert.equal(blocks[1].type, 'heading_2');
  assert.equal(blocks[1].heading_2.rich_text[0].text.content, '摘要');
  assert.equal(blocks[2].paragraph.rich_text[0].text.content, '討論了 A。');
  assert.equal(blocks[3].heading_2.rich_text[0].text.content, '重點');
  assert.equal(blocks[4].type, 'bulleted_list_item');
  assert.equal(blocks[4].bulleted_list_item.rich_text[0].text.content, '決定做 A');
  assert.equal(blocks[5].bulleted_list_item.rich_text[0].text.content, '下週追 B');
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

test('writeNotion 建主頁＋逐字稿子頁', async () => {
  const calls = [];
  const appends = [];
  const fakeClient = {
    pages: { create: async (a) => { calls.push(a); return { id: `id${calls.length}`, url: `https://notion.so/${calls.length}` }; } },
    blocks: { children: { append: async (a) => { appends.push(a); } } },
  };
  const out = await writeNotion(result, { date: '2026-07-31', time: '0905' }, { client: fakeClient, parentId: 'PARENT' });
  assert.equal(out.type, 'notion');
  assert.equal(out.url, 'https://notion.so/1');
  // 第一次建主頁，parent 是 PARENT
  assert.equal(calls[0].parent.page_id, 'PARENT');
  assert.equal(calls[0].properties.title.title[0].text.content, '產品週會');
  // 第二次建逐字稿子頁，parent 是主頁 id
  assert.equal(calls[1].parent.page_id, 'id1');
  assert.equal(calls[1].properties.title.title[0].text.content, '完整逐字稿');
});
