import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../src/errors.js';
import { processMeeting, validateAnalysis } from '../src/pipeline.js';
import { listCompleted, clearCompleted } from '../src/completed.js';
import { getProgress, endAnalysis } from '../src/progress.js';

const baseDeps = (overrides = {}) => ({
  analyze: async () => ({
    suggestedTitle: 'AI 標題',
    topics: [{ title: '議題一', points: ['點一'] }],
    nextSteps: ['待辦一'],
    transcript: '逐字',
  }),
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
    analyze: async () => {
      calls.push('analyze');
      return { suggestedTitle: 'A', topics: [{ title: 'T', points: ['k'] }], nextSteps: [], transcript: 't' };
    },
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

test('重試既有錄音時不再存一份，成功後刪掉的是原檔', async () => {
  const calls = [];
  const deps = baseDeps({
    saveRecording: async () => { calls.push('save'); return '/tmp/不該被呼叫.webm'; },
    discardRecording: async (p) => { calls.push(`discard:${p}`); },
  });
  await processMeeting(
    {
      audioBuffer: Buffer.from('x'),
      mimeType: 'audio/webm',
      userTitle: '週會',
      recordingPath: '/tmp/rec/錄音_2026-08-18_1419_週會.webm',
    },
    deps);
  assert.deepEqual(calls, ['discard:/tmp/rec/錄音_2026-08-18_1419_週會.webm'],
    '重試不該再存一份，否則失敗時清單會出現兩筆');
});

test('重試既有錄音再次失敗時，原檔要留著讓使用者能再試', async () => {
  let discarded = false;
  const deps = baseDeps({
    analyze: async () => { throw new AppError('analyze', 'Gemini 忙碌'); },
    discardRecording: async () => { discarded = true; },
  });
  await assert.rejects(
    () => processMeeting(
      {
        audioBuffer: Buffer.from('x'),
        mimeType: 'audio/webm',
        userTitle: '週會',
        recordingPath: '/tmp/rec/錄音_2026-08-18_1419_週會.webm',
      },
      deps),
    (e) => e.stage === 'analyze');
  assert.equal(discarded, false);
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
  assert.deepEqual(out.topics, [{ title: '議題一', points: ['點一'] }]);
  assert.deepEqual(out.nextSteps, ['待辦一']);
  assert.equal(out.destination.type, 'markdown');
});

test('processMeeting 無使用者標題時用 AI 建議標題', async () => {
  const out = await processMeeting(
    { audioBuffer: Buffer.from('x'), mimeType: 'audio/webm', userTitle: '' },
    baseDeps());
  assert.equal(out.title, 'AI 標題');
});

test('processMeeting 分析結果不合法時拋 analyze 錯', async () => {
  const deps = baseDeps({ analyze: async () => ({ topics: [], nextSteps: [], transcript: '' }) });
  await assert.rejects(
    () => processMeeting({ audioBuffer: Buffer.from('x'), mimeType: 'audio/webm', userTitle: '' }, deps),
    (e) => e instanceof AppError && e.stage === 'analyze');
});

test('validateAnalysis：沒有任何議題就是壞資料，不能靜默寫出空白記錄', () => {
  assert.throws(
    () => validateAnalysis({ topics: [], nextSteps: [], transcript: 't' }),
    (e) => e instanceof AppError && /議題/.test(e.message));
});

test('validateAnalysis：議題缺標題或內容都要擋下', () => {
  const t = 't';
  assert.throws(() => validateAnalysis({ topics: [{ title: '', points: ['a'] }], nextSteps: [], transcript: t }), AppError);
  assert.throws(() => validateAnalysis({ topics: [{ title: 'T', points: [] }], nextSteps: [], transcript: t }), AppError);
  assert.throws(() => validateAnalysis({ topics: [{ title: 'T', points: [''] }], nextSteps: [], transcript: t }), AppError);
});

test('validateAnalysis：沒有待辦事項是正常的，不該被當成錯誤', () => {
  validateAnalysis({ topics: [{ title: 'T', points: ['a'] }], nextSteps: [], transcript: 't' });
});

test('validateAnalysis：待辦事項含空項目要擋下', () => {
  assert.throws(
    () => validateAnalysis({ topics: [{ title: 'T', points: ['a'] }], nextSteps: [''], transcript: 't' }),
    AppError);
});

// 前端只在清單上有東西時才輪詢。若「刪掉錄音」與「記下已完成」之間存在空窗，
// 輪詢剛好落在那一刻就會停掉，已完成那一列便再也不會自己出現。
test('成功時先記下已完成再刪錄音，清單不會出現空窗', async () => {
  clearCompleted();
  let countWhenDiscarding = null;
  await processMeeting(
    { audioBuffer: Buffer.from('x'), mimeType: 'audio/webm', userTitle: '設計評審' },
    baseDeps({
      saveRecording: async (buf, name) => `/tmp/${name}`,
      discardRecording: async () => { countWhenDiscarding = listCompleted().length; },
    }));
  assert.equal(countWhenDiscarding, 1, '刪檔當下，已完成那一列必須已經存在');
  clearCompleted();
});

// 實際遇到的 bug：進度原本在 Gemini 回應的當下就結束，但那時候筆記還沒寫進 Notion、
// 也還沒登記已完成。前端看到「不在跑了」而那筆還躺在磁碟上，就判定成失敗——
// 畫面同時出現紅色「分析未成功」和清單上的「已完成」。
// 進度必須涵蓋整個工作，不是只有 Gemini 那一段。
test('進度要撐到筆記寫完、已完成登記好為止', async () => {
  clearCompleted();
  endAnalysis();
  const seen = [];
  await processMeeting(
    { audioBuffer: Buffer.from('x'), mimeType: 'audio/webm', userTitle: '設計評審' },
    baseDeps({
      analyze: async () => {
        seen.push(['analyze', getProgress().active]);
        return { suggestedTitle: 'A', topics: [{ title: 'T', points: ['k'] }], nextSteps: [], transcript: 't' };
      },
      writeOutput: async () => {
        seen.push(['write', getProgress().active]);
        return { type: 'markdown', filePath: '/tmp/a.md' };
      },
      discardRecording: async () => { seen.push(['discard', getProgress().active]); },
    }));
  assert.deepEqual(seen, [['analyze', true], ['write', true], ['discard', true]],
    '寫出筆記與刪檔的期間，進度都還要是 active');
  assert.equal(getProgress().active, false, '全部做完才結束');
  clearCompleted();
});

test('分析失敗時進度一樣要結束，否則之後所有分析都會被當成忙碌而擋下', async () => {
  endAnalysis();
  await assert.rejects(() => processMeeting(
    { audioBuffer: Buffer.from('x'), mimeType: 'audio/webm', userTitle: '' },
    baseDeps({ analyze: async () => { throw new AppError('analyze', '壞了'); } })));
  assert.equal(getProgress().active, false);
});
