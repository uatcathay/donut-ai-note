import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildMarkdown, buildFilename, writeMarkdown } from '../src/outputs/markdown.js';

const result = {
  title: '產品週會',
  summary: '討論了 A 與 B。',
  keyPoints: ['決定做 A', '下週追 B'],
  transcript: '完整逐字內容',
};

test('buildMarkdown 含各區塊', () => {
  const md = buildMarkdown(result, '2026-07-31');
  assert.match(md, /# 產品週會/);
  assert.match(md, /📅 2026-07-31/);
  assert.match(md, /## 摘要/);
  assert.match(md, /討論了 A 與 B。/);
  assert.match(md, /## 重點/);
  assert.match(md, /- 決定做 A/);
  assert.match(md, /- 下週追 B/);
  assert.match(md, /## 完整逐字稿/);
  assert.match(md, /完整逐字內容/);
});

test('buildFilename 過濾非法字元', () => {
  const name = buildFilename('A/B:會議', { date: '2026-07-31', time: '0905' });
  assert.equal(name, '會議記錄_2026-07-31_0905_A_B_會議.md');
});

test('writeMarkdown 實際寫檔', async () => {
  const dir = path.join(os.tmpdir(), 'mr-md-test');
  await mkdir(dir, { recursive: true });
  const out = await writeMarkdown(result, { date: '2026-07-31', time: '0905' }, dir);
  assert.equal(out.type, 'markdown');
  const content = await readFile(out.filePath, 'utf8');
  assert.match(content, /# 產品週會/);
  await rm(dir, { recursive: true, force: true });
});
