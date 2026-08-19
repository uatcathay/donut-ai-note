import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../src/errors.js';
import { buildPrompt, parseGeminiJson, analyze, formatTimings, describeFailure, withTimeout, stepTimeoutMs, isRetryable, withRetry, nextQuotaResetAt, describeQuotaReset, redactSecrets } from '../src/analyzers/gemini.js';

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

test('buildPrompt 要求依議題分段，並另外產出待辦事項', () => {
  const p = buildPrompt();
  assert.match(p, /topics/);
  assert.match(p, /nextSteps/);
  assert.doesNotMatch(p, /"summary"/, '舊的單段摘要欄位已由 topics 取代');
  assert.doesNotMatch(p, /"keyPoints"/);
});

test('buildPrompt 要求略過寒暄與離題閒聊', () => {
  assert.match(buildPrompt(), /寒暄|閒聊/);
});

// 筆記正文才是這個 App 大部分的文字，排版規則不交代的話全靠模型自由發揮
test('buildPrompt 交代中英夾雜的排版規則', () => {
  const p = buildPrompt();
  assert.match(p, /全形/);
  assert.match(p, /半形/);
  assert.match(p, /空格/);
});

test('prompt 自身也遵守排版規則：中文與英數字之間要有半形空格', () => {
  const p = buildPrompt();
  const bad = p.match(/[一-鿿][A-Za-z0-9]|[A-Za-z0-9][一-鿿]/g) || [];
  assert.deepEqual(bad, [], `prompt 裡有中英黏在一起的地方：${bad.join('、')}`);
});

