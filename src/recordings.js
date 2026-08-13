import { writeFile, unlink, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 錄音只活在瀏覽器分頁的記憶體裡，分析一失敗又剛好錄了下一段就永遠拿不回來
// （實測損失過一場兩小時的會議）。因此收到音檔就先落地，分析成功再刪。
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const RECORDINGS_DIR = path.join(__dirname, '..', 'tmp-recordings');

export function extensionFor(mimeType) {
  const m = /^audio\/([a-z0-9]+)/i.exec(String(mimeType || ''));
  return m ? m[1].toLowerCase() : 'bin';
}

export function buildRecordingName(title, stamp, mimeType) {
  const safe = String(title || '').replace(/[\/\\:*?"<>|]/g, '_').trim() || '未命名';
  return `錄音_${stamp.date}_${stamp.time}_${safe}.${extensionFor(mimeType)}`;
}

export async function saveRecording(buffer, name, dir = RECORDINGS_DIR) {
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, name);
  await writeFile(filePath, buffer);
  return filePath;
}

export async function discardRecording(filePath) {
  // 刪不掉不算失敗：這是收尾動作，不該蓋掉呼叫端真正在處理的結果
  try {
    await unlink(filePath);
  } catch { /* 檔案已不在就算了 */ }
}
