import { AppError } from '../errors.js';
import { setStage, noteRetry } from '../progress.js';
import { log as writeLog } from '../log.js';
import { noteQuotaExhausted, clearQuota } from '../quota.js';

// gemini-2.5-flash 已對新帳號關閉；用 flash-latest 別名指向當前穩定的免費 flash 模型
const MODEL = 'gemini-flash-latest';

export function buildPrompt() {
  return [
    '你是會議記錄助理。請聽這段會議錄音，並以「繁體中文」輸出結果。',
    '只回傳一個 JSON 物件，不要有多餘文字或 markdown 圍欄，欄位如下：',
    '{',
    '  "suggestedTitle": "依會議內容給的簡短標題",',
    '  "topics": [',
    '    { "title": "議題標題", "points": ["這個議題下的重點一", "重點二"] }',
    '  ],',
    '  "nextSteps": ["待辦事項一", "待辦事項二"],',
    '  "transcript": "完整逐字稿，以自然語意分段"',
    '}',
    '注意：逐字稿不要加上「說話者 A/B」之類的講者標籤，純段落即可。',
    // 筆記正文是這個 App 大部分的文字。不交代排版規則的話，模型的中英混排會忽鬆忽緊。
    '排版規則（四個欄位都適用）：',
    '- 中文用全形字，英文與數字用半形。',
    '- 標點符號跟著所在語言：中文句子用全形標點，英文句子用半形標點。',
    '- 中文字與英數字相鄰時，中間加一個半形空格。',
    '- 全形標點與英數字相鄰時不要加空格。',
    'topics：把會議依實際討論的議題分段，一個議題一個物件。',
    '- title 是該議題的簡短標題，直接描述那段在談什麼，不要用「議題一」這種編號。',
    '- points 是該議題下的重點，以列點呈現，一項一則可行動或可查證的資訊。',
    '- 略過寒暄、問候與離題閒聊，那些不構成議題。',
    'nextSteps：會議中談定的待辦事項，寫成「要做什麼」，有講到期限就一併寫入。',
    '- 會議中有明確指出負責人時才寫負責人；沒有明講就只寫要做什麼，不要臆測是誰。',
    '- 沒有任何待辦事項時給空陣列，不要為了填滿而杜撰。',
    // 舊版寫死「3-5 句的摘要」，導致 50 分鐘的會議與 5 分鐘的會議拿到一樣的篇幅。
    // 改為交由模型依內容判斷，並明確給出兩端的界線，避免它退回保守的短摘要。
    '長度請依會議實際內容決定，不要壓縮成固定篇幅：',
    '- 短會議或議題單純時，一兩個議題、幾個重點即可，不要灌水湊字數。',
    '- 長會議或議題較多時，請確保每個被討論到的主題都有涵蓋到，該長就長。',
    '- 不要為了湊數把一句話拆成兩條。',
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
  const log = opts.log || writeLog;
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

// 官方文件：「Requests per day (RPD) quotas reset at midnight Pacific time.」
// 換算成台灣時間會隨美國日光節約時間在 15:00 與 16:00 之間跳動，所以要算、不能寫死。
export function nextQuotaResetAt(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', hour12: false,
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(now).map((p) => [p.type, p.value]));
  // 午夜在部分 ICU 版本會回 24 而不是 0
  const intoDay = (Number(parts.hour) % 24) * 3600 + Number(parts.minute) * 60 + Number(parts.second);
  return new Date(now.getTime() + (86_400 - intoDay) * 1000);
}

// 重置一定落在 24 小時內，所以本地時間只會是今天或明天。
// timeZone 留白時用本機時區——這是本機工具，看的人就在這個時區（同 log.js）。
export function describeQuotaReset(now = new Date(), timeZone = undefined) {
  const at = nextQuotaResetAt(now);
  const day = (d) => new Intl.DateTimeFormat('en-CA',
    { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const clock = new Intl.DateTimeFormat('en-GB',
    { timeZone, hour12: false, hour: '2-digit', minute: '2-digit' }).format(at);
  return `${day(at) === day(now) ? '今天' : '明天'} ${clock}`;
}

// 錯誤原文要寫進 log 才有證據可查，但原文可能夾帶金鑰，不能原封不動落地。
export function redactSecrets(text) {
  return String(text).replace(/AIza[0-9A-Za-z_-]{10,}/g, 'AIza***');
}

// 分析要拿到音檔，所以整份會上傳到 Gemini。那份跟本機的是兩個獨立的複本：
// 本機那份成功後就刪了，雲端那份沒人刪的話會留到 48 小時後才自動過期。
// 會議錄音是敏感內容，而我們需要它的時間只有那幾分鐘。
//
// 刪不掉不算失敗：筆記已經寫好了，比清不掉一個暫存檔重要得多，
// 而且就算真的刪不掉，它終究會自己過期。
export async function discardUploaded(ai, fileName, log = writeLog) {
  if (!fileName) return false;   // 連上傳都沒成功，沒有東西可刪
  try {
    await ai.files.delete({ name: fileName });
    return true;
  } catch (err) {
    log(`[清理] 雲端音檔刪除失敗（${fileName}），48 小時後會自動過期：`
      + redactSecrets(err?.message || err));
    return false;
  }
}

// 429 有兩種：每分鐘的頻率上限等一分鐘就好，日額度得等到太平洋時間午夜。
// 一律叫人「明天再來」會讓人白白放棄一份還救得回來的錄音。
// 註：quotaId 的欄位名稱依 Google API 慣例推得，尚未對照過真實的 429 內容；
// 認不出來時退回日額度的說法，也就是維持原有行為。
export function classifyQuotaError(raw) {
  const text = String(raw);
  if (!/RESOURCE_EXHAUSTED|"code"\s*:\s*429/.test(text)) return null;
  return /PerMinute|per minute/i.test(text) ? 'minute' : 'daily';
}

// undici 的網路錯誤訊息是「fetch failed」，Gemini 的則是一整包 JSON，
// 兩者直接丟給使用者看都等於沒說。原文留在 log，畫面上給人話。
export function describeFailure(err, label, opts = {}) {
  if (err instanceof AppError) return err;
  const raw = String(err?.message || err);
  if (/fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up/i.test(raw)) {
    return new AppError('analyze', `${label}時連線 Gemini 失敗，請確認網路後用同一段錄音重試。`);
  }
  const quota = classifyQuotaError(raw);
  if (quota === 'minute') {
    return new AppError('analyze',
      '短時間內送出太多請求，已達 Gemini 免費版的每分鐘上限。等一分鐘後用同一段錄音重試即可。');
  }
  if (quota === 'daily') {
    const reset = describeQuotaReset(opts.now || new Date(), opts.timeZone);
    return new AppError('analyze',
      `已達 Gemini 免費版的每日用量上限。額度預計在${reset} 重置，屆時可用同一段錄音重試。`);
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

  const t0 = Date.now();
  let tUploaded = t0;
  let tReady = t0;
  let polls = 0;

  const report = (tag) => writeLog(
    formatTimings({
      uploadMs: tUploaded - t0,
      waitMs: tReady - tUploaded,
      generateMs: Date.now() - tReady,
      bytes: audioBuffer.length,
    }) + `　輪詢 ${polls} 次${tag}`,
  );

  let uploadedName = null;   // 記在 try 外面，finally 才刪得到
  try {    let file = await withTimeout(
      ai.files.upload({ file: blob, config: { mimeType } }), timeoutMs, '上傳音檔');
    uploadedName = file.name;
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
    clearQuota();   // 成功是額度可用的直接證據，比我們的推算可信
    return res.text;
  } catch (err) {
    report('　← 失敗');   // 失敗時同樣印出計時，才知道卡在哪一段
    // 原文只在這一刻存在，describeFailure 之後就只剩人話。
    // 2026-08-18 撞到額度上限時就是因此沒留下 quotaId，事後查不出是哪一種額度。
    if (!(err instanceof AppError)) writeLog(`[錯誤] ${redactSecrets(err?.message || err)}`);
    // 記下來，讓下次開始錄音時就能先提醒，而不是等分析完才知道白等
    if (classifyQuotaError(err?.message || err) === 'daily') noteQuotaExhausted(nextQuotaResetAt());
    throw describeFailure(err, '分析');
  } finally {
    // 不論成功或失敗都刪：失敗後的重試本來就會重新上傳一份。
    await discardUploaded(ai, uploadedName);
  }
}

export async function analyze(audioBuffer, mimeType, deps = {}) {
  const generate = deps.generate || callGemini;
  const raw = await generate(buildPrompt(), audioBuffer, mimeType);
  return parseGeminiJson(raw);
}
