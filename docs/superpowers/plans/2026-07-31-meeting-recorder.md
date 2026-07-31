# 會議錄音重點工具 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做一個本機 Node 工具：瀏覽器即時錄音 → Gemini 免費版產出「逐字稿＋摘要＋重點」→ 寫進指定 Notion 頁面底下（或桌面 `.md`）。

**Architecture:** 單一 Express 小伺服器 + 一頁前端網頁。前端用 `MediaRecorder` 錄音、把音檔 POST 到 `/api/process`；後端跑「分析 → 驗證 → 輸出」管線。分析引擎與輸出目的地各自抽象成可替換模組，API key 只存本機 `.env`。

**Tech Stack:** Node.js (>=18, ESM)、Express、Multer、`@google/genai`、`@notionhq/client`、前端純 HTML/JS、測試用 Node 內建 `node:test`。

## Global Constraints

- **語言**：所有產出（逐字稿、摘要、重點、Notion/`.md` 內容、前端 UI 文案、錯誤訊息）一律**繁體中文**。
- **免費優先**：預設分析引擎 `gemini`，模型 `gemini-2.5-flash`；不引入需付費的必要相依。
- **金鑰安全**：API key 只存本機 `.env`；`.gitignore` 必須忽略 `.env`；任何情況都不得把 key 送進前端或寫入版本控制。
- **本機執行**：v1 只在本機跑，不部署雲端。
- **不做講者辨識**：逐字稿純段落，不得出現「說話者A/B」之類標記。
- **模組化**：分析引擎放 `src/analyzers/`、輸出放 `src/outputs/`，皆可依設定替換。
- **Node 版本**：`>=18`（需 `fetch` / `FormData` / `Blob` 全域，供測試與執行）。

## 檔案結構

```
meeting-recorder/
├── 會議記錄.command          # 雙擊啟動器（Task 11）
├── package.json              # Task 1
├── .env.example              # Task 1
├── .gitignore                # 既有，Task 1 確認內容
├── README.md                 # Task 11
├── public/
│   ├── index.html            # Task 10
│   └── app.js                # Task 10
├── src/
│   ├── errors.js             # Task 2：AppError
│   ├── clock.js              # Task 2：formatStamp
│   ├── pipeline.js           # Task 2（decideTitle/validateAnalysis）+ Task 8（processMeeting）
│   ├── server.js             # Task 9
│   ├── analyzers/
│   │   ├── index.js          # Task 7：依 ENGINE 選引擎
│   │   └── gemini.js         # Task 6
│   └── outputs/
│       ├── index.js          # Task 5：依設定選 Notion / markdown
│       ├── notion.js         # Task 4
│       └── markdown.js       # Task 3
└── test/
    ├── smoke.test.js         # Task 1
    ├── core.test.js          # Task 2
    ├── markdown.test.js      # Task 3
    ├── notion.test.js        # Task 4
    ├── outputs.test.js       # Task 5
    ├── gemini.test.js        # Task 6
    ├── analyzers.test.js     # Task 7
    ├── pipeline.test.js      # Task 8
    └── server.test.js        # Task 9
```

### 共用資料型別（所有任務一致）

- **analysis**（分析引擎回傳）：`{ suggestedTitle: string, summary: string, keyPoints: string[], transcript: string }`
- **result**（決定標題後、傳給輸出）：`{ title: string, summary: string, keyPoints: string[], transcript: string }`
- **stamp**（時間戳）：`{ date: string /* 'YYYY-MM-DD' */, time: string /* 'HHmm' */ }`
- **destination**（輸出結果）：`{ type: 'notion', url: string }` 或 `{ type: 'markdown', filePath: string }`
- **AppError**：`new AppError(stage, message)`，`stage ∈ 'analyze'|'notion'|'markdown'|'config'|'upload'|'unknown'`

---

## Task 1: 專案骨架與測試環境

**Files:**
- Create: `package.json`, `.env.example`, `test/smoke.test.js`
- Modify: `.gitignore`（既有，確認內容）

**Interfaces:**
- Consumes: 無
- Produces: 可執行的 `npm test`（node:test）與 `npm start`；ESM 模式（`"type":"module"`）。

- [ ] **Step 1: 建立資料夾**

Run:
```bash
cd ~/.claude/projects/meeting-recorder
mkdir -p public src/analyzers src/outputs test
```

- [ ] **Step 2: 初始化 package.json 並安裝相依**

Run:
```bash
npm init -y
npm install express multer @google/genai @notionhq/client
```

- [ ] **Step 3: 改寫 package.json**（設定 ESM、scripts、engines）

`package.json`（保留 `npm install` 寫入的 `dependencies` 版本，其餘欄位改成）：
```json
{
  "name": "meeting-recorder",
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": ">=18" },
  "scripts": {
    "test": "node --test",
    "start": "node src/server.js"
  }
}
```
（`dependencies` 區塊維持 Step 2 產生的內容，不要刪。）

- [ ] **Step 4: 確認 `.gitignore` 內容**

`.gitignore` 應包含：
```
.env
node_modules/
*.log
/tmp-recordings/
.DS_Store
```

- [ ] **Step 5: 建立 `.env.example`**

`.env.example`：
```
# Google AI Studio 免費申請：https://aistudio.google.com/apikey
GEMINI_API_KEY=

# 分析引擎，預設 gemini
ENGINE=gemini

# 要寫進 Notion 才需要；留空則輸出桌面 .md
NOTION_TOKEN=
NOTION_PARENT_PAGE_ID=

# 伺服器埠號
PORT=3000
```

- [ ] **Step 6: 寫冒煙測試**

