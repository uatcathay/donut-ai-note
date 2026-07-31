import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export function buildMarkdown(result, dateStr) {
  const points = result.keyPoints.map((p) => `- ${p}`).join('\n');
  return [
    `# ${result.title}`, '',
    `📅 ${dateStr}`, '',
    '## 摘要', '', result.summary, '',
    '## 重點', '', points, '',
    '## 完整逐字稿', '', result.transcript, '',
  ].join('\n');
}

export function buildFilename(title, stamp) {
  const safe = title.replace(/[\/\\:*?"<>|]/g, '_').trim();
  return `會議記錄_${stamp.date}_${stamp.time}_${safe}.md`;
}

export async function writeMarkdown(result, stamp, destDir = path.join(os.homedir(), 'Desktop')) {
  const filePath = path.join(destDir, buildFilename(result.title, stamp));
  await writeFile(filePath, buildMarkdown(result, stamp.date), 'utf8');
  return { type: 'markdown', filePath };
}
