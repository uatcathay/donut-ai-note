# 錄音頁視覺重做 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把錄音頁改成參考元件（AI Voice Input）的極簡樣貌——中央按鈕、等寬計時器、48 根長條 visualizer、下方文字控制項——長條由真實麥克風音量驅動，且不引入任何新依賴。

**Architecture:** 只改 `public/index.html`（標記＋內嵌 CSS）與 `public/app.js`（僅適配新標記，流程不變）。CSS 一次到位放在 Task 1，之後三個任務逐一替換各狀態的標記；每個任務結束時頁面都必須是可用的（不得留下會拋錯的 JS）。

**Tech Stack:** 原生 HTML / CSS / ES module JavaScript；Express 靜態檔；Web Audio `AnalyserNode`。無建置流程、無框架、無 CDN。

**Spec:** [docs/superpowers/specs/2026-08-02-recording-ui-redesign-design.md](../specs/2026-08-02-recording-ui-redesign-design.md)

## Global Constraints

- **零新依賴**：不得新增任何 npm 套件、CDN、建置步驟。`package.json` 不得改動。
- **不動後端**：`src/`、`test/`、`scripts/`、`package.json`、`README.md` 一律不改。`npm test` 必須全程維持 **40 / 40 全綠**。
- **CSS 留在 `public/index.html` 的 `<style>` 內**，不拆出 `.css` 檔（維持單次請求、零建置）。
- **文案**：按鈕與處理中文字用英文（`Pause` / `Resume` / `Restart` / `Click to speak` / `New AI Note` / `Analyzing with Gemini…` / `Cancel`）；錯誤訊息等長句維持繁體中文。
- **視窗尺寸**：所有版面須在 480×720 下可用且無橫向捲軸。
- **深淺色**：以 `prefers-color-scheme` 切換，兩種模式都要能看。
- **漸層色值**：`--grad-from: #F9C05C`、`--grad-to: #F52D8E`（已自 `assets/icon.png` 取樣）。所有漸層一律引用這兩個變數，不得寫死 hex。
- **visualizer 尺寸**：相對參考元件等比放大 1.5 倍——bar 寬 3px、間距 3px、容器 288×24px（整排實寬 285px，仍在 `.stage` 的 320px 內，不需調整其他版面設定）。
- **版面位置穩定**：切換狀態時中央大按鈕與其上方元素不得有任何垂直位移。`.stage` 固定 `min-height: 580px`（取自最高的完成頁：兩行標題時約 568px）且 `justify-content: flex-start`；三個標題元素同為 `min-height: calc(1.4em + 13px)` + `margin-bottom: 52px` + `line-height: 1.4`，且**最多兩行**（待機頁為 `<textarea>` 自動長高至上限兩行、超過則欄位內捲動；錄音頁與完成頁為 `-webkit-line-clamp: 2` 加 `…`）——高度有界，長標題不會推動麥克風；標題為空時 `.rec-title` 用 `visibility: hidden`（`.is-empty` class）保留空間，不得用 `display: none`；`#preview` 固定 `height: 400px` 且自身捲動，不得撐破 `.stage`。
- **完成頁**：不放勾勾圖示；摘要永遠展開不摺疊、固定高 400px、寬 `calc(100vw - 80px)`（距視窗左右各 40px）；標題字級 18px；「開啟 Notion 記錄」為文字樣式並置於摘要下方；「記錄新會議」文案為 `New AI Note`。
- **處理中頁**：三顆方塊的階梯式跳動載入動畫（`.ld-stairs`，18px、間距 9px、跳躍 21px）與下方文字間距 `20px`，整組**靠上固定**，距內容區頂端 `200px`；不再是三行打勾清單，改為**單行固定文字** `Analyzing with Gemini…`，不做階段性變化（`sendForProcessing()` 因此維持使用 `fetch`）。
- **標題字級**：待機、錄音、完成三頁的標題一律 `18px`；標題槽高度 `36px`（18px 字放不進原本的 32px）。
- **Restart 確認**：改為頁面內的自訂 `<dialog>` + `showModal()`，取代原生 `confirm()`；Cancel 與 Esc 都不得丟棄錄音。
- **必須保留的既有行為**：麥克風權限失敗訊息、失敗後保留 `lastBlob` 供重試、`pagehide` 送 `/shutdown`、Notion / `.md` 兩種輸出分支、`esc()` 的 XSS 跳脫、丟棄錄音前必須先確認。

