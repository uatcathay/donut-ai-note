import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { processMeeting } from './pipeline.js';
import { getProgress } from './progress.js';
import { isQuotaExhausted } from './quota.js';
import { describeQuotaReset } from './analyzers/gemini.js';
import { log, warn } from './log.js';
import {
  listRecordings, discardRecording, resolveRecordingPath, parseRecordingName,
  saveRecording, buildRecordingName,
} from './recordings.js';
import { formatStamp } from './clock.js';
import { listCompleted, takeCompleted, removeCompleted } from './completed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

export function checkConfig(env) {
  const warnings = [];
  if (!env.GEMINI_API_KEY) {
    warnings.push('缺少 GEMINI_API_KEY，無法分析錄音。請到 Google AI Studio 申請並填入 .env。');
  }
  if (!env.NOTION_TOKEN || !env.NOTION_DATABASE_ID) {
    warnings.push('未設定 Notion（NOTION_TOKEN / NOTION_DATABASE_ID），結果將改輸出成桌面 .md 檔。');
  }
  return warnings;
}

export function createApp(deps = {}) {
  const run = deps.processMeeting || processMeeting;
  const list = deps.listRecordings || listRecordings;
  const discard = deps.discardRecording || discardRecording;
  const resolvePath = deps.resolveRecordingPath || resolveRecordingPath;
  const save = deps.saveRecording || saveRecording;
  const progress = deps.getProgress || getProgress;
  // 同時間只跑一個分析：兩個分析會搶同一份進度狀態，也等於自己加倍 503 的機率
  const isAnalyzing = deps.isAnalyzing || (() => progress().active);

  // 分析在背景跑，沒有人在等它的回傳值——失敗只能寫進 log，
  // 畫面上則由那筆錄音留在清單裡（狀態為待分析、附上原因）來表達。
  const analyzeInBackground = (input) => {
    run(input).catch((e) => warn(`[分析失敗] ${input.recordingPath}：${e.message}`));
  };
  const app = express();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });
  app.use(express.static(PUBLIC_DIR));
  // 分析可能跑上好幾分鐘。前端在等待期間輪詢這裡，才能把「重試中」與「已經死了」分開。
  app.get('/api/progress', (_req, res) => res.json(progress()));

  // 前端在錄音「開始之後」才問這支——提醒不該擋住錄音，更不該延後它
  app.get('/api/quota', (_req, res) => {
    const now = new Date();
    res.json(isQuotaExhausted(now)
      ? { exhausted: true, resetLabel: describeQuotaReset(now) }
      : { exhausted: false });
  });

  // 分析失敗留下的錄音就是待分析清單本身——不必另外存狀態，讀目錄即可，
  // 而且關掉視窗、關機都還在，這正是「晚點有空再分析」需要的。
  app.get('/api/pending', async (_req, res) => {
    res.json({ items: await list() });
  });

  app.post('/api/pending/:id/retry', async (req, res) => {
    if (isAnalyzing()) {
      return res.status(409).json({ ok: false, message: '分析進行中，請等目前的分析完成再重試。' });
    }
    const filePath = resolvePath(req.params.id);
    if (!filePath) return res.status(404).json({ ok: false, message: '找不到這段錄音。' });
    try {
      const audioBuffer = await readFile(filePath);
      const parsed = parseRecordingName(req.params.id);
      res.json({ ok: true });   // 同樣不等結果：進度與失敗都由清單那一列表達
      analyzeInBackground({
        audioBuffer,
        mimeType: `audio/${path.extname(filePath).slice(1)}`,
        userTitle: parsed?.title || '',
        recordingPath: filePath,   // 重用既有檔案，避免重試失敗時長出第二筆待分析項目
      });
    } catch (e) {
      if (e?.code === 'ENOENT') return res.status(404).json({ ok: false, message: '找不到這段錄音。' });
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  // 畫面上的「分析清單」＝磁碟上的錄音 ＋ 目前在跑的那一筆 ＋ 最近完成的通知。
  // 合成一支給前端，省得它自己對三支端點的結果做時序對齊。
  app.get('/api/jobs', async (_req, res) => {
    const p = progress();
    const done = listCompleted().map((c) => ({ ...c, state: 'done' }));
    const doneIds = new Set(done.map((c) => c.id));
    const recordings = await list();
    const items = recordings
      // 登記已完成到刪檔之間，同一筆會同時存在於已完成與磁碟上，不去重就會列出兩列
      .filter((r) => !doneIds.has(r.id))
      .map((r) => (p.active && p.recordingId === r.id
        ? { ...r, state: 'analyzing', stage: p.stage, elapsedMs: p.elapsedMs, retry: p.retry }
        : { ...r, state: 'pending' }));
    // 已完成的排在最前面：它是剛發生的事，而且要你看一眼才會消失
    res.json({ items: [...done, ...items] });
  });

  app.get('/api/completed/:id', (req, res) => {
    const result = takeCompleted(req.params.id);
    if (!result) return res.status(404).json({ ok: false, message: '找不到這份摘要。' });
    res.json(result);
  });

  // 只是把那一列收掉，Notion 或桌面上的筆記不受影響
  app.delete('/api/completed/:id', (req, res) => {
    res.json({ ok: removeCompleted(req.params.id) });
  });

  app.delete('/api/pending/:id', async (req, res) => {
    const filePath = resolvePath(req.params.id);
    if (!filePath) return res.status(404).json({ ok: false, message: '找不到這段錄音。' });
    await discard(filePath);
    res.json({ ok: true });
  });
  // 錄音一落地就回應，不等分析跑完——分析可能要好幾分鐘，而使用者往往正要開下一場會。
  // 回應之前一定要先存檔：前端隨即會去讀清單，檔案還沒落地的話那一筆不會出現。
  app.post('/api/process', upload.single('audio'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ ok: false, stage: 'upload', message: '沒有收到音檔' });
      }
      const userTitle = req.body.title || '';
      const name = buildRecordingName(userTitle, formatStamp(new Date()), req.file.mimetype);
      const filePath = await save(req.file.buffer, name);
      // 已經有分析在跑就先擱著，那一筆會以「待分析」留在清單上等使用者按「立即分析」。
      // started 要讓前端知道：沒開始就別跳到處理中那頁，那頁會顯示成正在跑但其實沒有。
      const started = !isAnalyzing();
      res.json({ ok: true, id: name, started });

      if (started) {
        analyzeInBackground({
          audioBuffer: req.file.buffer,
          mimeType: req.file.mimetype,
          userTitle,
          recordingPath: filePath,   // 檔案已落地，不要再存一份
        });
      }
    } catch (e) {
      const stage = e.stage || 'unknown';
      res.status(stage === 'unknown' ? 500 : 400).json({ ok: false, stage, message: e.message });
    }
  });
  app.use((err, _req, res, next) => {
    if (err && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ ok: false, stage: 'upload', message: '音檔過大（上限 200MB）' });
    }
    if (err) return res.status(500).json({ ok: false, stage: 'unknown', message: err.message });
    next();
  });
  return app;
}

