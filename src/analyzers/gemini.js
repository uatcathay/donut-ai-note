import { AppError } from '../errors.js';
import { startAnalysis, setStage, noteRetry, endAnalysis } from '../progress.js';

// gemini-2.5-flash 已對新帳號關閉；用 flash-latest 別名指向當前穩定的免費 flash 模型
const MODEL = 'gemini-flash-latest';

export function buildPrompt() {
  return [
    '你是會議記錄助理。請聽這段會議錄音，並以「繁體中文」輸出結果。',
    '只回傳一個 JSON 物件，不要有多餘文字或 markdown 圍欄，欄位如下：',
    '{',
    '  "suggestedTitle": "依會議內容給的簡短標題",',
    '  "summary": "會議摘要",',
    '  "keyPoints": ["重點一", "重點二"],',
    '  "transcript": "完整逐字稿，以自然語意分段"',
    '}',
    '注意：逐字稿不要加上「說話者A/B」之類的講者標籤，純段落即可。',
    // 舊版寫死「3-5 句的摘要」，導致 50 分鐘的會議與 5 分鐘的會議拿到一樣的篇幅。
    // 改為交由模型依內容判斷，並明確給出兩端的界線，避免它退回保守的短摘要。
    '摘要與重點的長度請依會議實際內容決定，不要壓縮成固定篇幅：',
    '- 短會議或議題單純時，幾句話、幾個重點即可，不要灌水湊字數。',
    '- 長會議或議題較多時，請確保每個被討論到的主題都有涵蓋到，該長就長。',
    '- 重點條列以「一項一則可行動或可查證的資訊」為準，不要為了湊數把一句話拆成兩條。',
  ].join('\n');
}

export function parseGeminiJson(text) {
  const s = String(text);
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new AppError('analyze', 'Gemini 回傳非 JSON');
  }
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    throw new AppError('analyze', 'Gemini 回傳 JSON 解析失敗');
  }
}

// 每個遠端往返的逾時上限。沒有這道保護時，Gemini 一旦不回應，
// 使用者就只能看著「分析中」無限轉下去（實測曾卡住三分鐘以上才在網路層失敗）。
//
// 但這個上限必須隨音檔長度伸縮：120 秒是以五分鐘的會議（音檔 1.4MB、生成 16 秒）
// 為樣本訂的，而兩小時的錄音（114.6MB）光是生成就在 120.0s 整被自家逾時攔腰砍斷
// ——Gemini 當時仍在正常工作。上傳同理：114.6MB 實測 21.7s，網路慢一點就會逼近上限。
const BASE_TIMEOUT_MS = 120_000;
const TIMEOUT_PER_MB_MS = 3_000;
const MAX_TIMEOUT_MS = 900_000;   // 封頂，避免退化成無限等待

export function stepTimeoutMs(bytes) {
  const mb = bytes / 1024 / 1024;
  return Math.min(MAX_TIMEOUT_MS, BASE_TIMEOUT_MS + Math.round(mb * TIMEOUT_PER_MB_MS));
}

// 這個模型預設會做 thinking，而實測它在這個任務上思考的 token 是實際輸出的兩倍，
// 白白多花約 40% 的時間。thinkingBudget: 0 會被拒絕（400），但給一個很小的預算
// 就等同關閉——實測 thinking 實際用量為 0，耗時 25.5s → 16.1s，
// 且輸出品質（標題、摘要、重點數、逐字稿長度）沒有可見差異。
const THINKING_BUDGET = 128;

export function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => {
        const err = new AppError('analyze', `${label}超過 ${Math.round(ms / 1000)} 秒沒有回應，請重試。`);
        err.timedOut = true;   // 讓 withRetry 認得出這是「掛住」而非一般失敗
        reject(err);
      },
      ms,
    );
    timer.unref?.();   // 不要因為這個計時器而讓程序無法結束
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// 免費版尖峰時段會回 503 UNAVAILABLE，是 Google 那端的容量問題、過幾分鐘就好。
// 這種錯誤自己重試遠比叫使用者一直按重試合理——而且檔案已經上傳完，重試只要重打生成。
export function isRetryable(err) {
  if (err instanceof AppError) return false;   // 自家的逾時／驗證錯誤重試也沒用
  const raw = String(err?.message || err);
  if (/RESOURCE_EXHAUSTED|"code"\s*:\s*429/.test(raw)) return false;   // 配額用盡不會在幾秒內恢復
  return /UNAVAILABLE|INTERNAL|high demand|overloaded|"code"\s*:\s*(500|502|503|504)/i.test(raw);
}

const RETRY_DELAYS_MS = [5_000, 15_000, 45_000];

// 逾時另計，而且只給一次。Gemini 忙碌時不一定回 503，也可能掛住不回應——
// 實測同一個檔案當下逾時（>132s），隔幾分鐘重跑只要 15.8s，所以重試是值得的。
// 但每次嘗試都要吃掉一份完整逾時額度，給太多次會讓長錄音等到天荒地老。
const TIMEOUT_RETRIES = 1;