## 檔案結構

```
meeting-recorder/
├── public/
│   ├── index.html   # 修改：四狀態標記全面重寫 + 內嵌 CSS（約 200 行）
│   └── app.js       # 修改：僅適配新標記，錄音流程與 API 串接不變
└── docs/superpowers/plans/2026-08-02-recording-ui-redesign.md   # 本檔
```

**任務順序的理由**：Task 1 一次放進完整 CSS 並只換待機頁，此時錄音頁仍是舊的 `<canvas>` 標記、`app.js` 也還沒改，頁面完全可用。Task 2、3 再逐一把舊標記換成新標記，並同步改 `app.js`。這樣每個 commit 都是可運作的狀態。

---

## Task 1: 視覺基礎與待機頁

**Files:**
- Modify: `public/index.html`（`<style>` 全面替換、`view-idle` 區塊替換、`<body>` 外層加 `.stage`）
- Modify: `public/app.js`（新增 visualizer 長條的產生迴圈）

**Interfaces:**
- Produces:
  - CSS 變數：`--grad-from`、`--grad-to`、`--fg`、`--fg-70`、`--fg-30`、`--fg-10`、`--bg`、`--ok`、`--danger`、`--danger-bg`（Task 2、3 直接使用）
  - CSS 類別：`.stage`、`.panel`、`.hidden`、`.title-input`、`.orb`、`.mic`、`.cube`、`.timer`、`.wave`、`.bar`、`.hint`、`.linkbtn`、`.linkbtn--danger`、`.rec-title`、`.ring`、`.proc-stage`、`.done-title`、`.linkbtn.is-file`、`#preview`（Task 2、3 的標記直接套用）
  - `app.js` 常數 `BARS = 48` 與 `.wave` 填充迴圈（Task 2 的 `drawWave()` 依賴 `#wave .bar` 已存在）

- [ ] **Step 1: 替換 `public/index.html` 的 `<style>` 區塊**

把 `<style>` 內既有的全部內容替換成：