`test/smoke.test.js`：
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('測試環境可運作', () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 7: 執行測試確認通過**

Run: `npm test`
Expected: PASS，1 test 通過。

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json .gitignore .env.example test/smoke.test.js
git commit -m "chore: 專案骨架與 node:test 測試環境"
```

---

## Task 2: 核心純函式（AppError / formatStamp / decideTitle / validateAnalysis）

**Files:**
- Create: `src/errors.js`, `src/clock.js`, `test/core.test.js`
- Create: `src/pipeline.js`（本任務只放 `decideTitle`、`validateAnalysis`；`processMeeting` 於 Task 8 加入同檔）

**Interfaces:**
- Consumes: 無
- Produces:
  - `class AppError extends Error`：`constructor(stage: string, message: string)`，實例有 `.stage`、`.message`。
  - `formatStamp(d: Date) -> { date: string, time: string }`
  - `decideTitle(userTitle: string, suggestedTitle: string, dateStr: string) -> string`
  - `validateAnalysis(analysis: object) -> void`（不合法時 `throw new AppError('analyze', ...)`）

- [ ] **Step 1: 寫失敗測試**

`test/core.test.js`：
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../src/errors.js';
import { formatStamp } from '../src/clock.js';
import { decideTitle, validateAnalysis } from '../src/pipeline.js';

test('AppError 帶 stage', () => {
  const e = new AppError('analyze', '壞了');
  assert.equal(e.stage, 'analyze');
  assert.equal(e.message, '壞了');
  assert.ok(e instanceof Error);
});

test('formatStamp 產生日期與時間', () => {
  const s = formatStamp(new Date(2026, 6, 31, 9, 5)); // 月份 0-based → 7 月
  assert.deepEqual(s, { date: '2026-07-31', time: '0905' });
});

test('decideTitle：使用者標題優先', () => {
  assert.equal(decideTitle('週會', 'AI 給的', '2026-07-31'), '週會');
});
test('decideTitle：無使用者標題時用建議標題', () => {
  assert.equal(decideTitle('  ', 'AI 給的', '2026-07-31'), 'AI 給的');
});
test('decideTitle：兩者皆空時用日期', () => {
  assert.equal(decideTitle('', '', '2026-07-31'), '會議記錄 2026-07-31');
});

test('validateAnalysis：合法通過', () => {
  validateAnalysis({ suggestedTitle: 'x', summary: '好', keyPoints: ['a'], transcript: '逐字' });
});
test('validateAnalysis：空摘要拋錯', () => {
  assert.throws(() => validateAnalysis({ summary: ' ', keyPoints: ['a'], transcript: 't' }),
    (e) => e instanceof AppError && e.stage === 'analyze');
});
test('validateAnalysis：空重點陣列拋錯', () => {
  assert.throws(() => validateAnalysis({ summary: 's', keyPoints: [], transcript: 't' }),
    (e) => e.stage === 'analyze');
});
test('validateAnalysis：重點含空字串拋錯', () => {
  assert.throws(() => validateAnalysis({ summary: 's', keyPoints: ['a', ' '], transcript: 't' }),
    (e) => e.stage === 'analyze');
});
test('validateAnalysis：空逐字稿拋錯', () => {
  assert.throws(() => validateAnalysis({ summary: 's', keyPoints: ['a'], transcript: '' }),
    (e) => e.stage === 'analyze');
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `node --test test/core.test.js`
Expected: FAIL（找不到 `../src/errors.js` 等模組）。

- [ ] **Step 3: 實作 `src/errors.js`**

```js
export class AppError extends Error {
  constructor(stage, message) {
    super(message);
    this.name = 'AppError';
    this.stage = stage;
  }
}
```

- [ ] **Step 4: 實作 `src/clock.js`**

```js
export function formatStamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const time = `${p(d.getHours())}${p(d.getMinutes())}`;
  return { date, time };
}
```

- [ ] **Step 5: 實作 `src/pipeline.js`（本任務範圍）**

```js
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
```

- [ ] **Step 6: 執行測試確認通過**

Run: `node --test test/core.test.js`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add src/errors.js src/clock.js src/pipeline.js test/core.test.js
git commit -m "feat: 核心純函式 AppError/formatStamp/decideTitle/validateAnalysis"
```

---

## Task 3: Markdown 輸出

**Files:**
- Create: `src/outputs/markdown.js`, `test/markdown.test.js`

**Interfaces:**
- Consumes: `result`、`stamp`（見共用型別）
- Produces:
  - `buildMarkdown(result, dateStr: string) -> string`
  - `buildFilename(title: string, stamp) -> string`（格式 `會議記錄_YYYY-MM-DD_HHmm_<title>.md`，過濾檔名非法字元）
  - `async writeMarkdown(result, stamp, destDir?: string) -> { type:'markdown', filePath: string }`（`destDir` 預設為使用者桌面）

- [ ] **Step 1: 寫失敗測試**

`test/markdown.test.js`：
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildMarkdown, buildFilename, writeMarkdown } from '../src/outputs/markdown.js';

const result = {
  title: '產品週會',
  summary: '討論了 A 與 B。',
  keyPoints: ['決定做 A', '下週追 B'],
  transcript: '完整逐字內容',
};

