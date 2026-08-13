import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../src/errors.js';
import { processMeeting } from '../src/pipeline.js';

const baseDeps = (overrides = {}) => ({
  analyze: async () => ({ suggestedTitle: 'AI 標題', summary: '摘要', keyPoints: ['點一'], transcript: '逐字' }),
  writeOutput: async (result) => ({ type: 'markdown', filePath: `/tmp/${result.title}.md` }),
  now: () => new Date(2026, 6, 31, 9, 5),
  // 注入假的存檔／刪檔，測試不該碰真實磁碟
  saveRecording: async () => '/tmp/錄音.webm',
  discardRecording: async () => {},
  ...overrides,
});

test('processMeeting 分析前先把錄音落地，成功後才刪掉', async () => {
  const calls = [];
  const deps = baseDeps({
    saveRecording: async (buf, name) => { calls.push(`save:${name}`); return `/tmp/${name}`; },
    analyze: async () => { calls.push('analyze'); return { suggestedTitle: 'A', summary: 's', keyPoints: ['k'], transcript: 't' }; },
    writeOutput: async () => { calls.push('write'); return { type: 'markdown', filePath: '/tmp/a.md' }; },
    discardRecording: async (p) => { calls.push(`discard:${p}`); },
  });
  await processMeeting({ audioBuffer: Buffer.from('x'), mimeType: 'audio/webm', userTitle: '週會' }, deps);
  assert.deepEqual(calls, [
    'save:錄音_2026-07-31_0905_週會.webm',
    'analyze',
    'write',
    'discard:/tmp/錄音_2026-07-31_0905_週會.webm',
  ]);
});

test('processMeeting 分析失敗時保留錄音，並在錯誤訊息裡告知檔案還在', async () => {
  let discarded = false;
  const deps = baseDeps({
    saveRecording: async (buf, name) => `/tmp/${name}`,
    analyze: async () => { throw new AppError('analyze', 'Gemini 忙碌'); },
    discardRecording: async () => { discarded = true; },
  });
  await assert.rejects(
    () => processMeeting({ audioBuffer: Buffer.from('x'), mimeType: 'audio/webm', userTitle: '週會' }, deps),
    (e) => {
      assert.equal(e.stage, 'analyze');
      assert.match(e.message, /Gemini 忙碌/);
      assert.match(e.message, /錄音_2026-07-31_0905_週會\.webm/);
      return true;
    });
  assert.equal(discarded, false, '失敗時不該刪掉錄音');
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