test('buildPrompt 要求待辦沒明講負責人時就不要提負責人', () => {
  const p = buildPrompt();
  assert.match(p, /負責人/);
  assert.match(p, /不要(自行)?臆測|沒有明確|未指明/);
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

test('isRetryable：一般錯誤不重試（逾時走另一條規則，見下方 withRetry）', () => {
  assert.equal(isRetryable(new Error('壞掉了')), false);
  assert.equal(isRetryable(new AppError('analyze', '分析錄音超過 464 秒沒有回應，請重試。')), false);
});

test('withTimeout 逾時錯誤帶 timedOut 記號，讓重試邏輯認得出來', async () => {
  await assert.rejects(
    () => withTimeout(new Promise(() => {}), 5, '分析錄音'),
    (e) => e.timedOut === true);
});

// Gemini 忙碌時有兩種表現：直接回 503，或掛住不回應直到我們把它砍掉。
// 實測後者：同一個檔案當下逾時（>132s），隔幾分鐘重跑只要 15.8s。
test('withRetry：逾時會自動重試一次，且不浪費時間退避', async () => {
  let calls = 0;
  const slept = [];
  const timeout = () => Object.assign(new AppError('analyze', '逾時'), { timedOut: true });
  const out = await withRetry(async () => {
    calls += 1;
    if (calls === 1) throw timeout();
    return 'ok';
  }, { sleep: async (ms) => { slept.push(ms); }, log: () => {} });
  assert.equal(out, 'ok');
  assert.equal(calls, 2);
  assert.deepEqual(slept, [], '逾時本身已經等很久了，不該再退避');
});

test('withRetry：逾時只重試一次，第二次逾時就放棄', async () => {
  let calls = 0;
  const timeout = () => Object.assign(new AppError('analyze', '逾時'), { timedOut: true });
  await assert.rejects(
    () => withRetry(async () => { calls += 1; throw timeout(); }, { sleep: async () => {}, log: () => {} }),
    (e) => e.timedOut === true);
  assert.equal(calls, 2, '首次加一次重試就該停手，否則兩小時的錄音會等到天荒地老');
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

// 免費版每日額度在「太平洋時間午夜」重置（官方文件明載）。
// 換算成台灣時間會隨美國日光節約時間在 15:00 與 16:00 之間變動，所以只能算、不能寫死。
test('nextQuotaResetAt：夏令時間下一次重置是台灣時間 15:00', () => {
  // 2026-08-19 10:00 台北（= 08-18 19:00 太平洋夏令時間）
  assert.equal(nextQuotaResetAt(new Date('2026-08-19T02:00:00Z')).toISOString(),
    '2026-08-19T07:00:00.000Z');   // = 2026-08-19 15:00 台北
});

test('nextQuotaResetAt：冬令時間會自動變成台灣時間 16:00，不是寫死 15:00', () => {
  // 2026-01-15 10:00 台北（= 01-14 18:00 太平洋標準時間）
  assert.equal(nextQuotaResetAt(new Date('2026-01-15T02:00:00Z')).toISOString(),
    '2026-01-15T08:00:00.000Z');   // = 2026-01-15 16:00 台北
});

test('describeQuotaReset：還沒到重置時間就說「今天」', () => {
  assert.equal(describeQuotaReset(new Date('2026-08-19T02:00:00Z'), 'Asia/Taipei'), '今天 15:00');
});

test('describeQuotaReset：過了重置時間就說「明天」，不能還講今天', () => {
  // 2026-08-19 16:00 台北，當天的重置已經過了
  assert.equal(describeQuotaReset(new Date('2026-08-19T08:00:00Z'), 'Asia/Taipei'), '明天 15:00');
});

test('describeFailure：每日額度用盡要講出確切的重置時間', () => {
  const e = describeFailure(err429(), '分析',
    { now: new Date('2026-08-19T02:00:00Z'), timeZone: 'Asia/Taipei' });
  assert.match(e.message, /每日/);
  assert.match(e.message, /今天 15:00/);
  assert.doesNotMatch(e.message, /\{|"code"/);
});

// 429 不一定是日額度用盡——每分鐘的頻率上限也回 429，但那個等一分鐘就好。
// 一律叫人「明天再來」會讓人白白放棄一份錄音。
const err429PerMinute = () => new Error('got status: 429 {"error":{"code":429,"status":"RESOURCE_EXHAUSTED","details":[{"@type":"type.googleapis.com/google.rpc.QuotaFailure","violations":[{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}]}]}}');

test('describeFailure：每分鐘上限只要等一分鐘，不該叫人明天再來', () => {
  const e = describeFailure(err429PerMinute(), '分析',
    { now: new Date('2026-08-19T02:00:00Z'), timeZone: 'Asia/Taipei' });
  assert.match(e.message, /每分鐘/);
  assert.doesNotMatch(e.message, /每日|明天|15:00/);
});

// 錯誤原文只有在寫進 log 的那一刻存在，之後就被翻成人話了。
// 但原文可能夾帶金鑰，不能原封不動寫進檔案。
test('redactSecrets 把 Google API 金鑰遮掉', () => {
  const out = redactSecrets('請求失敗 key=AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q 結束');
  assert.doesNotMatch(out, /AIzaSy/);
  assert.match(out, /請求失敗/);
  assert.match(out, /結束/);
});

test('parseGeminiJson 解析純 JSON', () => {
  const obj = parseGeminiJson('{"topics":[{"title":"T","points":["a"]}],"nextSteps":[],"transcript":"t","suggestedTitle":"x"}');
  assert.equal(obj.topics[0].title, 'T');
});

test('parseGeminiJson 去除 ```json 圍欄', () => {
  const raw = '```json\n{"topics":[{"title":"T","points":["a"]}],"nextSteps":[],"transcript":"t","suggestedTitle":"x"}\n```';
  assert.equal(parseGeminiJson(raw).transcript, 't');
});

test('parseGeminiJson 非 JSON 拋錯', () => {
  assert.throws(() => parseGeminiJson('抱歉我不會'), (e) => e instanceof AppError && e.stage === 'analyze');
});

test('analyze 注入 generate 回傳解析結果', async () => {
  const fakeGenerate = async () => '{"topics":[{"title":"議題","points":["點一"]}],"nextSteps":[],"transcript":"逐字","suggestedTitle":"週會"}';
  const out = await analyze(Buffer.from('x'), 'audio/webm', { generate: fakeGenerate });
  assert.equal(out.suggestedTitle, '週會');
  assert.equal(out.topics[0].points[0], '點一');
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