```css
    :root {
      --grad-from: #F9C05C;
      --grad-to: #F52D8E;
      --fg: #1a1a1a;
      --fg-70: rgba(26, 26, 26, .7);
      --fg-30: rgba(26, 26, 26, .3);
      --fg-10: rgba(26, 26, 26, .1);
      --bg: #ffffff;
      --ok: #1a8a4a;
      --danger: #c0392b;
      --danger-bg: rgba(192, 57, 43, .1);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --fg: #f2f2f2;
        --fg-70: rgba(242, 242, 242, .7);
        --fg-30: rgba(242, 242, 242, .3);
        --fg-10: rgba(242, 242, 242, .1);
        --bg: #131313;
        --ok: #4ade80;
        --danger: #ff6b5e;
        --danger-bg: rgba(255, 107, 94, .12);
      }
    }

    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh; padding: 24px;
      display: flex; align-items: center; justify-content: center;
      background: var(--bg); color: var(--fg);
      font-family: -apple-system, "PingFang TC", sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    /* min-height 固定，內容自頂端起排：狀態切換時外框高度不變，垂直置中的結果因此恆定 */
    .stage {
      width: 100%; max-width: 320px; min-height: 560px;
      display: flex; flex-direction: column; align-items: center; justify-content: flex-start;
    }
    .panel { display: flex; flex-direction: column; align-items: center; width: 100%; }
    .hidden { display: none !important; }

    /* 標題：兩種狀態的槽位高度必須一致，否則切換時上方元素會位移 */
    .title-input, .rec-title { height: 36px; margin-bottom: 32px; }
    .title-input {
      width: 100%; padding: 6px 0;
      border: 0; border-bottom: 1px solid transparent; outline: none;
      background: none; color: var(--fg);
      font: inherit; font-size: 18px; text-align: center;
    }
    .title-input::placeholder { color: var(--fg-30); }
    .title-input:focus { border-bottom-color: var(--fg-30); }
    .rec-title {
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; text-align: center;
    }
    /* 標題為空時保留空間，不可用 display:none（會抽掉槽位造成上移） */
    .rec-title.is-empty { visibility: hidden; }

    /* 中央大按鈕 */
    .orb {
      width: 64px; height: 64px; margin-bottom: 8px;
      display: flex; align-items: center; justify-content: center;
      border: 0; border-radius: 12px; background: none; cursor: pointer;
      transition: background-color .2s;
    }
    /* 錄音中的方塊同樣要有 hover 灰底——它是「停止並分析」的觸發點，沒有回饋會看不出可點 */
    .orb:hover { background: var(--fg-10); }
    .mic { width: 24px; height: 24px; color: var(--fg-70); }
    .cube {
      width: 24px; height: 24px; border-radius: 4px;
      background: linear-gradient(135deg, var(--grad-from), var(--grad-to));
      animation: spin 3s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .paused .cube { animation-play-state: paused; }

    /* 計時器 */
    .timer {
      margin-bottom: 8px;
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
      font-size: 14px; font-variant-numeric: tabular-nums;
      color: var(--fg-30);
    }
    #view-recording .timer { color: var(--fg-70); }

    /* visualizer（相對參考元件等比放大 1.5 倍，錄音時更明顯） */
    .wave {
      width: 288px; height: 24px; margin-bottom: 20px;
      display: flex; align-items: center; justify-content: center; gap: 3px;
    }
    .wave .bar {
      width: 3px; height: 100%; border-radius: 1.5px;
      background: var(--fg-10);
      transform: scaleY(.25); transform-origin: center;
      transition: transform .12s ease-out;
    }
    #wave .bar {
      background: linear-gradient(180deg, var(--grad-from), var(--grad-to));
      transform: scaleY(.2);
    }

    /* 文字控制項 */
    .hint { height: 16px; font-size: 12px; color: var(--fg-70); }
    .linkbtn {
      padding: 4px 10px; border: 0; border-radius: 6px;
      background: none; color: var(--fg-70); cursor: pointer;
      font: inherit; font-size: 12px;
      display: inline-block; text-decoration: none;   /* 同一套樣式也用在 <a> 上 */
    }
    .linkbtn:hover { background: var(--fg-10); }
    .linkbtn--danger { color: var(--danger); }
    .linkbtn + .linkbtn { margin-top: 20px; }
    /* .md 輸出時連結不可點，只作為路徑顯示 */
    .linkbtn.is-file { cursor: default; word-break: break-all; }
    .linkbtn.is-file:hover { background: none; }

    /* 處理中 */
    .ring {
      width: 64px; height: 64px; border-radius: 50%;
      margin-top: 80px; margin-bottom: 20px;
      background: conic-gradient(var(--grad-from), var(--grad-to), var(--grad-from));
      -webkit-mask: radial-gradient(circle, transparent 52%, #000 54%);
      mask: radial-gradient(circle, transparent 52%, #000 54%);
      animation: pulse 1.6s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: .45; transform: scale(.94); }
      50% { opacity: 1; transform: scale(1); }
    }
    .proc-stage { font-size: 13px; color: var(--fg-70); text-align: center; }

    /* 完成 */
    .done-title { margin-bottom: 20px; font-size: 18px; text-align: center; }
    /* 摘要：永遠展開、固定高、距視窗左右各 40px（刻意寬於 .stage，靠置中突破）。
       calc(100vw - 80px) 恆窄於 body 的內容框，不會產生橫向捲軸。 */
    #preview {
      width: calc(100vw - 80px);
      height: 400px; overflow-y: auto;
      margin-bottom: 20px; padding: 12px 14px; border-radius: 10px;
      background: var(--fg-10);
      font-size: 13px; line-height: 1.6;
      text-align: left;
    }
    #preview ul { margin: 8px 0 0; padding-left: 20px; }

    /* 錯誤 */
    #err {
      margin-top: 16px; padding: 10px 12px; border-radius: 10px;
      background: var(--danger-bg); color: var(--danger);
      font-size: 13px; text-align: center; white-space: pre-wrap;
    }
    #btn-retry { margin-top: 8px; }
```

