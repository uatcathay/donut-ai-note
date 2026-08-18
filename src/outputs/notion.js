import { Client } from '@notionhq/client';
import { AppError } from '../errors.js';

const richText = (content) => [{ type: 'text', text: { content } }];
const paragraph = (content) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: richText(content) } });
const heading2 = (content) => ({ object: 'block', type: 'heading_2', heading_2: { rich_text: richText(content) } });
const heading3 = (content) => ({ object: 'block', type: 'heading_3', heading_3: { rich_text: richText(content) } });
const bullet = (content) => ({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: richText(content) } });
// Notion 原生的核取方塊：待辦在 Notion 裡是真的可以打勾的，不只是符號
const todo = (content) => ({ object: 'block', type: 'to_do', to_do: { rich_text: richText(content), checked: false } });

export function buildBlocks(result) {
  const blocks = [];
  // 待辦排在議題之前：回頭看筆記時最先想知道的是「我還要做什麼」。
  // 沒有待辦是常態，空標題只會讓頁面看起來像漏了東西。
  if (result.nextSteps.length > 0) {
    blocks.push(heading2("◻️ What's next?"), ...result.nextSteps.map(todo));
  }
  blocks.push(heading2('📝 Mins'));
  for (const topic of result.topics) {
    blocks.push(heading3(topic.title), ...topic.points.map(bullet));
  }
  return blocks;
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

// 新版 Notion API：資料庫底下有 data source，建立列與欄位都掛在 data source 上。
// 由 database id 解析出第一個 data source id。
async function resolveDataSourceId(client, databaseId) {
  const db = await client.databases.retrieve({ database_id: databaseId });
  const ds = db.data_sources && db.data_sources[0];
  if (!ds) throw new AppError('notion', '找不到資料庫的 data source，請確認 NOTION_DATABASE_ID 正確且 integration 已連線。');
  return ds.id;
}

export async function writeNotion(result, stamp, deps = {}) {
  const client = deps.client || new Client({ auth: process.env.NOTION_TOKEN });
  const databaseId = deps.databaseId || process.env.NOTION_DATABASE_ID;
  try {
    const dataSourceId = deps.dataSourceId || (await resolveDataSourceId(client, databaseId));
    // 每場會議 = 資料庫的一列：Name = 標題、Date = 日期
    const main = await client.pages.create({
      parent: { type: 'data_source_id', data_source_id: dataSourceId },
      properties: {
        Name: { title: richText(result.title) },
        Date: { date: { start: stamp.date } },
      },
      children: buildBlocks(result),
    });
    // 逐字稿另存成該列頁面底下的子頁
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
