import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../src/errors.js';
import { processMeeting } from '../src/pipeline.js';

const baseDeps = (overrides = {}) => ({
  analyze: async () => ({ suggestedTitle: 'AI 標題', summary: '摘要', keyPoints: ['點一'], transcript: '逐字' }),
  writeOutput: async (result) => ({ type: 'markdown', filePath: `/tmp/${result.title}.md` }),
  now: () => new Date(2026, 6, 31, 9, 5),
  ...overrides,
});

test('processMeeting 正常流程用使用者標題', async () => {
  const out = await processMeeting(
    { audioBuffer: Buffer.from('x'), mimeType: 'audio/webm', userTitle: '週會' },
    baseDeps());
  assert.equal(out.title, '週會');
  assert.equal(out.summary, '摘要');
  assert.deepEqual(out.keyPoints, ['點一']);
  assert.equal(out.destination.type, 'markdown');
});

test('processMeeting 無使用者標題時用 AI 建議標題', async () => {
  const out = await processMeeting(
    { audioBuffer: Buffer.from('x'), mimeType: 'audio/webm', userTitle: '' },
    baseDeps());
  assert.equal(out.title, 'AI 標題');
});

test('processMeeting 分析結果不合法時拋 analyze 錯', async () => {
  const deps = baseDeps({ analyze: async () => ({ summary: '', keyPoints: [], transcript: '' }) });
  await assert.rejects(
    () => processMeeting({ audioBuffer: Buffer.from('x'), mimeType: 'audio/webm', userTitle: '' }, deps),
    (e) => e instanceof AppError && e.stage === 'analyze');
});