- [ ] **Step 2: 替換 `<body>` 的外層結構與待機頁標記**

把 `<body>` 內既有的全部內容（含 `<h1>`、四個 `<section>`、`#err`、`#btn-retry`、`<script>`）替換成下列內容。**注意：`view-recording`、`view-processing`、`view-done` 三段先原封不動保留舊標記**（Task 2、3 再換），只是移進 `.stage` 容器內：

```html
  <main class="stage">
    <section id="view-idle" class="panel">
      <input id="title" type="text" class="title-input" placeholder="會議標題（選填，空白就讓 AI 命名）" />
      <button id="btn-start" class="orb" title="開始錄音" aria-label="開始錄音">
        <svg class="mic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="22" />
        </svg>
      </button>
      <div class="timer" aria-hidden="true">00:00</div>
      <div class="wave" aria-hidden="true"></div>
      <div class="hint">Click to speak</div>
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
    <button id="btn-retry" class="linkbtn hidden">↻ 用同一段錄音重試</button>
  </main>

  <script src="app.js" type="module"></script>
```

> 舊的 `<h1>🎙️ 會議記錄工具</h1>` 一併移除——新版面以中央按鈕為主角，不需要頁首標題。

- [ ] **Step 3: 在 `app.js` 加入 visualizer 長條的產生迴圈**

在 `public/app.js` 頂端 `const views = [...]` 那行之後，加入：

```js
const BARS = 48;
for (const el of document.querySelectorAll('.wave')) {
  el.innerHTML = '<span class="bar"></span>'.repeat(BARS);
}
```

> 這段對 `class="wave"` 的容器生效。Task 1 只有待機頁用到；Task 2 把錄音頁的 `<canvas id="wave">` 換成 `<div id="wave" class="wave">` 後，同一段迴圈會一併填好它。

- [ ] **Step 4: 語法檢查**

Run:
```bash
cd "$(git rev-parse --show-toplevel)" && node --check public/app.js
```
Expected: 無輸出、離開碼 0。

- [ ] **Step 5: 後端回歸**

Run: `npm test`
Expected: `tests 40 / pass 40 / fail 0`。

- [ ] **Step 6: 開頁目視驗證待機頁**

Run: `npm start`，另開瀏覽器到 http://localhost:3000

Expected：
- 畫面垂直置中，由上而下是：置中的標題輸入（僅底線、無外框）→ 麥克風圖示按鈕 → `00:00` 等寬字 → 一排 48 根淡色細條 → `Click to speak`。
- 滑鼠移到麥克風按鈕上，出現淡色圓角底。
- 輸入框聚焦時底線變明顯。
- 把系統切成深色模式（或 Chrome DevTools → Rendering → Emulate CSS `prefers-color-scheme: dark`），背景轉深、文字轉淺。
- 視窗縮到 480×720 無橫向捲軸。

驗證完按 Ctrl+C 停掉伺服器。

- [ ] **Step 7: Commit**

```bash
git add public/index.html public/app.js
git commit -m "feat: 錄音頁視覺基礎（CSS 變數、深淺色、共用骨架）與待機頁重做"
```

---

## Task 2: 錄音／暫停頁與真實音量波形

**Files:**
- Modify: `public/index.html`（`view-recording` 區塊）
- Modify: `public/app.js`（`drawWave`、`togglePause`、`startRecording`）

**Interfaces:**
- Consumes: Task 1 的 CSS 類別 `.panel`、`.rec-title`、`.orb`、`.cube`、`.timer`、`.wave`、`.bar`、`.linkbtn`、`.linkbtn--danger`、`.paused`；`app.js` 的 `BARS` 常數與 `.wave` 填充迴圈。
- Produces: `#wave` 內的 48 個 `.bar`（由 `drawWave()` 以 `transform: scaleY()` 驅動）；`#view-recording` 上的 `paused` class 作為暫停態的唯一標記；新元素 `#rec-title`。

- [ ] **Step 1: 替換 `view-recording` 的標記**

把 `public/index.html` 的整個 `view-recording` 區塊替換成：

