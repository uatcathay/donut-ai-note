import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { rm, mkdtemp, readFile } from 'node:fs/promises';
import { chooseOutput, writeOutput } from '../src/outputs/index.js';

const result = { title: 'T', summary: 's', keyPoints: ['a'], transcript: 't' };
const stamp = { date: '2026-07-31', time: '0905' };

test('chooseOutput：兩者皆設 → notion', () => {
  assert.equal(chooseOutput({ NOTION_TOKEN: 'x', NOTION_PARENT_PAGE_ID: 'y' }), 'notion');
});
test('chooseOutput：缺一 → markdown', () => {
  assert.equal(chooseOutput({ NOTION_TOKEN: 'x' }), 'markdown');
  assert.equal(chooseOutput({}), 'markdown');
});

test('writeOutput 走 markdown', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mr-'));
  const out = await writeOutput(result, stamp, { env: {}, destDir: dir });
  assert.equal(out.type, 'markdown');
  assert.match(await readFile(out.filePath, 'utf8'), /# T/);
  await rm(dir, { recursive: true, force: true });
});

test('writeOutput 走 notion（注入 client）', async () => {
  const fakeClient = {
    pages: { create: async () => ({ id: 'id1', url: 'https://notion.so/1' }) },
    blocks: { children: { append: async () => {} } },
  };
  const out = await writeOutput(result, stamp, {
    env: { NOTION_TOKEN: 'x', NOTION_PARENT_PAGE_ID: 'y' },
    notion: { client: fakeClient, parentId: 'y' },
  });
  assert.equal(out.type, 'notion');
});
