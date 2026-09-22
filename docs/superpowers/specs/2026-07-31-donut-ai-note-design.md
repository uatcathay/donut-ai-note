# 會議錄音重點工具 — 設計文件（Design Spec）

**日期**：2026-07-31
**狀態**：設計定案，待寫實作計畫

---

## 一句話目標

桌面雙擊圖示 → 網頁即時錄音 → Gemini 免費版一次產出「逐字稿 + 摘要 + 重點」→ 自動寫進指定 Notion 頁面底下（或桌面 `.md`）。全程繁體中文、本機執行、不產生任何費用。

## 背景與動機

使用者一直用 **Notion 的 AI 筆記寫手**做會議紀錄，但這功能有兩個痛點：

- **貴**：需要很高階（昂貴）的方案才能用。
- **不好共用**：目前綁在團隊最高權限的管理帳號上，不方便讓團隊所有人一起用那個最高權限帳號。

在研究其他錄音工具的過程中，剛好看到 RD 同事分享的小工具「瀏覽器錄音 → 丟 NotebookLM 分析」做會議重點。於是想參考它做一個自己的工具：把整條流程自動化、用免費方案取代昂貴的 Notion AI，並把結果寫進自己的 Notion（NotebookLM 做不到）。第一版供個人日常使用，**之後希望能分享給團隊其他設計師使用**。

## 非目標（YAGNI）

- **v1 不做雲端部署**：先做本機版、自己先用起來。這是階段性決定，非永久放棄；未來要分享團隊時，再從「各設計師各自本機安裝」或「雲端共用」兩條路擇一（見「已知限制與後續 › 團隊分享」）。現在把雲端拉進來會大幅拉長第一版。
- 不做多人帳號 / 分享 / 權限（v1）。
- 不做即時逐字（邊講邊出字）；錄完再一次分析即可。
- **不做講者辨識分軌（speaker diarization）**：精準分軌難度高、且標錯人會造成事後閱讀困擾；best-effort 的模型自動標記也不採用。逐字稿以**純段落**輸出，不帶「說話者A/B」之類的講者標記。
- 不做超長錄音（> 2 小時）的自動切段；第一版以單次請求可處理的長度為主。

---

## 使用者旅程

1. 使用者在桌面**雙擊 `會議記錄.command` 圖示**。
2. 腳本自動啟動本機 Node 伺服器，並自動開啟 Chrome 到 `http://localhost:3000`。
3. 網頁上（選填）輸入會議標題 → 按「開始錄音」。
4. 錄音中顯示計時與音量波形；可「⏸ 暫停 / ▶ 繼續」，或「↺ 重新開始」（丟掉重錄），完成後按「■ 停止並分析」。
5. 音檔送到後端 → Gemini 分析 → 寫入 Notion / 桌面 `.md`。
6. 完成畫面顯示結果連結（Notion 連結或 `.md` 路徑）與摘要/重點預覽。
7. 按「記錄新會議」可再來一場；用完直接關掉視窗。

---

## 系統架構

一個跑在使用者 Mac 上的 **Node 小伺服器 + 單頁前端網頁**。API key 全部存在本機 `.env`，絕不進入瀏覽器。

```
瀏覽器網頁（前端）                 本機 Node 後端                      外部服務
──────────────                    ──────────────                     ────────
[填標題 / 錄音]                    GET  /            → 回傳前端網頁
      │                           POST /api/process → 收音檔跑流程
      │  音檔 blob (webm/opus)           │
      └──────────────────────────▶      ├──▶ 分析引擎（Gemini）─▶ {逐字稿, 摘要, 重點, 建議標題}
                                         │
                                         ├──▶ 輸出目的地
                                         │      ├─ 有 NOTION_PARENT_PAGE_ID → Notion
                                         │      └─ 沒有 → 桌面 .md
      [結果 + 連結] ◀── JSON ────────────┘
```

### 技術棧

- **執行環境**：Node.js（LTS）
- **後端框架**：Express
- **分析引擎**：`@google/genai`（Gemini），透過抽象介面接入（見下）
- **Notion**：`@notionhq/client`
- **前端**：純 HTML/CSS/JS（不用框架），`MediaRecorder` 錄音
- **測試**：Node 內建 `node:test` + `assert`（後端），前端用手動測試清單
- **啟動器**：macOS `.command` 腳本

