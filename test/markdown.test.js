import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildMarkdown, buildFilename, writeMarkdown } from '../src/outputs/markdown.js';

const result = {
  title: '產品週會',
  topics: [
    { title: '排版問題', points: ['文字被裁切', '間距過大'] },
    { title: '後續測試', points: ['依標準流程重測'] },
  ],
  nextSteps: ['在下週三前重新測試問題頁面'],
  transcript: '完整逐字內容',
};

test('buildMarkdown 含各區塊', () => {
  const md = buildMarkdown(result, '2026-07-31');
  assert.match(md, /# 產品週會/);
  assert.match(md, /📅 2026-07-31/);
  assert.match(md, /## 📝 Mins/);
  assert.match(md, /### 排版問題/);
  assert.match(md, /- 文字被裁切/);
  assert.match(md, /### 後續測試/);
  assert.match(md, /## ◻️ What's next\?/);
  assert.match(md, /- \[ \] 在下週三前重新測試問題頁面/);
  assert.match(md, /## 完整逐字稿/);
  assert.match(md, /完整逐字內容/);
});

test('buildFilename 過濾非法字元', () => {
  const name = buildFilename('A/B:會議', { date: '2026-07-31', time: '0905' });
  assert.equal(name, '會議記錄_2026-07-31_0905_A_B_會議.md');
});

test('writeMarkdown 實際寫檔', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mr-'));
  const out = await writeMarkdown(result, { date: '2026-07-31', time: '0905' }, dir);
  assert.equal(out.type, 'markdown');
  const content = await readFile(out.filePath, 'utf8');
  assert.match(content, /# 產品週會/);
  await rm(dir, { recursive: true, force: true });
});

test('buildMarkdown 沒有待辦時整區省略，不留空標題', () => {
  const md = buildMarkdown({ ...result, nextSteps: [] }, '2026-07-31');
  assert.doesNotMatch(md, /What's next/);
  assert.match(md, /## 📝 Mins/);
});