// 伺服器改為登入常駐後，曝露時間從「App 視窗開著的幾分鐘」變成「開機後無限期」，
// 且無任何身分驗證；只綁 loopback，避免同網段的人打到 /api/process
// 盜用 Gemini 額度、寫入使用者的 Notion。
//
// 兩個 loopback 都要綁：localhost 在 macOS 同時解析成 ::1 與 127.0.0.1，而且優先走
// IPv6。只綁 IPv4 的話，另一個綁通配位址的開發伺服器（Next.js 預設就是）會吃下 ::1，
// 於是 localhost:<port> 靜默地變成它——兩邊都啟動成功、都沒報錯，點 Dock 圖示卻開到
// 別人的頁面。這實際發生過。兩個都佔住，後來者才會拿到明確的「埠號已被使用」。
export const LOOPBACKS = ['127.0.0.1', '::1'];

export function listenLoopback(app, port, onError = warn) {
  return LOOPBACKS.map((host) => {
    const server = app.listen(port, host);
    // IPv6 被關掉的機器上綁 ::1 會失敗，但 IPv4 那個還能用，不該讓整個工具起不來
    server.on('error', (e) => onError(`[啟動] 無法在 ${host}:${port} 監聽（${e.message}）`));
    return server;
  });
}

// 3000 是 Node/Next/React 的預設值，常駐的工具長期佔著它，每開一個新專案就會撞一次。
// 3737 不是任何常見框架的預設值。
const DEFAULT_PORT = 3737;

export function start() {
  // Node 不會自動載入 .env，這裡在正式啟動時讀入專案根目錄的 .env
  const envPath = path.join(__dirname, '..', '.env');
  if (existsSync(envPath)) process.loadEnvFile(envPath);
  for (const w of checkConfig(process.env)) warn('[設定提醒] ' + w);
  const app = createApp();
  const port = process.env.PORT || DEFAULT_PORT;
  listenLoopback(app, port);
  log(`會議記錄工具運作中： http://localhost:${port}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) start();
