# 會議記錄工具

瀏覽器即時錄音 → Gemini 免費版產出「逐字稿＋摘要＋重點」→ 寫進指定 Notion 頁面底下（或桌面 `.md`）。全繁體中文、本機執行。

## 一、安裝

需要 Node.js 20 以上。
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