```html
    <section id="view-recording" class="panel hidden">
      <div id="rec-title" class="rec-title is-empty"></div>
      <button id="btn-stop" class="orb" title="停止並分析" aria-label="停止並分析">
        <span class="cube" aria-hidden="true"></span>
      </button>
      <div class="timer" id="timer">00:00</div>
      <div class="wave" id="wave" aria-hidden="true"></div>
      <button id="btn-pause" class="linkbtn">Pause</button>
      <button id="btn-restart" class="linkbtn linkbtn--danger">Restart</button>
    </section>
```

**注意**：`rec-label` 元素在此被移除，Step 2 必須同步刪掉 `app.js` 裡對它的兩行寫入，否則暫停會拋 null 錯誤。

- [ ] **Step 2: 改寫 `app.js` 的 `drawWave` 與 `togglePause`**

把 `drawWave()` 整個函式替換成（`stopWave()` 維持原樣，**不要**清空長條高度——暫停時的凍結效果正是靠這點）：

```js
function drawWave() {
  const bars = document.querySelectorAll('#wave .bar');
  const data = new Uint8Array(analyser.frequencyBinCount);
  const seg = Math.floor(data.length / bars.length);
  const render = () => {
    rafId = requestAnimationFrame(render);
    analyser.getByteFrequencyData(data);
    for (let i = 0; i < bars.length; i++) {
      let sum = 0;
      for (let j = i * seg; j < (i + 1) * seg; j++) sum += data[j];
      const avg = sum / seg;                    // 0–255
      bars[i].style.transform = `scaleY(${0.2 + (avg / 255) * 0.8})`;  // 20%–100%
    }
  };
  render();
}
```

把 `togglePause()` 整個函式替換成：

```js
function togglePause() {
  if (!mediaRecorder) return;
  const panel = $('view-recording');
  if (mediaRecorder.state === 'recording') {
    mediaRecorder.pause();
    stopTimer();
    stopWave();
    $('btn-pause').textContent = 'Resume';
    panel.classList.add('paused');
  } else if (mediaRecorder.state === 'paused') {
    mediaRecorder.resume();
    startTimer();
    drawWave();
    $('btn-pause').textContent = 'Pause';
    panel.classList.remove('paused');
  }
}
```

- [ ] **Step 3: 在 `startRecording()` 內重置錄音頁狀態**

在 `startRecording()` 中，緊接在 `$('timer').textContent = '00:00';` 那行之後插入：

```js
  const t = $('title').value.trim();
  $('rec-title').textContent = t;
  $('rec-title').classList.toggle('is-empty', !t);   // visibility:hidden 保留槽位，避免版面上移
  $('btn-pause').textContent = 'Pause';
  $('view-recording').classList.remove('paused');
```

> 這確保「重新開始」或「記錄新會議」之後再次錄音時，按鈕文字與暫停態不會殘留上一輪的狀態。

- [ ] **Step 4: 確認 `rec-label` 已無殘留**

Run:
```bash
cd "$(git rev-parse --show-toplevel)" && grep -c "rec-label" public/index.html public/app.js
```
Expected: 兩個檔案都回報 `0`（`grep -c` 對無匹配的檔案輸出 `檔名:0`，整體離開碼為 1，屬正常）。

- [ ] **Step 5: 語法檢查與後端回歸**

Run:
```bash
node --check public/app.js && npm test
```
Expected: `node --check` 無輸出；`tests 40 / pass 40 / fail 0`。

- [ ] **Step 6: 手動驗證錄音與暫停**

Run: `npm start`，瀏覽器開 http://localhost:3000

Expected：
- 填入標題後按麥克風 → 切到錄音頁，最上方顯示剛才的標題；標題留空時該行不佔位。
- 中央是漸層方塊，緩慢旋轉（3 秒一圈）；滑鼠停留顯示 tooltip「停止並分析」。
- 計時器每秒跳動且比待機時明顯。
- **對麥克風說話時 48 根長條隨音量高低起伏；安靜時降到低點**（不是隨機亂跳）。
- 按 `Pause` → 方塊停止旋轉、計時器停住、長條凍結在最後高度、按鈕字變 `Resume`；`Restart` 位置不動、兩者間距維持 20px。
- 按 `Resume` → 三者全部恢復，按鈕字變回 `Pause`。
- 暫停狀態下點中央方塊 → 可直接進入處理中（舊版處理頁樣式，正常）。
- 按 `Restart` → 跳確認對話框，確認後回到待機頁。

