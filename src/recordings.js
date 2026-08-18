import { writeFile, unlink, mkdir, readdir, stat } from 'node:fs/promises';
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

// 檔名就是清單的資料來源——分析失敗留下的檔案本身即待辦項目，不必另外存狀態。
const NAME_PATTERN = /^錄音_(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})_(.+)\.[A-Za-z0-9]+$/;

export function parseRecordingName(name) {
  const m = NAME_PATTERN.exec(name);
  if (!m) return null;
  const [, y, mo, d, hh, mm, rawTitle] = m;
  const savedAt = `${y}${mo}${d} ${hh}:${mm}`;
  const title = rawTitle === '未命名' ? '' : rawTitle;
  return {
    id: name,
    title,
    savedAt,
    // 有標題仍附上時間：同一天錄兩場同名會議時，光看標題分不出是哪一場
    label: title ? `${title}（${savedAt}）` : savedAt,
  };
}

export async function listRecordings(dir = RECORDINGS_DIR) {
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return [];   // 目錄還沒建立就等於沒有待辦
  }
  const items = [];
  for (const name of names) {
    const parsed = parseRecordingName(name);
    if (!parsed) continue;   // .DS_Store 之類的雜檔不該出現在待辦清單
    const { size } = await stat(path.join(dir, name));
    items.push({ ...parsed, sizeBytes: size });
  }
  return items.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

// id 來自前端，必須當成不可信輸入：只接受合法檔名，且解析後必須仍在目錄內。
export function resolveRecordingPath(id, dir = RECORDINGS_DIR) {
  if (!parseRecordingName(id)) return null;
  const full = path.resolve(dir, id);
  return full.startsWith(path.resolve(dir) + path.sep) ? full : null;
}

export async function discardRecording(filePath) {
  // 刪不掉不算失敗：這是收尾動作，不該蓋掉呼叫端真正在處理的結果
  try {
    await unlink(filePath);
  } catch { /* 檔案已不在就算了 */ }
}
