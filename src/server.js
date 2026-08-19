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
} from './recordings.js';

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
  // 同時間只跑一個分析：兩個分析會搶同一份進度狀態，也等於自己加倍 503 的機率
  const isAnalyzing = deps.isAnalyzing || (() => getProgress().active);
  const app = express();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });
  app.use(express.static(PUBLIC_DIR));
  // 分析可能跑上好幾分鐘。前端在等待期間輪詢這裡，才能把「重試中」與「已經死了」分開。
  app.get('/api/progress', (_req, res) => res.json(getProgress()));

  // 前端在錄音「開始之後」才問這支——提醒不該擋住錄音，更不該延後它
  app.get('/api/quota', (_req, res) => {
    const now = new Date();
    res.json(isQuotaExhausted(now)
      ? { exhausted: true, resetLabel: describeQuotaReset(now) }
      : { exhausted: false });
  });

  // 分析失敗留下的錄音就是待辦清單本身——不必另外存狀態，讀目錄即可，
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
      const result = await run({
        audioBuffer,
        mimeType: `audio/${path.extname(filePath).slice(1)}`,
        userTitle: parsed?.title || '',
        recordingPath: filePath,   // 重用既有檔案，避免重試失敗時長出第二筆待辦
      });
      res.json({ ok: true, ...result });
    } catch (e) {
      if (e?.code === 'ENOENT') return res.status(404).json({ ok: false, message: '找不到這段錄音。' });
      const stage = e.stage || 'unknown';
      res.status(stage === 'unknown' ? 500 : 400).json({ ok: false, stage, message: e.message });
    }
  });

  app.delete('/api/pending/:id', async (req, res) => {
    const filePath = resolvePath(req.params.id);
    if (!filePath) return res.status(404).json({ ok: false, message: '找不到這段錄音。' });
    await discard(filePath);
    res.json({ ok: true });
  });
  app.post('/api/process', upload.single('audio'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ ok: false, stage: 'upload', message: '沒有收到音檔' });
      }
      const result = await run({
        audioBuffer: req.file.buffer,
        mimeType: req.file.mimetype,
        userTitle: req.body.title || '',
      });
      res.json({ ok: true, ...result });
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

export function start() {
  // Node 不會自動載入 .env，這裡在正式啟動時讀入專案根目錄的 .env
  const envPath = path.join(__dirname, '..', '.env');
  if (existsSync(envPath)) process.loadEnvFile(envPath);
  for (const w of checkConfig(process.env)) warn('[設定提醒] ' + w);
  const app = createApp();
  const port = process.env.PORT || 3000;
  // 伺服器改為登入常駐後，曝露時間從「App 視窗開著的幾分鐘」變成「開機後無限期」，
  // 且無任何身分驗證；綁定 loopback 避免同網段的人打到 /api/process 盜用 Gemini 額度、寫入使用者的 Notion。
  app.listen(port, '127.0.0.1', () => log(`會議記錄工具運作中： http://localhost:${port}`));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) start();
