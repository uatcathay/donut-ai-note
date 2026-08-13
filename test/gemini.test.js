import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../src/errors.js';
import { buildPrompt, parseGeminiJson, analyze, formatTimings, describeFailure, withTimeout, stepTimeoutMs, isRetryable, withRetry } from '../src/analyzers/gemini.js';

const MB = 1024 * 1024;

test('stepTimeoutMs：小音檔仍保有原本的 120 秒基本保護', () => {
  const ms = stepTimeoutMs(1.4 * MB);   // 實測 5 分鐘的會議約 1.4MB
  assert.ok(ms >= 120_000, `應至少 120 秒，實得 ${ms}`);
  assert.ok(ms < 130_000, `小檔不該被拉長太多，實得 ${ms}`);
});

test('stepTimeoutMs：兩小時錄音不會再被 120 秒攔腰砍斷', () => {
  // 實測 114.6MB 的兩小時錄音，生成在 120.0s 整被自家逾時中斷
  const ms = stepTimeoutMs(114.6 * MB);
  assert.ok(ms > 360_000, `兩小時的錄音至少要給到 6 分鐘，實得 ${ms}`);
});

test('stepTimeoutMs：再大的音檔也有封頂，不會變成無限等待', () => {
  assert.equal(stepTimeoutMs(10_000 * MB), 900_000);
});


test('buildPrompt 要求繁中且禁止講者標記', () => {
  const p = buildPrompt();
  assert.match(p, /繁體中文/);
  assert.match(p, /不要標記講者|講者標籤/);
  assert.match(p, /suggestedTitle/);
});

test('buildPrompt 不鎖死摘要句數，改為依會議內容伸縮', () => {
  const p = buildPrompt();
  // 舊版寫死「3-5 句的摘要」，長會議與短會議拿到一樣的篇幅
  assert.doesNotMatch(p, /\d+\s*-\s*\d+\s*句/);
  assert.match(p, /依會議實際內容決定/);
  assert.match(p, /該長就長/);
});

// Gemini 免費版尖峰時段會回 503 UNAVAILABLE，這是對方的容量問題、過幾分鐘就好。
// 實測一段 15 分鐘的錄音就這樣失敗過，而使用者只能自己一直按重試。
const err503 = () => new Error('got status: 503 {"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}');
const err429 = () => new Error('got status: 429 {"error":{"code":429,"message":"Quota exceeded","status":"RESOURCE_EXHAUSTED"}}');

test('isRetryable：503／UNAVAILABLE 屬於暫時性錯誤，值得重試', () => {
  assert.equal(isRetryable(err503()), true);
});

test('isRetryable：429 配額用盡不重試（免費版額度不會在幾秒內恢復）', () => {
  assert.equal(isRetryable(err429()), false);
});

test('isRetryable：一般錯誤與自家逾時都不重試', () => {
  assert.equal(isRetryable(new Error('壞掉了')), false);
  assert.equal(isRetryable(new AppError('analyze', '分析錄音超過 464 秒沒有回應，請重試。')), false);
});

test('withRetry：暫時性錯誤會重試，成功就回傳結果', async () => {
  let calls = 0;
  const slept = [];
  const out = await withRetry(async () => {
    calls += 1;
    if (calls < 3) throw err503();
    return 'ok';
  }, { delays: [10, 20, 30], sleep: async (ms) => { slept.push(ms); }, log: () => {} });
  assert.equal(out, 'ok');
  assert.equal(calls, 3);
  assert.deepEqual(slept, [10, 20]);
});

test('withRetry：重試用完仍失敗就把錯誤丟出來', async () => {
  let calls = 0;
  await assert.rejects(
    () => withRetry(async () => { calls += 1; throw err503(); },
      { delays: [10, 20], sleep: async () => {}, log: () => {} }),
    /503/);
  assert.equal(calls, 3, '應為首次加兩次重試');
});

