import { AppError } from './errors.js';

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
