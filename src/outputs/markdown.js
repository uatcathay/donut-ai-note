import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export function buildMarkdown(result, dateStr) {
  const lines = [
    `# ${result.title}`, '',
    `📅 ${dateStr}`, '',
  ];
  // 待辦排在議題之前：回頭看筆記時最先想知道的是「我還要做什麼」。
  // 沒有待辦是常態，空標題只會讓文件看起來像漏了東西。
  if (result.nextSteps.length > 0) {
    lines.push("## ◻️ What's next?", '');
    for (const step of result.nextSteps) lines.push(`- [ ] ${step}`);
    lines.push('');
  }
  lines.push('## 📝 Mins', '');
  for (const topic of result.topics) {
    lines.push(`### ${topic.title}`, '');
    for (const point of topic.points) lines.push(`- ${point}`);
    lines.push('');
  }
  lines.push('## 完整逐字稿', '', result.transcript, '');
  return lines.join('\n');
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