export async function withRetry(attempt, opts = {}) {
  const delays = opts.delays || RETRY_DELAYS_MS;
  const timeoutRetries = opts.timeoutRetries ?? TIMEOUT_RETRIES;
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const log = opts.log || console.log;
  const label = opts.label || '';
  // 重試必須讓前端看得見，否則使用者只看到轉圈，分不出「還在努力」與「已經死了」
  const onRetry = opts.onRetry || (() => {});
  let transientUsed = 0;
  let timeoutUsed = 0;
  for (;;) {
    try {
      return await attempt();
    } catch (err) {
      if (err?.timedOut && timeoutUsed < timeoutRetries) {
        timeoutUsed += 1;
        log(`[重試] ${label}逾時，立即重試（第 ${timeoutUsed}/${timeoutRetries} 次；逾時本身已等很久，不再退避）`);
        onRetry('timeout', timeoutUsed, timeoutRetries);
        continue;
      }
      if (isRetryable(err) && transientUsed < delays.length) {
        const wait = delays[transientUsed];
        transientUsed += 1;
        log(`[重試] ${label}遇到暫時性錯誤，${wait / 1000} 秒後重試（第 ${transientUsed}/${delays.length} 次）`);
        onRetry('busy', transientUsed, delays.length);
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
}

// undici 的網路錯誤訊息是「fetch failed」，Gemini 的則是一整包 JSON，
// 兩者直接丟給使用者看都等於沒說。原文留在 log，畫面上給人話。
export function describeFailure(err, label) {
  if (err instanceof AppError) return err;
  const raw = String(err?.message || err);
  if (/fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up/i.test(raw)) {
    return new AppError('analyze', `${label}時連線 Gemini 失敗，請確認網路後用同一段錄音重試。`);
  }
  if (/RESOURCE_EXHAUSTED|"code"\s*:\s*429/.test(raw)) {
    return new AppError('analyze', '已達 Gemini 免費版的用量上限，請稍後或明天再用同一段錄音重試。');
  }
  if (/UNAVAILABLE|high demand|overloaded|"code"\s*:\s*(500|502|503|504)/i.test(raw)) {
    return new AppError('analyze', 'Gemini 目前忙碌（免費版尖峰時段），已自動重試多次仍未成功。這是對方的暫時性問題，稍後用同一段錄音重試即可。');
  }
  return new AppError('analyze', `${label}失敗：${raw}`);
}

// 分析總耗時是三個接連的遠端往返加起來的，但從外面看只是「很久」。
// 印出各階段的秒數與佔比，才知道要優化哪一段（別憑感覺猜）。
export function formatTimings({ uploadMs, waitMs, generateMs, bytes }) {
  const total = uploadMs + waitMs + generateMs;
  const sec = (ms) => `${(ms / 1000).toFixed(1)}s`;
  const pct = (ms) => `${total === 0 ? 0 : Math.round((ms / total) * 100)}%`;
  const mb = (bytes / 1024 / 1024).toFixed(1);
  return `[計時] 上傳 ${sec(uploadMs)} (${pct(uploadMs)})｜等待 ${sec(waitMs)} (${pct(waitMs)})`
    + `｜生成 ${sec(generateMs)} (${pct(generateMs)})｜合計 ${sec(total)}（音檔 ${mb}MB）`;
}

async function callGemini(prompt, audioBuffer, mimeType) {
  const { GoogleGenAI, createUserContent, createPartFromUri } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const blob = new Blob([audioBuffer], { type: mimeType });

  const timeoutMs = stepTimeoutMs(audioBuffer.length);

  startAnalysis();
  const t0 = Date.now();
  let tUploaded = t0;
  let tReady = t0;
  let polls = 0;

  const report = (tag) => console.log(
    formatTimings({
      uploadMs: tUploaded - t0,
      waitMs: tReady - tUploaded,
      generateMs: Date.now() - tReady,
      bytes: audioBuffer.length,
    }) + `　輪詢 ${polls} 次${tag}`,
  );

  try {
    let file = await withTimeout(
      ai.files.upload({ file: blob, config: { mimeType } }), timeoutMs, '上傳音檔');
    tUploaded = Date.now();

    // 輪詢也要有上限，否則檔案一直停在 PROCESSING 就會無限迴圈
    while (file.state === 'PROCESSING') {
      if (Date.now() - tUploaded > timeoutMs) {
        throw new AppError('analyze', '音檔在雲端處理逾時，請重試。');
      }
      await new Promise((r) => setTimeout(r, 1500));
      file = await withTimeout(ai.files.get({ name: file.name }), timeoutMs, '查詢音檔狀態');
      polls += 1;
    }
    tReady = Date.now();
    setStage('analyze');

    if (file.state === 'FAILED') throw new AppError('analyze', '音檔上傳處理失敗');
    // 只重試生成，不重傳檔案——檔案已在 Gemini 端（114.6MB 上傳實測要 57 秒）。
    // 每次嘗試各自吃一份完整逾時額度，退避時間不佔用它。
    const res = await withRetry(() => withTimeout(ai.models.generateContent({
      model: MODEL,
      contents: createUserContent([createPartFromUri(file.uri, file.mimeType), prompt]),
      config: { thinkingConfig: { thinkingBudget: THINKING_BUDGET } },
    }), timeoutMs, '分析錄音'), { label: '分析錄音', onRetry: noteRetry });

    report('');
    return res.text;
  } catch (err) {
    report('　← 失敗');   // 失敗時同樣印出計時，才知道卡在哪一段
    throw describeFailure(err, '分析');
  } finally {
    endAnalysis();
  }
}

export async function analyze(audioBuffer, mimeType, deps = {}) {
  const generate = deps.generate || callGemini;
  const raw = await generate(buildPrompt(), audioBuffer, mimeType);
  return parseGeminiJson(raw);
}
