import { Client } from '@notionhq/client';
import { AppError } from '../errors.js';

const richText = (content) => [{ type: 'text', text: { content } }];
const paragraph = (content) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: richText(content) } });
const heading2 = (content) => ({ object: 'block', type: 'heading_2', heading_2: { rich_text: richText(content) } });
const bullet = (content) => ({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: richText(content) } });

export function buildBlocks(result, dateStr) {
  return [
    paragraph(`📅 ${dateStr}`),
    heading2('摘要'),
    paragraph(result.summary),
    heading2('重點'),
    ...result.keyPoints.map(bullet),
  ];
}

export function buildTranscriptBlocks(transcript, maxLen = 1900) {
  const paras = transcript.split('\n').map((s) => s.trim()).filter(Boolean);
  const blocks = [];
  for (const para of paras) {
    for (let i = 0; i < para.length; i += maxLen) {
      blocks.push(paragraph(para.slice(i, i + maxLen)));
    }
  }
  return blocks;
}

export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const titleProp = (content) => ({ title: { title: richText(content) } });

export async function writeNotion(result, stamp, deps = {}) {
  const client = deps.client || new Client({ auth: process.env.NOTION_TOKEN });
  const parentId = deps.parentId || process.env.NOTION_PARENT_PAGE_ID;
  try {
    const main = await client.pages.create({
      parent: { page_id: parentId },
      properties: titleProp(result.title),
      children: buildBlocks(result, stamp.date),
    });
    const tBlocks = buildTranscriptBlocks(result.transcript);
    const sub = await client.pages.create({
      parent: { page_id: main.id },
      properties: titleProp('完整逐字稿'),
      children: tBlocks.slice(0, 100),
    });
    for (const batch of chunk(tBlocks.slice(100), 100)) {
      await client.blocks.children.append({ block_id: sub.id, children: batch });
    }
    return { type: 'notion', url: main.url };
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('notion', `寫入 Notion 失敗：${e.message}`);
  }
}
