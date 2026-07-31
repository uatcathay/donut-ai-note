import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { processMeeting } from './pipeline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

export function checkConfig(env) {
  const warnings = [];
  if (!env.GEMINI_API_KEY) {
    warnings.push('缺少 GEMINI_API_KEY，無法分析錄音。請到 Google AI Studio 申請並填入 .env。');
  }
  if (!env.NOTION_TOKEN || !env.NOTION_PARENT_PAGE_ID) {
    warnings.push('未設定 Notion（NOTION_TOKEN / NOTION_PARENT_PAGE_ID），結果將改輸出成桌面 .md 檔。');
  }
  return warnings;
}

export function createApp(deps = {}) {
  const run = deps.processMeeting || processMeeting;
  const app = express();
  const upload = multer({ storage: multer.memoryStorage() });
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
  return app;
}

export function start() {
  for (const w of checkConfig(process.env)) console.warn('[設定提醒] ' + w);
  const app = createApp();
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`會議記錄工具運作中： http://localhost:${port}`));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) start();