---

## 元件設計（模組邊界）

每個模組單一職責、介面明確、可獨立測試。

### 1. 前端頁面 `public/index.html` + `public/app.js`

**職責**：錄音、狀態切換、把音檔與標題送後端、顯示結果。

**四個狀態**：
- **開始前**：標題輸入框（選填）+「開始錄音」鈕。
- **錄音中**：計時器（mm:ss）+ 音量波形 + 三顆鈕：「⏸ 暫停 / ▶ 繼續」（同一顆切換）、「■ 停止並分析」、「↺ 重新開始」。
  - **暫停**時計時器停住、波形靜止，鈕變「▶ 繼續」；繼續後接續錄。
  - **重新開始**：丟掉目前錄音、回到「開始前」狀態（有確認提示，避免誤按）。
- **處理中**：三步驟進度（上傳音檔 / Gemini 分析 / 寫入輸出）。
- **完成**：輸出連結（Notion URL 或 `.md` 路徑）+ 摘要與重點預覽 +「記錄新會議」鈕。

**錄音實作**：`navigator.mediaDevices.getUserMedia({ audio: true })` → `MediaRecorder`，收集 chunks 成一個 Blob；暫停/繼續用 `MediaRecorder` 原生的 `pause()` / `resume()`（暫停期間不累加時長）；重新開始則丟棄已收集的 chunks 並重置計時器與狀態；音量波形用 `AnalyserNode` 讀取即時音量畫在 canvas 上。

**送出**：`fetch('/api/process', { method:'POST', body: FormData(音檔 + title) })`。

### 2. HTTP 伺服器 `src/server.js`

**職責**：啟動 Express、提供靜態前端、掛載 `/api/process` 路由、讀取設定、集中錯誤回應格式。

**路由**：
- `GET /` → 回 `public/index.html`
- `GET /app.js`、靜態資源
- `POST /api/process` → 見下方 pipeline

**設定讀取**：啟動時載入 `.env`；缺少必要 key 時在終端機印出清楚的設定提示並拒絕啟動關鍵功能。

### 3. 處理流程 `src/pipeline.js`

**職責**：串接「分析 → 驗證 → 輸出」，是 `/api/process` 的核心。

**函式**：`processMeeting({ audioBuffer, mimeType, userTitle }) → { title, summary, keyPoints, transcript, destination }`

流程：
1. 呼叫 `analyze(audioBuffer, mimeType)` 取得分析結果。
2. 驗證結果（見驗證規則）。
3. 決定標題：`userTitle` 非空則用之，否則用 `suggestedTitle`，再否則用日期字串。
4. 呼叫輸出目的地（Notion 或 `.md`），回傳 `destination`（含 url 或 filePath）。

### 4. 分析引擎抽象 `src/analyzers/`

**這是「可換引擎」的核心 —— 固定插座、背後可換。**

**介面（所有引擎都要符合）**：
```
async analyze(audioBuffer: Buffer, mimeType: string) => {
  suggestedTitle: string,   // 依內容給的標題
  summary: string,          // 3-5 句繁體中文摘要
  keyPoints: string[],      // 繁體中文重點條列
  transcript: string        // 完整逐字稿（繁體中文）
}
```

**檔案**：
- `src/analyzers/index.js` — 依 `.env` 的 `ENGINE`（預設 `gemini`）選出對應引擎並匯出 `analyze`。
- `src/analyzers/gemini.js` — 第一版實作。用 Gemini File API 上傳音檔，呼叫 `gemini-2.5-flash`，要求回傳結構化 JSON，全繁體中文。
- （未來）`src/analyzers/openai.js` — 之後想接 GPT（Whisper 轉稿 + GPT 整理）時新增，其他程式碼不動。

**Gemini prompt 要求**（重點）：
- 明確指示「以繁體中文輸出」。
- 要求回傳 JSON，欄位：`suggestedTitle`、`summary`、`keyPoints`（陣列）、`transcript`。
- 摘要 3-5 句；重點為精煉條列；逐字稿盡量完整、以自然語意分段。**不要標記講者**（不需 說話者A/B 之類標籤），純段落即可。

