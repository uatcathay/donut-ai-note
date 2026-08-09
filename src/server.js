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

export function createApp(deps = {}) {
  const run = deps.processMeeting || processMeeting;
  const app = express();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });
  app.use(express.static(PUBLIC_DIR));
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
  const app = createApp();
  const port = process.env.PORT || 3000;
  // 伺服器改為登入常駐後，曝露時間從「App 視窗開著的幾分鐘」變成「開機後無限期」，
  // 且無任何身分驗證；綁定 loopback 避免同網段的人打到 /api/process 盜用 Gemini 額度、寫入使用者的 Notion。
  app.listen(port, '127.0.0.1', () => console.log(`會議記錄工具運作中： http://localhost:${port}`));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) start();
