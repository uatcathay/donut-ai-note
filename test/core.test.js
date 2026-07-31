import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../src/errors.js';
import { formatStamp } from '../src/clock.js';
import { decideTitle, validateAnalysis } from '../src/pipeline.js';

test('AppError 帶 stage', () => {
  const e = new AppError('analyze', '壞了');
  assert.equal(e.stage, 'analyze');
  assert.equal(e.message, '壞了');
  assert.ok(e instanceof Error);
});

test('formatStamp 產生日期與時間', () => {
  const s = formatStamp(new Date(2026, 6, 31, 9, 5)); // 月份 0-based → 7 月
  assert.deepEqual(s, { date: '2026-07-31', time: '0905' });
});

test('decideTitle：使用者標題優先', () => {
  assert.equal(decideTitle('週會', 'AI 給的', '2026-07-31'), '週會');
});
test('decideTitle：無使用者標題時用建議標題', () => {
  assert.equal(decideTitle('  ', 'AI 給的', '2026-07-31'), 'AI 給的');
});
test('decideTitle：兩者皆空時用日期', () => {
  assert.equal(decideTitle('', '', '2026-07-31'), '會議記錄 2026-07-31');
});

test('validateAnalysis：合法通過', () => {
  validateAnalysis({ suggestedTitle: 'x', summary: '好', keyPoints: ['a'], transcript: '逐字' });
});
test('validateAnalysis：空摘要拋錯', () => {
  assert.throws(() => validateAnalysis({ summary: ' ', keyPoints: ['a'], transcript: 't' }),
    (e) => e instanceof AppError && e.stage === 'analyze');
});
test('validateAnalysis：空重點陣列拋錯', () => {
  assert.throws(() => validateAnalysis({ summary: 's', keyPoints: [], transcript: 't' }),
    (e) => e.stage === 'analyze');
});
test('validateAnalysis：重點含空字串拋錯', () => {
  assert.throws(() => validateAnalysis({ summary: 's', keyPoints: ['a', ' '], transcript: 't' }),
    (e) => e.stage === 'analyze');
});
test('validateAnalysis：空逐字稿拋錯', () => {
  assert.throws(() => validateAnalysis({ summary: 's', keyPoints: ['a'], transcript: '' }),
    (e) => e.stage === 'analyze');
});
