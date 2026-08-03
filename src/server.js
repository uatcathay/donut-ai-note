import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { processMeeting } from './pipeline.js';

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

// 前端在 pagehide 時會送 /shutdown，讓「關掉 App 小窗＝結束伺服器」成立。
// 但在一般瀏覽器分頁裡，重新整理／關分頁／切換網址同樣會觸發 pagehide，
// 開發時伺服器會被自己關掉。因此只有啟動器（設 APP_MODE=1）啟動的程序才真的退出。
export function makeShutdown(env, { exit = () => process.exit(0), log = console.warn } = {}) {
  if (env.APP_MODE === '1') return exit;
  return () => log('[開發模式] 收到 /shutdown，已忽略（只有 App 啟動器會設定 APP_MODE=1 並結束伺服器）。');
}

export function createApp(deps = {}) {
  const run = deps.processMeeting || processMeeting;
  const shutdown = deps.onShutdown || (() => process.exit(0));
  const app = express();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });
  app.use(express.static(PUBLIC_DIR));
  // 前端視窗關閉時會打這個端點，讓伺服器自己結束（配合啟動器達成「關窗即結束」）
  app.post('/shutdown', (_req, res) => {
    res.status(200).end();
    shutdown();
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
  for (const w of checkConfig(process.env)) console.warn('[設定提醒] ' + w);
  const app = createApp({ onShutdown: makeShutdown(process.env) });
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`會議記錄工具運作中： http://localhost:${port}`));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) start();
