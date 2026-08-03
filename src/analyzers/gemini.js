import { AppError } from '../errors.js';

// gemini-2.5-flash 已對新帳號關閉；用 flash-latest 別名指向當前穩定的免費 flash 模型
const MODEL = 'gemini-flash-latest';

export function buildPrompt() {
  return [
    '你是會議記錄助理。請聽這段會議錄音，並以「繁體中文」輸出結果。',
    '只回傳一個 JSON 物件，不要有多餘文字或 markdown 圍欄，欄位如下：',
    '{',
    '  "suggestedTitle": "依會議內容給的簡短標題",',
    '  "summary": "3-5 句的摘要",',
    '  "keyPoints": ["重點一", "重點二"],',
    '  "transcript": "完整逐字稿，以自然語意分段"',
    '}',
    '注意：逐字稿不要加上「說話者A/B」之類的講者標籤，純段落即可。',
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

  const t0 = Date.now();
  let file = await ai.files.upload({ file: blob, config: { mimeType } });
  const tUploaded = Date.now();

  let polls = 0;
  while (file.state === 'PROCESSING') {
    await new Promise((r) => setTimeout(r, 1500));
    file = await ai.files.get({ name: file.name });
    polls += 1;
  }
  const tReady = Date.now();

  if (file.state === 'FAILED') throw new AppError('analyze', '音檔上傳處理失敗');
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: createUserContent([createPartFromUri(file.uri, file.mimeType), prompt]),
  });
  const tDone = Date.now();

  console.log(formatTimings({
    uploadMs: tUploaded - t0,
    waitMs: tReady - tUploaded,
    generateMs: tDone - tReady,
    bytes: audioBuffer.length,
  }) + `　輪詢 ${polls} 次`);

  return res.text;
}

export async function analyze(audioBuffer, mimeType, deps = {}) {
  const generate = deps.generate || callGemini;
  const raw = await generate(buildPrompt(), audioBuffer, mimeType);
  return parseGeminiJson(raw);
}