驗證完 Ctrl+C 停掉伺服器。

- [ ] **Step 7: Commit**

```bash
git add public/index.html public/app.js
git commit -m "feat: 錄音／暫停頁重做，48 根長條改由真實音量驅動"
```

---

## Task 3: 處理中頁、完成頁與錯誤區塊

**Files:**
- Modify: `public/index.html`（`view-processing`、`view-done` 區塊）
- Modify: `public/app.js`（移除 `setStep`、`renderDone` 配合新標記調整；`sendForProcessing` 維持使用 `fetch`，不改）

**Interfaces:**
- Consumes: Task 1 的 CSS 類別 `.ring`、`.proc-stage`、`.done-title`、`.linkbtn`、`.linkbtn.is-file`、`#preview`。
- Produces: 新元素 `#done-title`、`#proc-stage`；`#preview` 作為永遠展開、固定高 400px 的摘要區；移除 `setStep(id, state)`——處理中頁文字改為 HTML 中的固定字串，不需要對應的 JS 函式。

- [ ] **Step 1: 替換 `view-processing` 的標記**

```html
    <section id="view-processing" class="panel hidden">
      <div class="ring" aria-hidden="true"></div>
      <div id="proc-stage" class="proc-stage" role="status" aria-live="polite"></div>
    </section>
```

> 三行打勾清單改為單行；`role="status"` + `aria-live="polite"` 讓螢幕報讀器在階段變更時朗讀。

- [ ] **Step 2: 替換 `view-done` 的標記**

```html
    <section id="view-done" class="panel hidden">
      <div id="done-title" class="done-title"></div>
      <div id="preview"></div>
      <a class="linkbtn" id="result-link" href="#" target="_blank" rel="noopener"></a>
      <button id="btn-new" class="linkbtn">New AI Note</button>
    </section>
```

- [ ] **Step 3: 刪除 `setStep`，處理中頁不需要任何 JS 函式**

把 `setStep()` 整個函式刪除。處理中頁的文字已在 Step 1 的標記中直接寫死為 `Analyzing with Gemini…`，不做階段性變化，因此不需要任何對應的 JS 函式來設定或切換它。

- [ ] **Step 4: `sendForProcessing()` 維持使用 `fetch`（不改動邏輯，僅確認與新標記相容）**

`sendForProcessing()` 維持原樣，不需要改寫成 XHR——處理中頁已定為單行固定文字、不做階段性變化，取不到「上傳完成」訊號的顧慮因此不成立。函式內容如下（與現行 `public/app.js` 逐字相同，僅供比對，不需要改動）：

```js
async function sendForProcessing() {
  show('processing');
  const fd = new FormData();
  fd.set('title', $('title').value || '');
  fd.set('audio', lastBlob, 'recording.webm');
  try {
    const res = await fetch('/api/process', { method: 'POST', body: fd });
    const body = await res.json();
    if (!body.ok) throw new Error(body.message || '處理失敗');
    renderDone(body);
  } catch (e) {
    showError(`處理失敗：${e.message}`, true);
  }
}
```

> `async function` 本身即回傳 Promise，`mediaRecorder.onstop` 內既有的 `await sendForProcessing()` 維持有效。
> 失敗時仍走 `showError(msg, true)`，保留 `lastBlob` 供「用同一段錄音重試」。

- [ ] **Step 5: 改寫 `app.js` 的 `renderDone`**

把 `renderDone()` 整個函式替換成：

```js
function renderDone(body) {
  $('done-title').textContent = body.title || '';
  const link = $('result-link');
  if (body.destination.type === 'notion') {
    link.textContent = '開啟 Notion 記錄';
    link.href = body.destination.url;
    link.classList.remove('is-file');
  } else {
    link.textContent = `已存成桌面檔案：${body.destination.filePath}`;
    link.removeAttribute('href');
    link.classList.add('is-file');
  }
  const points = body.keyPoints.map((p) => `<li>${esc(p)}</li>`).join('');
  $('preview').innerHTML = `<b>【摘要】</b><br>${esc(body.summary)}<br><br><b>【重點】</b><ul>${points}</ul><small>（完整逐字稿已另存）</small>`;
  show('done');
}
```

