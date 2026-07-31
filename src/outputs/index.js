import { writeNotion } from './notion.js';
import { writeMarkdown } from './markdown.js';

export function chooseOutput(env) {
  return env.NOTION_TOKEN && env.NOTION_DATABASE_ID ? 'notion' : 'markdown';
}

export async function writeOutput(result, stamp, deps = {}) {
  const env = deps.env || process.env;
  if (chooseOutput(env) === 'notion') return writeNotion(result, stamp, deps.notion);
  return writeMarkdown(result, stamp, deps.destDir);
}