test('withRetry：不可重試的錯誤立刻丟出，不浪費時間等待', async () => {
  let calls = 0;
  const slept = [];
  await assert.rejects(
    () => withRetry(async () => { calls += 1; throw err429(); },
      { delays: [10, 20], sleep: async (ms) => { slept.push(ms); }, log: () => {} }),
    /429/);
  assert.equal(calls, 1);
  assert.deepEqual(slept, []);
});

test('describeFailure：503 翻成人看得懂的話，不要把 JSON 原文丟到畫面上', () => {
  const e = describeFailure(err503(), '分析');
  assert.equal(e.stage, 'analyze');
  assert.doesNotMatch(e.message, /\{|"code"|UNAVAILABLE/);
  assert.match(e.message, /忙碌|尖峰/);
  assert.match(e.message, /稍後/);
});

test('describeFailure：429 要說是用量上限，而不是叫人一直重試', () => {
  const e = describeFailure(err429(), '分析');
  assert.doesNotMatch(e.message, /\{|"code"/);
  assert.match(e.message, /用量|額度/);
});

test('parseGeminiJson 解析純 JSON', () => {
  const obj = parseGeminiJson('{"summary":"s","keyPoints":["a"],"transcript":"t","suggestedTitle":"x"}');
  assert.equal(obj.summary, 's');
});

test('parseGeminiJson 去除 ```json 圍欄', () => {
  const raw = '```json\n{"summary":"s","keyPoints":["a"],"transcript":"t","suggestedTitle":"x"}\n```';
  assert.equal(parseGeminiJson(raw).transcript, 't');
});

test('parseGeminiJson 非 JSON 拋錯', () => {
  assert.throws(() => parseGeminiJson('抱歉我不會'), (e) => e instanceof AppError && e.stage === 'analyze');
});

test('analyze 注入 generate 回傳解析結果', async () => {
  const fakeGenerate = async () => '{"summary":"開會摘要","keyPoints":["點一"],"transcript":"逐字","suggestedTitle":"週會"}';
  const out = await analyze(Buffer.from('x'), 'audio/webm', { generate: fakeGenerate });
  assert.equal(out.suggestedTitle, '週會');
  assert.equal(out.keyPoints[0], '點一');
});

test('formatTimings 標出三個階段的秒數與佔比，用來找出瓶頸', () => {
  const line = formatTimings({ uploadMs: 1200, waitMs: 1500, generateMs: 8300, bytes: 2 * 1024 * 1024 });
  assert.match(line, /上傳 1\.2s \(11%\)/);
  assert.match(line, /等待 1\.5s \(14%\)/);
  assert.match(line, /生成 8\.3s \(75%\)/);
  assert.match(line, /合計 11\.0s/);
  assert.match(line, /2\.0MB/);
});

test('formatTimings 合計為 0 時不會除以零', () => {
  const line = formatTimings({ uploadMs: 0, waitMs: 0, generateMs: 0, bytes: 0 });
  assert.match(line, /合計 0\.0s/);
  assert.doesNotMatch(line, /NaN/);
});

test('describeFailure 把 undici 的 fetch failed 換成看得懂的說明', () => {
  const e = describeFailure(new TypeError('fetch failed'), '分析');
  assert.equal(e.stage, 'analyze');
  assert.match(e.message, /連線/);
  assert.doesNotMatch(e.message, /fetch failed/);
});

test('describeFailure 保留原本就看得懂的錯誤訊息', () => {
  const e = describeFailure(new Error('API key not valid'), '分析');
  assert.equal(e.stage, 'analyze');
  assert.match(e.message, /API key not valid/);
});

test('withTimeout 在時限內完成則原樣回傳結果', async () => {
  const v = await withTimeout(Promise.resolve('ok'), 1000, '分析');
  assert.equal(v, 'ok');
});

test('withTimeout 逾時拋出帶階段與秒數的錯誤，而不是無限等待', async () => {
  const never = new Promise(() => {});
  await assert.rejects(
    () => withTimeout(never, 50, '分析'),
    (e) => e.stage === 'analyze' && /分析/.test(e.message) && /沒有回應/.test(e.message),
  );
});