> `body.title` 由後端 `processMeeting()` 回傳（使用者填的標題，或 Gemini 建議的標題，或日期）——比讀取輸入框可靠。`.md` 分支移除 `href`，讓它不可點擊。

- [ ] **Step 6: 語法檢查與後端回歸**

Run:
```bash
node --check public/app.js && npm test
```
Expected: `node --check` 無輸出；`tests 40 / pass 40 / fail 0`。

- [ ] **Step 7: 手動驗證處理中與完成頁**

Run: `npm start`，錄一段 10 秒左右的話並停止。

Expected：
- 處理中：脈動漸層圓環距內容區頂端 80px、下方 20px 處為置中的固定文字 `Analyzing with Gemini…`。
- 完成：會議標題（18px）→ 灰底摘要區（固定 400px 高、距視窗左右各 40px、內容超出時自身捲動）→ 文字樣式的「開啟 Notion 記錄」（未設定 Notion 時改顯示 `.md` 檔路徑且不可點）→「New AI Note」。
- 完成頁不應出現勾勾圖示、也沒有「查看摘要」摺疊。
- 按「New AI Note」回待機頁，標題輸入已清空。
- 深色模式下四個狀態都可讀。

- [ ] **Step 8: 驗證錯誤區塊樣式**

暫時把 `.env` 的 `GEMINI_API_KEY` 改成無效值（例如結尾多加一個字元），重啟伺服器，錄 3 秒後停止。

Expected: 紅色淡底圓角卡片顯示「處理失敗：…」，下方出現「↻ 用同一段錄音重試」，畫面回到待機頁但保留可重試狀態。

驗證完**把 `.env` 改回原本的正確 key**，Ctrl+C 停掉伺服器。

- [ ] **Step 9: Commit**

```bash
git add public/index.html public/app.js
git commit -m "feat: 處理中頁、完成頁（摘要常駐展開）與錯誤區塊視覺重做"
```

---

## Task 4: 端到端驗收

**Files:**
- 無檔案改動（純驗收；若發現缺失則回到對應任務修正）

**Interfaces:**
- Consumes: Task 1–3 的全部成果。
- Produces: 驗收結論。

- [ ] **Step 1: 確認工作區乾淨、後端全綠**

Run:
```bash
cd "$(git rev-parse --show-toplevel)" && git status --short && npm test
```
Expected: `git status --short` 無輸出；`tests 40 / pass 40 / fail 0`。

- [ ] **Step 2: 確認沒有引入新依賴**

Run:
```bash
git diff fedc8e3 --stat -- package.json package-lock.json src test scripts README.md
```
Expected: 無輸出（這些檔案在本次重做中完全沒動）。

- [ ] **Step 3: 以正式 App 視窗做端到端驗收**

先確認 `.env` 的 key 正確、埠 3000 沒有殘留伺服器（`lsof -ti:3000` 應為空）。

Run: `bash scripts/build-app.sh`，然後於 Finder 雙擊 `Browser AI Note.app`。

逐項確認：
- [ ] 480×720 獨立小窗，無橫向捲軸，內容垂直置中。
- [ ] 待機 → 錄音 → 處理中 → 完成 → 「New AI Note」回待機，四狀態切換正確。
- [ ] 說話時長條隨音量起伏。
- [ ] `Pause` → 方塊停轉、計時器停、長條凍結、字變 `Resume`；`Resume` 後全部恢復。
- [ ] `Pause` 與 `Restart` 的間距、visualizer 與 `Pause` 的間距，目視皆為 20px（可用 DevTools 量測確認）。
- [ ] `Restart` 跳出自訂對話框；Cancel 與 Esc 都不丟棄錄音，Restart 才歸零回待機。
- [ ] 完成後 Notion 資料庫確實新增一列（或桌面出現 `.md` 檔），內容正確。
- [ ] 用一場較長的會議驗證：摘要區固定 400px 高、內容超出時自身出現捲軸，下方「開啟 Notion 記錄」與「New AI Note」仍在畫面內。
- [ ] 麥克風權限拒絕時顯示繁中錯誤訊息。
- [ ] 深色與淺色模式各檢視四狀態一次。
- [ ] 關閉視窗後 `lsof -ti:3000` 回傳空（無殘留程序）。