### 5. 輸出目的地 `src/outputs/`

**職責**：把分析結果寫到目的地。依設定自動選擇。

**選擇規則**（在 `src/outputs/index.js`）：
- 有設 `NOTION_PARENT_PAGE_ID`（且有 `NOTION_TOKEN`）→ 用 Notion。
- 否則 → 寫桌面 `.md`。

**`src/outputs/notion.js`**：
- 用 `@notionhq/client`，在 `NOTION_PARENT_PAGE_ID` 底下建立**主頁**：
  - 標題 = 會議標題
  - 內文：日期段落（`📅 YYYY-MM-DD`，自動帶當天）→ `## 摘要` + 摘要段落 → `## 重點` + 條列（bulleted_list_item）。
  - 取回主頁 page id 後，在主頁底下建立**子頁**「完整逐字稿」，內文放逐字稿全文（過長時分成多個 paragraph block，遵守 Notion 單一 block 文字上限）。
- 回傳 `{ type:'notion', url: 主頁 url }`。

**`src/outputs/markdown.js`**：
- 檔名：`會議記錄_YYYY-MM-DD_HHmm_<標題>.md`，寫到使用者桌面（`~/Desktop`）。
- 內容：`# 標題` → 日期 → `## 摘要` → `## 重點`（`- ` 條列）→ `## 完整逐字稿`。
- 回傳 `{ type:'markdown', filePath }`。

### 6. 啟動器 `會議記錄.command`

**職責**：讓使用者雙擊即可用。

- 內容：`cd` 到專案目錄 → 若 `node_modules` 不存在則 `npm install` → 背景啟動 `node src/server.js` → `open http://localhost:3000`。
- 需 `chmod +x` 才能雙擊執行；README 說明如何放到桌面。

---

## 資料流與 Notion 結構

```
📄 父頁面（NOTION_PARENT_PAGE_ID，寫在 .env）
  └── 📄 [會議標題]（主頁）
        │  📅 2026-07-31
        │  ## 摘要
        │  （摘要段落）
        │  ## 重點
        │  • 重點一
        │  • 重點二
        │  └── 📄 完整逐字稿（子頁）
        │         （逐字稿全文）
```

沒設 Notion 時，等價內容寫成桌面 `.md`。

---

## 設定（`.env`）

| 變數 | 必要性 | 說明 |
|------|--------|------|
| `GEMINI_API_KEY` | 必要 | Google AI Studio 免費申請 |
| `ENGINE` | 選填 | 分析引擎，預設 `gemini` |
| `NOTION_TOKEN` | 選填 | Notion Integration Token；要寫 Notion 才需要 |
| `NOTION_PARENT_PAGE_ID` | 選填 | 父頁面 ID；有設才寫 Notion，否則寫桌面 `.md` |
| `PORT` | 選填 | 預設 `3000` |

附 `.env.example` 與三把鑰匙（Gemini key、Notion token、Notion 父頁面 ID + 把 integration 加到該頁）的申請步驟說明，放在 README。

---

## 驗證規則（分析結果）

`processMeeting` 在寫輸出前驗證分析結果，任何一項不符即視為失敗、回可重試錯誤：

- `summary`：字串、非空。
- `keyPoints`：陣列、至少 1 項、每項非空字串。
- `transcript`：字串、非空。
- `suggestedTitle`：字串（可為空，空時走日期後備）。

---

## 錯誤處理

每一步失敗都回前端**清楚的繁體中文訊息**，並盡量不讓使用者「白錄」：

| 失敗點 | 行為 |
|--------|------|
| 麥克風未授權 | 前端提示去瀏覽器開啟麥克風權限，不送後端 |
| 音檔上傳失敗 | 前端顯示錯誤，保留錄音可重試 |
| Gemini 失敗 / 額度用完 / JSON 驗證失敗 | 顯示錯誤，**保留錄音的 Blob** 讓使用者按「重試」再送一次，不需重錄 |
| Notion 寫入失敗 | 顯示錯誤，但把已分析出的摘要/重點/逐字稿留在畫面上供手動複製；並提示可改用桌面 `.md`（若當下走的是 Notion） |
| 缺少 `GEMINI_API_KEY` | 伺服器啟動時於終端機印出設定指引 |