test('buildMarkdown 含各區塊', () => {
  const md = buildMarkdown(result, '2026-07-31');
  assert.match(md, /# 產品週會/);
  assert.match(md, /📅 2026-07-31/);
  assert.match(md, /## 摘要/);
  assert.match(md, /討論了 A 與 B。/);
  assert.match(md, /## 重點/);
  assert.match(md, /- 決定做 A/);
  assert.match(md, /- 下週追 B/);
  assert.match(md, /## 完整逐字稿/);
  assert.match(md, /完整逐字內容/);
});

test('buildFilename 過濾非法字元', () => {
  const name = buildFilename('A/B:會議', { date: '2026-07-31', time: '0905' });
  assert.equal(name, '會議記錄_2026-07-31_0905_A_B_會議.md');
});

test('writeMarkdown 實際寫檔', async () => {
  const dir = path.join(os.tmpdir(), 'mr-md-test');
  await mkdir(dir, { recursive: true });
  const out = await writeMarkdown(result, { date: '2026-07-31', time: '0905' }, dir);
  assert.equal(out.type, 'markdown');
  const content = await readFile(out.filePath, 'utf8');
  assert.match(content, /# 產品週會/);
  await rm(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `node --test test/markdown.test.js`
Expected: FAIL（找不到模組）。

- [ ] **Step 3: 實作 `src/outputs/markdown.js`**

```js
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
```

- [ ] **Step 4: 執行測試確認通過**

Run: `node --test test/markdown.test.js`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/outputs/markdown.js test/markdown.test.js
git commit -m "feat: Markdown 輸出（buildMarkdown/buildFilename/writeMarkdown）"
```

---

## Task 4: Notion 輸出

**Files:**
- Create: `src/outputs/notion.js`, `test/notion.test.js`

**Interfaces:**
- Consumes: `result`、`stamp`、`AppError`
- Produces:
  - `buildBlocks(result, dateStr: string) -> object[]`（主頁 children：日期段落、`## 摘要`、摘要段落、`## 重點`、重點條列）
  - `buildTranscriptBlocks(transcript: string, maxLen?: number) -> object[]`（依段落切成 paragraph blocks，單塊 <= 1900 字）
  - `chunk(arr, size) -> array[]`
  - `async writeNotion(result, stamp, deps?: { client, parentId }) -> { type:'notion', url: string }`
    （`deps` 未給時，`client = new Client({ auth: NOTION_TOKEN })`、`parentId = NOTION_PARENT_PAGE_ID`）

- [ ] **Step 1: 寫失敗測試**

`test/notion.test.js`：
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBlocks, buildTranscriptBlocks, chunk, writeNotion } from '../src/outputs/notion.js';

const result = {
  title: '產品週會',
  summary: '討論了 A。',
  keyPoints: ['決定做 A', '下週追 B'],
  transcript: '第一段。\n第二段。',
};

test('buildBlocks 結構正確', () => {
  const blocks = buildBlocks(result, '2026-07-31');
  assert.match(blocks[0].paragraph.rich_text[0].text.content, /📅 2026-07-31/);
  assert.equal(blocks[1].type, 'heading_2');
  assert.equal(blocks[1].heading_2.rich_text[0].text.content, '摘要');
  assert.equal(blocks[2].paragraph.rich_text[0].text.content, '討論了 A。');
  assert.equal(blocks[3].heading_2.rich_text[0].text.content, '重點');
  assert.equal(blocks[4].type, 'bulleted_list_item');
  assert.equal(blocks[4].bulleted_list_item.rich_text[0].text.content, '決定做 A');
  assert.equal(blocks[5].bulleted_list_item.rich_text[0].text.content, '下週追 B');
});

test('buildTranscriptBlocks 依段落切塊', () => {
  const blocks = buildTranscriptBlocks(result.transcript);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].paragraph.rich_text[0].text.content, '第一段。');
});

test('buildTranscriptBlocks 超長段落再切', () => {
  const long = 'あ'.repeat(4000);
  const blocks = buildTranscriptBlocks(long, 1900);
  assert.equal(blocks.length, 3); // 1900 + 1900 + 200
});

test('chunk 切成每組 size', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test('writeNotion 建主頁＋逐字稿子頁', async () => {
  const calls = [];
  const appends = [];
  const fakeClient = {
    pages: { create: async (a) => { calls.push(a); return { id: `id${calls.length}`, url: `https://notion.so/${calls.length}` }; } },
    blocks: { children: { append: async (a) => { appends.push(a); } } },
  };
  const out = await writeNotion(result, { date: '2026-07-31', time: '0905' }, { client: fakeClient, parentId: 'PARENT' });
  assert.equal(out.type, 'notion');
  assert.equal(out.url, 'https://notion.so/1');
  // 第一次建主頁，parent 是 PARENT
  assert.equal(calls[0].parent.page_id, 'PARENT');
  assert.equal(calls[0].properties.title.title[0].text.content, '產品週會');
  // 第二次建逐字稿子頁，parent 是主頁 id
  assert.equal(calls[1].parent.page_id, 'id1');
  assert.equal(calls[1].properties.title.title[0].text.content, '完整逐字稿');
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `node --test test/notion.test.js`
Expected: FAIL（找不到模組）。

- [ ] **Step 3: 實作 `src/outputs/notion.js`**

```js
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
```

- [ ] **Step 4: 執行測試確認通過**

Run: `node --test test/notion.test.js`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/outputs/notion.js test/notion.test.js
git commit -m "feat: Notion 輸出（主頁摘要重點＋逐字稿子頁）"
```

---

## Task 5: 輸出目的地選擇

**Files:**
- Create: `src/outputs/index.js`, `test/outputs.test.js`

**Interfaces:**
- Consumes: `writeNotion`（Task 4）、`writeMarkdown`（Task 3）
- Produces:
  - `chooseOutput(env) -> 'notion' | 'markdown'`（有 `NOTION_TOKEN` 且有 `NOTION_PARENT_PAGE_ID` → notion，否則 markdown）
  - `async writeOutput(result, stamp, deps?: { env, notion, destDir }) -> destination`

- [ ] **Step 1: 寫失敗測試**

`test/outputs.test.js`：
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { rm, mkdir, readFile } from 'node:fs/promises';
import { chooseOutput, writeOutput } from '../src/outputs/index.js';

const result = { title: 'T', summary: 's', keyPoints: ['a'], transcript: 't' };
const stamp = { date: '2026-07-31', time: '0905' };

test('chooseOutput：兩者皆設 → notion', () => {
  assert.equal(chooseOutput({ NOTION_TOKEN: 'x', NOTION_PARENT_PAGE_ID: 'y' }), 'notion');
});
test('chooseOutput：缺一 → markdown', () => {
  assert.equal(chooseOutput({ NOTION_TOKEN: 'x' }), 'markdown');
  assert.equal(chooseOutput({}), 'markdown');
});

test('writeOutput 走 markdown', async () => {
  const dir = path.join(os.tmpdir(), 'mr-out-test');
  await mkdir(dir, { recursive: true });
  const out = await writeOutput(result, stamp, { env: {}, destDir: dir });
  assert.equal(out.type, 'markdown');
  assert.match(await readFile(out.filePath, 'utf8'), /# T/);
  await rm(dir, { recursive: true, force: true });
});

test('writeOutput 走 notion（注入 client）', async () => {
  const fakeClient = {
    pages: { create: async () => ({ id: 'id1', url: 'https://notion.so/1' }) },
    blocks: { children: { append: async () => {} } },
  };
  const out = await writeOutput(result, stamp, {
    env: { NOTION_TOKEN: 'x', NOTION_PARENT_PAGE_ID: 'y' },
    notion: { client: fakeClient, parentId: 'y' },
  });
  assert.equal(out.type, 'notion');
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `node --test test/outputs.test.js`
Expected: FAIL（找不到模組）。

- [ ] **Step 3: 實作 `src/outputs/index.js`**

```js
import { writeNotion } from './notion.js';
import { writeMarkdown } from './markdown.js';

export function chooseOutput(env) {
  return env.NOTION_TOKEN && env.NOTION_PARENT_PAGE_ID ? 'notion' : 'markdown';
}

export async function writeOutput(result, stamp, deps = {}) {
  const env = deps.env || process.env;
  if (chooseOutput(env) === 'notion') return writeNotion(result, stamp, deps.notion);
  return writeMarkdown(result, stamp, deps.destDir);
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `node --test test/outputs.test.js`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/outputs/index.js test/outputs.test.js
git commit -m "feat: 輸出目的地自動選擇（Notion / markdown）"
```

---

## Task 6: Gemini 分析引擎

**Files:**
- Create: `src/analyzers/gemini.js`, `test/gemini.test.js`

**Interfaces:**
- Consumes: `AppError`
- Produces:
  - `buildPrompt() -> string`（繁中、要求純 JSON、明確禁止講者標記）
  - `parseGeminiJson(text: string) -> analysis`（去除 markdown 圍欄、擷取 `{...}` 解析；失敗拋 `AppError('analyze', ...)`）
  - `async analyze(audioBuffer: Buffer, mimeType: string, deps?: { generate }) -> analysis`
    （`deps.generate(prompt, audioBuffer, mimeType) -> rawText`；未給時用內建 `callGemini`，走 Gemini File API + `gemini-2.5-flash`）

- [ ] **Step 1: 寫失敗測試**

`test/gemini.test.js`：
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../src/errors.js';
import { buildPrompt, parseGeminiJson, analyze } from '../src/analyzers/gemini.js';

test('buildPrompt 要求繁中且禁止講者標記', () => {
  const p = buildPrompt();
  assert.match(p, /繁體中文/);
  assert.match(p, /不要標記講者|講者標籤/);
  assert.match(p, /suggestedTitle/);
});

test('parseGeminiJson 解析純 JSON', () => {
  const obj = parseGeminiJson('{"summary":"s","keyPoints":["a"],"transcript":"t","suggestedTitle":"x"}');
  assert.equal(obj.summary, 's');
});

test('parseGeminiJson 去除 ```json 圍欄', () => {
  const raw = '```json\n{"summary":"s","keyPoints":["a"],"transcript":"t","suggestedTitle":"x"}\n```';
  assert.equal(parseGeminiJson(raw).transcript, 't');
});

test('parseGeminiJson 非 JSON 拋錯', () => {
  assert.throws(() => parseGeminiJson('抱歉我不會'), (e) => e instanceof AppError && e.stage === 'analyze');
});

test('analyze 注入 generate 回傳解析結果', async () => {
  const fakeGenerate = async () => '{"summary":"開會摘要","keyPoints":["點一"],"transcript":"逐字","suggestedTitle":"週會"}';
  const out = await analyze(Buffer.from('x'), 'audio/webm', { generate: fakeGenerate });
  assert.equal(out.suggestedTitle, '週會');
  assert.equal(out.keyPoints[0], '點一');
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `node --test test/gemini.test.js`
Expected: FAIL（找不到模組）。

- [ ] **Step 3: 實作 `src/analyzers/gemini.js`**

```js
import { AppError } from '../errors.js';

const MODEL = 'gemini-2.5-flash';

export function buildPrompt() {
  return [
    '你是會議記錄助理。請聽這段會議錄音，並以「繁體中文」輸出結果。',
    '只回傳一個 JSON 物件，不要有多餘文字或 markdown 圍欄，欄位如下：',
    '{',
    '  "suggestedTitle": "依會議內容給的簡短標題",',
    '  "summary": "3-5 句的摘要",',
    '  "keyPoints": ["重點一", "重點二"],',
    '  "transcript": "完整逐字稿，以自然語意分段"',
    '}',
    '注意：逐字稿不要加上「說話者A/B」之類的講者標籤，純段落即可。',
  ].join('\n');
}

export function parseGeminiJson(text) {
  const s = String(text);
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new AppError('analyze', 'Gemini 回傳非 JSON');
  }
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    throw new AppError('analyze', 'Gemini 回傳 JSON 解析失敗');
  }
}

async function callGemini(prompt, audioBuffer, mimeType) {
  const { GoogleGenAI, createUserContent, createPartFromUri } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const blob = new Blob([audioBuffer], { type: mimeType });
  let file = await ai.files.upload({ file: blob, config: { mimeType } });
  while (file.state === 'PROCESSING') {
    await new Promise((r) => setTimeout(r, 1500));
    file = await ai.files.get({ name: file.name });
  }
  if (file.state === 'FAILED') throw new AppError('analyze', '音檔上傳處理失敗');
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: createUserContent([createPartFromUri(file.uri, file.mimeType), prompt]),
  });
  return res.text;
}

export async function analyze(audioBuffer, mimeType, deps = {}) {
  const generate = deps.generate || callGemini;
  const raw = await generate(buildPrompt(), audioBuffer, mimeType);
  return parseGeminiJson(raw);
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `node --test test/gemini.test.js`
Expected: PASS。（`callGemini` 為真實 I/O，由 Task 10 之後的手動端到端測試涵蓋。）

- [ ] **Step 5: Commit**

```bash
git add src/analyzers/gemini.js test/gemini.test.js
git commit -m "feat: Gemini 分析引擎（prompt/JSON 解析/File API 呼叫）"
```

---

## Task 7: 分析引擎選擇

**Files:**
- Create: `src/analyzers/index.js`, `test/analyzers.test.js`

**Interfaces:**
- Consumes: `analyze`（Task 6 的 gemini）、`AppError`
- Produces:
  - `getAnalyzer(name: string) -> analyzeFn`（未知引擎拋 `AppError('config', ...)`）
  - `async analyze(audioBuffer, mimeType) -> analysis`（依 `process.env.ENGINE || 'gemini'` 選）

- [ ] **Step 1: 寫失敗測試**

`test/analyzers.test.js`：
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../src/errors.js';
import { getAnalyzer } from '../src/analyzers/index.js';

test('getAnalyzer(gemini) 回傳函式', () => {
  assert.equal(typeof getAnalyzer('gemini'), 'function');
});
test('getAnalyzer 未知引擎拋 config 錯', () => {
  assert.throws(() => getAnalyzer('bogus'), (e) => e instanceof AppError && e.stage === 'config');
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `node --test test/analyzers.test.js`
Expected: FAIL（找不到模組）。

- [ ] **Step 3: 實作 `src/analyzers/index.js`**

```js
import { analyze as geminiAnalyze } from './gemini.js';
import { AppError } from '../errors.js';

const ENGINES = { gemini: geminiAnalyze };

export function getAnalyzer(name) {
  const fn = ENGINES[name];
  if (!fn) throw new AppError('config', `未知的分析引擎：${name}`);
  return fn;
}

export function analyze(audioBuffer, mimeType) {
  const name = process.env.ENGINE || 'gemini';
  return getAnalyzer(name)(audioBuffer, mimeType);
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `node --test test/analyzers.test.js`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/analyzers/index.js test/analyzers.test.js
git commit -m "feat: 分析引擎選擇（依 ENGINE 環境變數）"
```

---

## Task 8: 處理管線 `processMeeting`

**Files:**
- Modify: `src/pipeline.js`（加入 `processMeeting`，沿用 Task 2 的 `decideTitle`/`validateAnalysis`）
- Create: `test/pipeline.test.js`

**Interfaces:**
- Consumes: `analyze`（Task 7）、`writeOutput`（Task 5）、`formatStamp`（Task 2）、`decideTitle`/`validateAnalysis`（Task 2）
- Produces:
  - `async processMeeting(input, deps?) -> { title, summary, keyPoints, transcript, destination }`
    - `input`：`{ audioBuffer: Buffer, mimeType: string, userTitle: string }`
    - `deps`（測試注入用）：`{ analyze, writeOutput, now }`；`now` 為 `() => Date`

- [ ] **Step 1: 寫失敗測試**

`test/pipeline.test.js`：
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../src/errors.js';
import { processMeeting } from '../src/pipeline.js';

const baseDeps = (overrides = {}) => ({
  analyze: async () => ({ suggestedTitle: 'AI 標題', summary: '摘要', keyPoints: ['點一'], transcript: '逐字' }),
  writeOutput: async (result) => ({ type: 'markdown', filePath: `/tmp/${result.title}.md` }),
  now: () => new Date(2026, 6, 31, 9, 5),
  ...overrides,
});

test('processMeeting 正常流程用使用者標題', async () => {
  const out = await processMeeting(
    { audioBuffer: Buffer.from('x'), mimeType: 'audio/webm', userTitle: '週會' },
    baseDeps());
  assert.equal(out.title, '週會');
  assert.equal(out.summary, '摘要');
  assert.deepEqual(out.keyPoints, ['點一']);
  assert.equal(out.destination.type, 'markdown');
});

test('processMeeting 無使用者標題時用 AI 建議標題', async () => {
  const out = await processMeeting(
    { audioBuffer: Buffer.from('x'), mimeType: 'audio/webm', userTitle: '' },
    baseDeps());
  assert.equal(out.title, 'AI 標題');
});

test('processMeeting 分析結果不合法時拋 analyze 錯', async () => {
  const deps = baseDeps({ analyze: async () => ({ summary: '', keyPoints: [], transcript: '' }) });
  await assert.rejects(
    () => processMeeting({ audioBuffer: Buffer.from('x'), mimeType: 'audio/webm', userTitle: '' }, deps),
    (e) => e instanceof AppError && e.stage === 'analyze');
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `node --test test/pipeline.test.js`
Expected: FAIL（`processMeeting` 尚未定義）。

- [ ] **Step 3: 在 `src/pipeline.js` 加入 `processMeeting`**

在 `src/pipeline.js` 頂部補上 import，並在檔尾加入函式：
```js
import { formatStamp } from './clock.js';
import { analyze as defaultAnalyze } from './analyzers/index.js';
import { writeOutput as defaultWriteOutput } from './outputs/index.js';

export async function processMeeting(input, deps = {}) {
  const analyzeFn = deps.analyze || defaultAnalyze;
  const writeFn = deps.writeOutput || defaultWriteOutput;
  const now = deps.now || (() => new Date());

  const analysis = await analyzeFn(input.audioBuffer, input.mimeType);
  validateAnalysis(analysis);

  const stamp = formatStamp(now());
  const title = decideTitle(input.userTitle, analysis.suggestedTitle, stamp.date);
  const result = {
    title,
    summary: analysis.summary,
    keyPoints: analysis.keyPoints,
    transcript: analysis.transcript,
  };
  const destination = await writeFn(result, stamp);
  return { ...result, destination };
}
```
（`import { AppError } from './errors.js'` 已存在於 Task 2，勿重複。）

- [ ] **Step 4: 執行測試確認通過**

Run: `node --test test/pipeline.test.js`
Expected: PASS。

- [ ] **Step 5: 跑全部測試確保無回歸**

Run: `npm test`
Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add src/pipeline.js test/pipeline.test.js
git commit -m "feat: processMeeting 管線串接分析→驗證→標題→輸出"
```

---

## Task 9: HTTP 伺服器與 `/api/process`

**Files:**
- Create: `src/server.js`, `test/server.test.js`

**Interfaces:**
- Consumes: `processMeeting`（Task 8）
- Produces:
  - `checkConfig(env) -> string[]`（設定警告清單）
  - `createApp(deps?: { processMeeting }) -> Express app`
  - `start() -> void`（印設定提醒並 `listen`）
  - 路由 `POST /api/process`：multipart 欄位 `audio`（檔）、`title`（字串）；成功回 `{ ok:true, title, summary, keyPoints, transcript, destination }`；失敗回 `{ ok:false, stage, message }`。

- [ ] **Step 1: 寫失敗測試**

`test/server.test.js`：
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../src/errors.js';
import { checkConfig, createApp } from '../src/server.js';

test('checkConfig 缺 GEMINI_API_KEY 提出警告', () => {
  const w = checkConfig({});
  assert.ok(w.some((m) => m.includes('GEMINI_API_KEY')));
});
test('checkConfig 有 key 但無 Notion 提示改走 md', () => {
  const w = checkConfig({ GEMINI_API_KEY: 'x' });
  assert.ok(w.some((m) => m.includes('.md')));
});

async function postAudio(port, { title = '會議' } = {}) {
  const fd = new FormData();
  fd.set('title', title);
  fd.set('audio', new Blob([Buffer.from('abc')], { type: 'audio/webm' }), 'a.webm');
  const res = await fetch(`http://localhost:${port}/api/process`, { method: 'POST', body: fd });
  return { status: res.status, body: await res.json() };
}

test('POST /api/process 成功回傳結果', async () => {
  const app = createApp({
    processMeeting: async (input) => ({
      title: input.userTitle, summary: 's', keyPoints: ['a'], transcript: 't',
      destination: { type: 'markdown', filePath: '/x.md' },
    }),
  });
  const server = app.listen(0);
  const { port } = server.address();
  const { status, body } = await postAudio(port, { title: 'Hi' });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.title, 'Hi');
  assert.equal(body.destination.type, 'markdown');
  server.close();
});

test('POST /api/process 分析失敗回 ok:false 與 stage', async () => {
  const app = createApp({
    processMeeting: async () => { throw new AppError('analyze', '額度用完'); },
  });
  const server = app.listen(0);
  const { port } = server.address();
  const { status, body } = await postAudio(port);
  assert.equal(status, 400);
  assert.equal(body.ok, false);
  assert.equal(body.stage, 'analyze');
  assert.equal(body.message, '額度用完');
  server.close();
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `node --test test/server.test.js`
Expected: FAIL（找不到模組）。

- [ ] **Step 3: 實作 `src/server.js`**

```js
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
```

- [ ] **Step 4: 執行測試確認通過**

Run: `node --test test/server.test.js`
Expected: PASS。

- [ ] **Step 5: 跑全部測試**

Run: `npm test`
Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add src/server.js test/server.test.js
git commit -m "feat: Express 伺服器與 /api/process 路由"
```

---

## Task 10: 前端頁面（錄音 UI）

**Files:**
- Create: `public/index.html`, `public/app.js`

**Interfaces:**
- Consumes: `POST /api/process`（Task 9）
- Produces: 單頁四狀態 UI（開始前 / 錄音中含暫停繼續重新開始 / 處理中 / 完成）。此任務以**手動測試**驗收（需真實麥克風）。

- [ ] **Step 1: 建立 `public/index.html`**

```html
<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>會議記錄工具</title>
  <style>
    body { font-family: -apple-system, "PingFang TC", sans-serif; max-width: 640px; margin: 40px auto; padding: 0 16px; color: #1a1a1a; }
    h1 { font-size: 20px; }
    input[type=text] { width: 100%; padding: 8px; font-size: 15px; box-sizing: border-box; margin-bottom: 12px; }
    button { font-size: 15px; padding: 10px 16px; margin: 4px 6px 4px 0; cursor: pointer; border-radius: 8px; border: 1px solid #ccc; background: #fff; }
    button.primary { background: #2d6cdf; color: #fff; border-color: #2d6cdf; }
    button.danger { color: #c0392b; border-color: #e0b4ae; }
    canvas { width: 100%; height: 48px; background: #f4f6fa; border-radius: 8px; display: block; margin: 8px 0; }
    .hidden { display: none; }
    .step { margin: 4px 0; color: #666; }
    .step.done { color: #1a8a4a; }
    .step.active { color: #2d6cdf; font-weight: 600; }
    #err { color: #c0392b; margin-top: 12px; white-space: pre-wrap; }
    #preview { background: #f4f6fa; padding: 12px 16px; border-radius: 8px; margin-top: 12px; }
    a.result { display: inline-block; margin: 8px 0; font-weight: 600; }
    .timer { font-size: 28px; font-variant-numeric: tabular-nums; }
  </style>
</head>
<body>
  <h1>🎙️ 會議記錄工具</h1>

  <section id="view-idle">
    <input id="title" type="text" placeholder="會議標題（選填，空白就用日期）" />
    <button id="btn-start" class="primary">● 開始錄音</button>
  </section>

  <section id="view-recording" class="hidden">
    <div>🔴 <span id="rec-label">錄音中</span>　<span class="timer" id="timer">00:00</span></div>
    <canvas id="wave" width="600" height="48"></canvas>
    <button id="btn-pause">⏸ 暫停</button>
    <button id="btn-stop" class="primary">■ 停止並分析</button>
    <button id="btn-restart" class="danger">↺ 重新開始</button>
  </section>

  <section id="view-processing" class="hidden">
    <div class="step" id="s-upload">○ 上傳音檔</div>
    <div class="step" id="s-analyze">○ Gemini 分析中（逐字稿＋摘要＋重點）</div>
    <div class="step" id="s-write">○ 寫入輸出</div>
  </section>

  <section id="view-done" class="hidden">
    <div>✅ 完成！</div>
    <a class="result" id="result-link" href="#" target="_blank"></a>
    <div id="preview"></div>
    <button id="btn-new" class="primary">＋ 記錄新會議</button>
  </section>

  <div id="err" class="hidden"></div>
  <button id="btn-retry" class="hidden">↻ 用同一段錄音重試</button>

  <script src="app.js" type="module"></script>
</body>
</html>
```

- [ ] **Step 2: 建立 `public/app.js`**

```js
const $ = (id) => document.getElementById(id);
const views = ['idle', 'recording', 'processing', 'done'];
function show(view) {
  for (const v of views) $(`view-${v}`).classList.toggle('hidden', v !== view);
}

let mediaRecorder = null;
let stream = null;
let chunks = [];
let lastBlob = null;
let seconds = 0;
let timerId = null;
let audioCtx = null;
let analyser = null;
let rafId = null;

function fmt(s) {
  const m = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${m}:${ss}`;
}
function startTimer() {
  timerId = setInterval(() => { seconds += 1; $('timer').textContent = fmt(seconds); }, 1000);
}
function stopTimer() { clearInterval(timerId); timerId = null; }

function drawWave() {
  const canvas = $('wave');
  const ctx = canvas.getContext('2d');
  const data = new Uint8Array(analyser.frequencyBinCount);
  const render = () => {
    rafId = requestAnimationFrame(render);
    analyser.getByteFrequencyData(data);
    const avg = data.reduce((a, b) => a + b, 0) / data.length;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#2d6cdf';
    const h = Math.min(canvas.height, (avg / 255) * canvas.height * 2);
    ctx.fillRect(0, canvas.height - h, canvas.width, h);
  };
  render();
}
function stopWave() { if (rafId) cancelAnimationFrame(rafId); rafId = null; }

async function startRecording() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    showError('無法取得麥克風權限。請到瀏覽器網址列左側開啟本網站的麥克風權限後再試。');
    return;
  }
  chunks = [];
  seconds = 0;
  $('timer').textContent = '00:00';
  mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  mediaRecorder.start();
  audioCtx = new AudioContext();
  analyser = audioCtx.createAnalyser();
  audioCtx.createMediaStreamSource(stream).connect(analyser);
  drawWave();
  startTimer();
  show('recording');
}

function togglePause() {
  if (!mediaRecorder) return;
  if (mediaRecorder.state === 'recording') {
    mediaRecorder.pause();
    stopTimer();
    $('btn-pause').textContent = '▶ 繼續';
    $('rec-label').textContent = '已暫停';
  } else if (mediaRecorder.state === 'paused') {
    mediaRecorder.resume();
    startTimer();
    $('btn-pause').textContent = '⏸ 暫停';
    $('rec-label').textContent = '錄音中';
  }
}

function cleanupStream() {
  stopTimer();
  stopWave();
  if (stream) stream.getTracks().forEach((t) => t.stop());
  if (audioCtx) audioCtx.close();
  stream = null; audioCtx = null; analyser = null;
}

function restartRecording() {
  if (!confirm('確定要丟掉目前錄音、重新開始嗎？')) return;
  try { if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop(); } catch {}
  cleanupStream();
  chunks = [];
  show('idle');
}

function stopAndAnalyze() {
  if (!mediaRecorder) return;
  mediaRecorder.onstop = async () => {
    cleanupStream();
    lastBlob = new Blob(chunks, { type: 'audio/webm' });
    await sendForProcessing();
  };
  mediaRecorder.stop();
}

function setStep(id, state) {
  const el = $(id);
  el.className = `step ${state}`;
  el.textContent = el.textContent.replace(/^[○⟳✓] /, state === 'done' ? '✓ ' : state === 'active' ? '⟳ ' : '○ ');
}

async function sendForProcessing() {
  show('processing');
  setStep('s-upload', 'active');
  const fd = new FormData();
  fd.set('title', $('title').value || '');
  fd.set('audio', lastBlob, 'recording.webm');
  try {
    setStep('s-upload', 'done');
    setStep('s-analyze', 'active');
    const res = await fetch('/api/process', { method: 'POST', body: fd });
    const body = await res.json();
    if (!body.ok) throw new Error(body.message || '處理失敗');
    setStep('s-analyze', 'done');
    setStep('s-write', 'done');
    renderDone(body);
  } catch (e) {
    showError(`處理失敗：${e.message}`, true);
  }
}

function renderDone(body) {
  const link = $('result-link');
  if (body.destination.type === 'notion') {
    link.textContent = '📄 已寫入 Notion → 開啟會議記錄';
    link.href = body.destination.url;
  } else {
    link.textContent = `📄 已存成桌面檔案：${body.destination.filePath}`;
    link.href = '#';
  }
  const points = body.keyPoints.map((p) => `<li>${p}</li>`).join('');
  $('preview').innerHTML = `<b>【摘要】</b><br>${body.summary}<br><br><b>【重點】</b><ul>${points}</ul><small>（完整逐字稿已另存）</small>`;
  show('done');
}

function showError(msg, retryable = false) {
  const err = $('err');
  err.textContent = msg;
  err.classList.remove('hidden');
  $('btn-retry').classList.toggle('hidden', !retryable);
  if (retryable) show('idle'); // 回到可操作狀態，但保留 lastBlob 供重試
}

function clearError() {
  $('err').classList.add('hidden');
  $('btn-retry').classList.add('hidden');
}

$('btn-start').onclick = () => { clearError(); startRecording(); };
$('btn-pause').onclick = togglePause;
$('btn-stop').onclick = stopAndAnalyze;
$('btn-restart').onclick = restartRecording;
$('btn-new').onclick = () => { clearError(); lastBlob = null; $('title').value = ''; show('idle'); };
$('btn-retry').onclick = () => { if (lastBlob) { clearError(); sendForProcessing(); } };

show('idle');
```

- [ ] **Step 3: 手動測試（需真實麥克風，逐項打勾）**

先確保 `.env` 已填 `GEMINI_API_KEY`（Notion 可先不填，走 `.md`）。Run: `npm start`，開 `http://localhost:3000`。
- [ ] 首次按「開始錄音」跳出麥克風授權；拒絕後顯示提示訊息。
- [ ] 錄音中計時器每秒遞增、波形隨聲音起伏。
- [ ] 按「暫停」計時停住、波形靜止、鈕變「▶ 繼續」；按繼續後接續錄，時長不含暫停期間。
- [ ] 按「重新開始」跳確認；確認後回到開始前狀態、計時歸零。
- [ ] 錄一小段後按「停止並分析」，處理中三步驟依序 ○ → ⟳ → ✓。
- [ ] 完成後顯示 `.md` 路徑（或 Notion 連結）與摘要/重點預覽；桌面確實出現 `.md` 檔、內容為繁體中文且逐字稿無講者標記。
- [ ] 按「記錄新會議」回到初始狀態、標題清空。

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/app.js
git commit -m "feat: 前端錄音頁（四狀態＋暫停/繼續/重新開始）"
```

---

## Task 11: 啟動器、README 與端到端驗收

**Files:**
- Create: `會議記錄.command`, `README.md`

**Interfaces:**
- Consumes: 整個應用
- Produces: 雙擊啟動器 + 使用文件；完成一次真實端到端流程驗收。

- [ ] **Step 1: 建立 `會議記錄.command`**

```bash
#!/bin/bash
# 雙擊即可啟動會議記錄工具。請把本檔留在專案根目錄。
cd "$(dirname "$0")" || exit 1
if [ ! -d node_modules ]; then
  echo "首次啟動，安裝相依中…"
  npm install
fi
node src/server.js &
SERVER_PID=$!
sleep 1.5
open "http://localhost:3000"
echo "工具已啟動（PID $SERVER_PID）。關閉此終端機視窗即會停止伺服器。"
wait $SERVER_PID
```

- [ ] **Step 2: 給啟動器執行權限**

Run:
```bash
chmod +x ~/.claude/projects/meeting-recorder/會議記錄.command
```

- [ ] **Step 3: 建立 `README.md`**

`README.md`：
````markdown
# 會議記錄工具

瀏覽器即時錄音 → Gemini 免費版產出「逐字稿＋摘要＋重點」→ 寫進指定 Notion 頁面底下（或桌面 `.md`）。全繁體中文、本機執行。

## 一、安裝

需要 Node.js 18 以上。
```bash
npm install
cp .env.example .env
```

## 二、申請三把鑰匙，填進 `.env`

1. **`GEMINI_API_KEY`（必要，免費）**
   到 https://aistudio.google.com/apikey 用 Google 帳號登入 → 建立 API key → 複製貼到 `.env`。

2. **`NOTION_TOKEN`（選填，要寫 Notion 才需要）**
   到 https://www.notion.so/my-integrations → New integration → 複製 Internal Integration Token。

3. **`NOTION_PARENT_PAGE_ID`（選填）**
   在 Notion 開啟你要放會議記錄的「父頁面」→ 右上 `•••` → Connections → 加入剛剛建立的 integration（否則會寫入失敗）。
   父頁面網址結尾那段 32 碼英數即為 page id，貼進 `.env`。

> 沒填 Notion 兩項時，結果會自動改存成**桌面 `.md` 檔**。

## 三、使用

- **雙擊 `會議記錄.command`**（建議把它拉到 Dock 或在桌面建立替身），會自動啟動並開啟瀏覽器。
- 或手動：`npm start`，再開 http://localhost:3000。

填標題（可跳過）→ 開始錄音 →（可暫停/繼續/重新開始）→ 停止並分析 → 取得 Notion 連結或 `.md` 路徑。

## 四、測試

- 自動化：`npm test`
- 前端手動測試清單見實作計畫 Task 10 Step 3。

## 五、費用與限制

- Gemini 免費版：約每天 250 次請求、單場會議建議 2 小時內。個人用足夠，且不產生費用。
- 免費版資料可能被 Google 用於改善模型；機密會議請斟酌。
````

- [ ] **Step 4: 端到端驗收（真實一次）**

先確認 `.env` 已填 `GEMINI_API_KEY`。
- [ ] 雙擊 `會議記錄.command`，瀏覽器自動開啟工具頁。
- [ ] 錄一段 30 秒的測試語音（可自己講幾句），停止並分析。
- [ ] 未設 Notion 時：桌面出現 `.md`，內容含摘要/重點/逐字稿、全繁中、無講者標記。
- [ ] 設好 Notion 後重跑一次：父頁面底下出現主頁（含日期/摘要/重點）與「完整逐字稿」子頁，完成畫面的 Notion 連結可開啟。

- [ ] **Step 5: 跑全部自動化測試**

Run: `npm test`
Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add 會議記錄.command README.md
git commit -m "feat: 雙擊啟動器與 README（含端到端驗收）"
```

---

## 自我檢查（Self-Review）結果

**1. Spec 覆蓋**
- 形態與啟動（本機伺服器 + `.command`）→ Task 1、9、11 ✅
- 前端四狀態 + 暫停/繼續/重新開始 → Task 10 ✅
- Gemini File API 一次產出結構化 JSON、繁中、無講者標記 → Task 6 ✅
- 分析引擎抽象可換 → Task 6 + Task 7 ✅
- 輸出：Notion 主頁＋逐字稿子頁；自動選 Notion / 桌面 `.md` → Task 3、4、5 ✅
- `.env`（GEMINI/ENGINE/NOTION_TOKEN/NOTION_PARENT_PAGE_ID/PORT）+ `.env.example` + 申請說明 → Task 1、11 ✅
- 驗證規則（摘要/重點/逐字稿非空、重點陣列非空無空項）→ Task 2 ✅
- 錯誤處理（麥克風、上傳、Gemini 可重試、Notion 失敗保留結果、缺 key 提示）→ Task 9（`{ok,stage,message}`）、Task 10（前端提示與重試）、Task 9 `checkConfig` ✅
- 測試策略（後端自動化、前端手動清單）→ 各 Task 測試 + Task 10 Step 3 ✅
- 全域約束（繁中、免費優先、金鑰安全、本機、model、不做講者辨識）→ Global Constraints + 各任務 ✅

**2. Placeholder 掃描**：無 TBD/TODO；每個 code step 都有實際程式碼；每個 test step 都有實際斷言。✅

**3. 型別一致性**：`analysis`/`result`/`stamp`/`destination`/`AppError(stage,message)` 全計畫一致；`analyze(audioBuffer,mimeType[,deps])`、`writeOutput(result,stamp,deps)`、`writeNotion(result,stamp,deps)`、`writeMarkdown(result,stamp,destDir)`、`processMeeting(input,deps)`、`createApp(deps)` 的簽名在定義與呼叫端一致。✅

（發現的小事已於撰寫時內聯修正：前端 `setStep` 以圖示前綴切換狀態，避免與文字重複；Notion 逐字稿超過 100 blocks 以 `append` 分批補上。）