- [ ] **Step 4: 驗收結論**

全部通過則本計畫完成。若任一項失敗，回到對應任務修正後重跑該任務的驗證步驟，再重跑本任務。

---

## 自我檢查（Self-Review）結果

**1. Spec 覆蓋**

| Spec 要求 | 對應 |
|---|---|
| 純 CSS 移植、零新依賴 | Global Constraints；Task 4 Step 2 驗證 |
| 黑白極簡 + 橘粉漸層點綴 | Task 1 Step 1（CSS 變數與三處漸層用途） |
| 跟隨系統明暗 | Task 1 Step 1 的 `prefers-color-scheme`；Task 1 Step 6、Task 3 Step 7、Task 4 Step 3 驗證 |
| 垂直節奏 32/8/8/20/20 | Task 1 Step 1 的 margin 設定；Task 4 Step 3 量測 |
| 待機頁（無框標題輸入、mic、00:00、靜態長條、Click to speak） | Task 1 Step 2 |
| 錄音頁（旋轉方塊＝停止、Pause、Restart） | Task 2 Step 1 |
| 暫停態（停轉、凍結、Resume 就地取代） | Task 2 Step 2；Task 2 Step 6 驗證 |
| 處理中（脈動環＋單行固定文字） | Task 3 Step 1、Step 3 |
| 完成頁（標題、主按鈕、摘要常駐固定 400px、可捲動） | Task 3 Step 2、Step 5 |
| 真實音量驅動 48 長條，20%–100% | Task 2 Step 2 |
| 移除 `rec-label` 並同步刪 JS 寫入 | Task 2 Step 1、Step 2；Step 4 以 grep 驗證 |
| 新增 `rec-title`、`done-title` | Task 2 Step 3、Task 3 Step 5 |
| 按鈕英文、長句繁中 | Task 2 Step 1、Task 3 Step 1–2 的標記文案 |
| 元素 id 沿用 | Task 1–3 標記中所有既有 id 原樣保留 |
| `<canvas id="wave">` → `<div id="wave">` | Task 2 Step 1 |
| tooltip 用 `title` 屬性 | Task 2 Step 1 |
| 漸層寫成 CSS 變數 | Task 1 Step 1 |
| 保留既有行為（權限訊息、重試、`/shutdown`、兩種輸出、`esc()`、確認框） | 這些程式碼在三個任務中皆未被替換；Task 2 Step 6、Task 3 Step 7–8、Task 4 Step 3 逐項驗證 |
| `npm test` 維持 40 全綠 | Task 1 Step 5、Task 2 Step 5、Task 3 Step 6、Task 4 Step 1 |
| 手動測試清單 | Task 4 Step 3 |

**2. Placeholder 掃描**：無 TBD / TODO / 「類似 Task N」/ 只描述不給程式碼的步驟。每個程式步驟都附完整可貼上的內容；漸層 hex 為實際取樣值，非佔位。

**3. 型別與命名一致性**
- `BARS`（Task 1 Step 3 定義）僅用於填充迴圈；`drawWave()`（Task 2）改用 `bars.length`，不依賴該常數，無不一致。
- 舊的 `setStep` 已於 Task 3 Step 3 完全移除；處理中頁文字改為 HTML 中的固定字串 `Analyzing with Gemini…`，不需要對應的 JS 函式。`sendForProcessing()`（Task 3 Step 4）維持使用 `fetch`，與 Global Constraints 一致。
- CSS 類別名稱在 Task 1 定義、Task 2–3 使用，逐一比對一致（`.linkbtn--danger`、`.linkbtn.is-file`、`.paused`）。
- `#wave` 在 Task 1 仍是舊 canvas、Task 2 才變成 `.wave` 容器；Task 1 的填充迴圈以 `.wave` 選取，不會誤觸 canvas，順序安全。