前端錯誤訊息採統一格式：`{ ok:false, stage, message }`，後端所有失敗回應都遵守此格式。

---

## 測試策略

### 後端（自動化，`node:test`）

- **分析引擎**：mock Gemini 回應
  - 正常 JSON → `analyze` 回傳正確結構。
  - 壞 JSON / 缺欄位 → 拋出可辨識錯誤。
- **驗證規則**：各種缺欄位 / 空值 / 空陣列 → 正確判為失敗；合法輸入 → 通過。
- **標題決策**：`userTitle` 有值 / 空但有 `suggestedTitle` / 兩者皆空走日期 —— 三分支各測。
- **輸出選擇**：有 `NOTION_PARENT_PAGE_ID` → 走 Notion；沒有 → 走 markdown。
- **Notion 結構組裝**：mock `@notionhq/client`，驗證送出的 block 結構（標題、日期、摘要、重點條列、逐字稿子頁）正確。
- **Markdown 產生**：給定分析結果 → 產出的 `.md` 內容與檔名符合預期。
- **錯誤格式**：各失敗點回傳 `{ ok:false, stage, message }`。

### 前端（手動測試清單）

因需真實麥克風，列一份手動清單（README 或測試文件）：
- [ ] 首次錄音會跳麥克風授權；拒絕後顯示提示。
- [ ] 錄音中計時與波形正常。
- [ ] 暫停後計時停住、波形靜止；繼續後接續錄，時長不含暫停期間。
- [ ] 「重新開始」有確認提示，確認後回到開始前狀態、舊錄音已丟棄。
- [ ] 停止後顯示三步驟進度。
- [ ] 完成後顯示 Notion 連結（或 `.md` 路徑）與預覽。
- [ ] 模擬 Gemini 失敗時可重試、不需重錄。
- [ ] 「記錄新會議」可重置回開始狀態。

---

## 檔案結構總覽

```
donut-ai-note/
├── 會議記錄.command          # 雙擊啟動器
├── package.json
├── .env.example
├── .gitignore                # 忽略 .env、node_modules、錄音暫存
├── README.md                 # 申請 key 步驟 + 使用說明 + 手動測試清單
├── public/
│   ├── index.html
│   └── app.js
├── src/
│   ├── server.js             # Express + 路由 + 設定
│   ├── pipeline.js           # 分析 → 驗證 → 輸出
│   ├── analyzers/
│   │   ├── index.js          # 依 ENGINE 選引擎
│   │   └── gemini.js
│   └── outputs/
│       ├── index.js          # 依設定選 Notion / markdown
│       ├── notion.js
│       └── markdown.js
└── test/
    ├── pipeline.test.js
    ├── analyzers.test.js
    └── outputs.test.js
```

---

## 全域約束

- **語言**：所有產出（逐字稿、摘要、重點、Notion/`.md` 內容、前端 UI 文案）一律**繁體中文**。
- **免費優先**：預設走 Gemini 免費版；不引入需付費的必要相依。
- **金鑰安全**：API key 只存本機 `.env`，`.gitignore` 必須忽略 `.env`，任何情況都不得送進前端或寫入版本控制。
- **本機執行**：第一版只在本機跑，不部署雲端。
- **模型**：分析引擎預設 `gemini-2.5-flash`。

---

## 已知限制與後續

- 單次錄音實務上以 ~2 小時內為安全範圍（Gemini 免費版每分鐘 token 上限）；更長需切段，列為後續。
- 免費版資料可能被 Google 用於改善模型；機密會議建議之後評估本機 Whisper 引擎（可透過分析引擎抽象加入）。
- 之後可加：GPT 引擎（`src/analyzers/openai.js`）、雲端部署、Notion 資料庫模式。
- **團隊分享**：v1 為本機個人版；要分享給團隊其他設計師時，需評估部署方式（各自本機安裝、或雲端共用），以及每人自帶 API key / Notion 目的地的設定方式。此為 v1 之後的方向，設計上以「本機先可用、模組可換」為前提保留彈性。
