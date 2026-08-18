import path from 'node:path';
import { AppError } from './errors.js';
import { formatStamp } from './clock.js';
import { analyze as defaultAnalyze } from './analyzers/index.js';
import { writeOutput as defaultWriteOutput } from './outputs/index.js';
import {
  buildRecordingName,
  saveRecording as defaultSaveRecording,
  discardRecording as defaultDiscardRecording,
} from './recordings.js';

export function decideTitle(userTitle, suggestedTitle, dateStr) {
  const u = (userTitle || '').trim();
  if (u) return u;
  const s = (suggestedTitle || '').trim();
  if (s) return s;
  return `會議記錄 ${dateStr}`;
}

export function validateAnalysis(a) {
  const bad = (m) => { throw new AppError('analyze', m); };
  if (!a || typeof a !== 'object') bad('分析結果格式錯誤');
  if (typeof a.summary !== 'string' || !a.summary.trim()) bad('摘要缺漏');
  if (!Array.isArray(a.keyPoints) || a.keyPoints.length === 0) bad('重點缺漏');
  if (a.keyPoints.some((p) => typeof p !== 'string' || !p.trim())) bad('重點含空項目');
  if (typeof a.transcript !== 'string' || !a.transcript.trim()) bad('逐字稿缺漏');
}

export async function processMeeting(input, deps = {}) {
  const analyzeFn = deps.analyze || defaultAnalyze;
  const writeFn = deps.writeOutput || defaultWriteOutput;
  const save = deps.saveRecording || defaultSaveRecording;
  const discard = deps.discardRecording || defaultDiscardRecording;
  const now = deps.now || (() => new Date());

  const stamp = formatStamp(now());

  // 先落地再分析：分析與寫出都可能失敗（Gemini 尖峰時段常回 503），
  // 而錄音是這條流程裡唯一無法重來的東西。
  // 重試待辦清單裡的錄音時檔案已經在磁碟上了，再存一份只會讓清單長出重複項目。
  const reusing = Boolean(input.recordingPath);
  const recordingName = reusing
    ? path.basename(input.recordingPath)
    : buildRecordingName(input.userTitle, stamp, input.mimeType);
  const recordingPath = reusing
    ? input.recordingPath
    : await save(input.audioBuffer, recordingName);

  let analysis;
  let result;
  let destination;
  try {
    analysis = await analyzeFn(input.audioBuffer, input.mimeType);
    validateAnalysis(analysis);

    const title = decideTitle(input.userTitle, analysis.suggestedTitle, stamp.date);
    result = {
      title,
      summary: analysis.summary,
      keyPoints: analysis.keyPoints,
      transcript: analysis.transcript,
    };
    destination = await writeFn(result, stamp);
  } catch (err) {
    // 保留錄音，並讓使用者知道它還在——否則畫面關掉就等於永久遺失
    err.message = `${err.message}（錄音已保留：${recordingName}，可稍後重試）`;
    err.recordingPath = recordingPath;
    throw err;
  }

  // 結果已經寫進 Notion 或 .md，原始音檔沒有留存的必要
  await discard(recordingPath);
  return { ...result, destination };
}
