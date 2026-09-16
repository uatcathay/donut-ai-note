const $ = (id) => document.getElementById(id);
const views = ['idle', 'recording', 'processing', 'done'];
// 切換狀態後把焦點移到該頁的主要控制項，否則被按下的按鈕隨即被隱藏、
// 焦點掉回 <body>，鍵盤使用者每次都要重新 Tab。
// 待機頁指向標題欄位而非麥克風按鈕：頁面載入與 New AI Note 之後，自然的下一步都是輸入標題。
const FOCUS_TARGET = { idle: 'title', recording: 'btn-stop', processing: 'btn-leave', done: 'btn-new' };
const BARS = 48;
for (const el of document.querySelectorAll('.wave')) {
  el.innerHTML = '<span class="bar"></span>'.repeat(BARS);
}
let currentView = 'idle';

function show(view) {
  currentView = view;
  for (const v of views) $(`view-${v}`).classList.toggle('hidden', v !== view);
  // 分析清單只出現在待機頁：錄音頁與摘要頁都是專心做一件事的地方，列一串在下面只是干擾
  refreshJobsVisibility();
  const focusId = FOCUS_TARGET[view];
  if (focusId) $(focusId).focus();
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

// 頻譜的 1024 個格子涵蓋 0 – 取樣率/2（通常是 24kHz），但人聲能量幾乎全在 4kHz 以下。
// 線性切成 48 段的話，後面四十根長條對應的是幾乎沒有訊號的高頻，看起來像壞掉。
// 改用對數頻段：低頻分到較多長條、高頻壓縮，48 根都落在有內容的範圍內。
const WAVE_MIN_HZ = 60;
const WAVE_MAX_HZ = 6000;
const WAVE_GAMMA = 1.4;        // >1 拉開強弱對比；調大更戲劇化，調回 1 即為線性
const WAVE_PEAK_DECAY = 0.93;  // 峰值追隨器每幀的衰減率，越小則基準回落越快（以 60fps 計；120Hz 螢幕上會減半）
const WAVE_SPEECH_SPAN = 20;   // 超出死區多少（0–255）即視為滿強度；調大則更不敏感
const WAVE_NOISE_BLOCK = 300;  // 底噪視窗的區塊長度（幀）；實際視窗為 5–10 秒（以 60fps 計；120Hz 螢幕上會減半）
const WAVE_NOISE_MULT = 1.8;   // 死區＝底噪 × 此倍數 + 下方常數
const WAVE_NOISE_ADD = 6;
const WAVE_NOISE_MIN = 15;     // 死區的絕對下限，避免極安靜的環境把死區壓到 0

function bandEdges(binCount, nyquist, bands) {
  return Array.from({ length: bands + 1 }, (_, i) => {
    const hz = WAVE_MIN_HZ * (WAVE_MAX_HZ / WAVE_MIN_HZ) ** (i / bands);
    return Math.min(binCount - 1, Math.round((hz / nyquist) * binCount));
  });
}

function drawWave() {
  const bars = document.querySelectorAll('#wave .bar');
  const data = new Uint8Array(analyser.frequencyBinCount);
  const edges = bandEdges(data.length, audioCtx.sampleRate / 2, bars.length);
  const levels = new Float32Array(bars.length);
  let peak = 0;
  let prevBlockMin = Infinity;   // 上一個區塊的最低平均音量
  let blockMin = Infinity;       // 目前區塊的最低平均音量
  let blockFrames = 0;
  const render = () => {
    rafId = requestAnimationFrame(render);
    analyser.getByteFrequencyData(data);
    let frameMax = 0;
    let frameSum = 0;
    for (let i = 0; i < bars.length; i++) {
      const from = edges[i];
      const to = Math.max(from + 1, edges[i + 1]);   // 低頻的相鄰邊界可能重疊，至少取一格
      let sum = 0;
      for (let j = from; j < to; j++) sum += data[j];
      levels[i] = sum / (to - from);            // 0–255
      frameSum += levels[i];
      if (levels[i] > frameMax) frameMax = levels[i];
    }
    const frameMean = frameSum / bars.length;

    // 靜音判定：拿整排的「平均值」跟底噪比，而不是最大值——單一頻格的雜訊尖峰
    // 會讓最大值劇烈跳動，平均則穩定得多。
    //
    // 底噪估計＝最近約 5–10 秒的最低平均音量（兩個區塊的滑動視窗最小值）。
    // 為什麼是最小值而不是移動平均：移動平均會被說話聲拉高，而一旦拉高就形成
    // 正回饋死鎖——死區跟著升高、更多語音被當成底噪、最終整排在說話中途凍住。
    // 需要一個區塊內至少出現一次字詞間隙——語音通常滿足。若是持續不斷的聲音
    // （朗讀、外放音樂），底噪會暫時鎖到該位準、整排凍住，但下一次停頓即自行
    // 恢復，不像移動平均版是永久死鎖。房間變吵時則會在一個視窗內自動適應。
    blockMin = Math.min(blockMin, frameMean);
    if (++blockFrames >= WAVE_NOISE_BLOCK) {
      prevBlockMin = blockMin;
      blockMin = Infinity;
      blockFrames = 0;
    }
    const noiseFloor = Math.min(prevBlockMin, blockMin);
    const deadzone = Math.max(WAVE_NOISE_MIN, noiseFloor * WAVE_NOISE_MULT + WAVE_NOISE_ADD);
    const strength = Math.min(1, Math.max(0, (frameMean - deadzone) / WAVE_SPEECH_SPAN));

    // 逐幀正規化：以當下的峰值為基準，講話大聲小聲都能撐滿整排。
    // 用會衰減的峰值追隨器而非直接取當幀最大值——後者會讓整排每幀劇烈重新縮放。
    peak = Math.max(frameMax, peak * WAVE_PEAK_DECAY);

    for (let i = 0; i < bars.length; i++) {
      const norm = peak > 0 ? levels[i] / peak : 0;
      const level = strength * norm ** WAVE_GAMMA;
      bars[i].style.transform = `scaleY(${0.12 + level * 0.88})`;  // 12%–100%
    }
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
  const t = $('title').value.trim();
  $('rec-title').textContent = t;
  $('rec-title').classList.toggle('is-empty', !t);   // 槽位由 min-height 保證；.is-empty 是日後為此元素加上背景或底線時的保險
  $('btn-pause').textContent = 'Pause';
  $('view-recording').classList.remove('paused');
  mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  mediaRecorder.start();
  audioCtx = new AudioContext();
  analyser = audioCtx.createAnalyser();
  // 預設值會讓整排長條看起來一樣高：0.8 的時間平滑把每幀抹平，
  // 而 -100 ~ -30dB 的預設視窗讓一般說話全擠在中段。收窄視窗並降低平滑以拉開起伏。
  analyser.smoothingTimeConstant = 0.6;
  analyser.minDecibels = -85;
  analyser.maxDecibels = -25;
  audioCtx.createMediaStreamSource(stream).connect(analyser);
  drawWave();
  startTimer();
  show('recording');
  warnIfQuotaExhausted();   // 刻意不 await：查詢慢或失敗都不該影響已經在跑的錄音
}

// 額度用盡只有分析失敗過才知道，所以這是推論而非事實——
// 因此只提醒、不阻止：錄音不需要 Gemini，而且失敗的錄音本來就會保留。
async function warnIfQuotaExhausted() {
  try {
    const q = await (await fetch('/api/quota')).json();
    if (!q.exhausted) return;
    $('quota-reset').textContent = q.resetLabel;
    $('quota-notice').showModal();
  } catch {
    // 查不到就算了，這只是提醒
  }
}

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

function cleanupStream() {
  stopTimer();
  stopWave();
  if (stream) stream.getTracks().forEach((t) => t.stop());
  if (audioCtx) audioCtx.close();
  stream = null; audioCtx = null; analyser = null;
}

function restartRecording() {
  $('confirm-restart').showModal();
}

function discardRecording() {
  try { if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop(); } catch {}
  cleanupStream();
  mediaRecorder = null;
  chunks = [];
  show('idle');
}

function stopAndAnalyze() {
  if (!mediaRecorder) return;
  mediaRecorder.onstop = async () => {
    cleanupStream();
    mediaRecorder = null;
    lastBlob = new Blob(chunks, { type: 'audio/webm' });
    await sendForProcessing();
  };
  mediaRecorder.stop();
}

// fetch 連不上時瀏覽器只給「Failed to fetch」，看不出是誰的問題。
// 這種情況幾乎都是本機伺服器在請求進行中被重啟或停掉——錄音早已落地，重試即可。
function describeClientFailure(e) {
  if (e instanceof TypeError && /fetch/i.test(e.message || '')) {
    return '與本機伺服器的連線中斷（伺服器可能剛重新啟動）。錄音已保留，請再試一次。';
  }
  return e.message;
}

// 分析可能跑好幾分鐘，而畫面上只有一個轉圈。伺服器知道自己在上傳、在分析、
// 還是在重試——問出來顯示給使用者看，等待才不會被誤認成當機。
const STAGE_TEXT = { upload: '上傳音檔', analyze: '分析錄音', write: '寫入筆記' };
const RETRY_TEXT = { busy: 'Gemini 忙線中', timeout: 'Gemini 沒有回應' };

function formatElapsed(ms) {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// 分三行：一行塞滿階段、耗時、重試原因與次數，掃一眼抓不到重點
function describeProgress(p) {
  if (!p || !p.active) return { lines: [], retrying: false };
  const lines = [`${STAGE_TEXT[p.stage] || p.stage}中（已等 ${formatElapsed(p.elapsedMs)}）`];
  if (!p.retry) return { lines, retrying: false };
  lines.push(RETRY_TEXT[p.retry.reason] || '暫時性錯誤');
  lines.push(`第 ${p.retry.attempt}/${p.retry.total} 次重試`);
  return { lines, retrying: true };
}

let jobsTimer = null;
let jobCount = 0;

// 清單只在待機頁露出。其他頁都在專心做一件事：錄音、看它跑、讀摘要。
function refreshJobsVisibility() {
  $('jobs').classList.toggle('hidden', currentView !== 'idle' || jobCount === 0);
}

// 只在清單上有東西時才輪詢：清單空了就沒有任何會自己變動的狀態，
// 使用者的動作（停止錄音、立即分析、移除）本來就會各自觸發一次刷新。
function scheduleJobsPolling(hasJobs) {
  if (hasJobs && !jobsTimer) jobsTimer = setInterval(refreshJobs, 2000);
  if (!hasJobs && jobsTimer) { clearInterval(jobsTimer); jobsTimer = null; }
}

const fmtMB = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;

// 立即分析送出後、伺服器還沒把狀態換成「分析中」之前有個空窗，
// 那一列會短暫停在「待分析」，看起來像沒反應。先自己標成分析中撐過去。
const startingIds = new Set();

function jobMeta(job) {
  if (job.state === 'done') return '已完成';
  if (job.state === 'analyzing' || startingIds.has(job.id)) {
    const stage = STAGE_TEXT[job.stage] || '分析';
    const elapsed = job.elapsedMs == null ? '' : `（已等 ${formatElapsed(job.elapsedMs)}）`;
    return `${fmtMB(job.sizeBytes)} / ${stage}中${elapsed}`;
  }
  return `${fmtMB(job.sizeBytes)} / 待分析`;
}

function addLine(parent, text, className) {
  const div = document.createElement('div');
  if (className) div.className = className;
  div.textContent = text;
  parent.append(div);
}

function addAction(parent, text, onclick) {
  const b = document.createElement('button');
  b.textContent = text;
  b.onclick = onclick;
  parent.append(b);
}

async function refreshJobs() {
  const box = $('jobs');
  let items = [];
  try {
    items = (await (await fetch('/api/jobs')).json()).items || [];
  } catch { /* 清單拿不到不該影響錄音 */ }

  jobCount = items.length;
  scheduleJobsPolling(items.length > 0);
  refreshJobsVisibility();
  box.textContent = '';
  if (items.length === 0) return;

  const title = document.createElement('div');
  title.className = 'pending-title';
  title.textContent = `分析清單（${items.length}）`;
  box.append(title);

  for (const job of items) {
    const row = document.createElement('div');
    row.className = 'pending-item';

    const label = document.createElement('div');
    label.className = 'pending-label';
    addLine(label, job.state === 'done' ? job.title : job.label);
    addLine(label, jobMeta(job), 'job-meta');
    if (job.retry) {
      addLine(label, `${RETRY_TEXT[job.retry.reason] || '暫時性錯誤'}・`
        + `第 ${job.retry.attempt}/${job.retry.total} 次重試`, 'job-retry');
    }
    row.append(label);

    const actions = document.createElement('div');
    actions.className = 'pending-actions';
    if (job.state === 'analyzing') {
      addAction(actions, '查看進度', () => watchAnalysis(job.id));
    } else if (job.state === 'done') {
      addAction(actions, '查看摘要', () => openSummary(job.id));
      // 「移除」而不是「刪除」：這一列只是通知，Notion 上的筆記不受影響。
      // 待分析那列的「刪除」會永久丟掉錄音，兩者後果差很多，用詞必須分開。
      addAction(actions, '移除', () => removeJob(job.id));
    } else if (job.state === 'pending' && !startingIds.has(job.id)) {
      addAction(actions, '立即分析', () => analyzeNow(job.id));
      addAction(actions, '刪除', () => discardJob(job.id));
    }
    row.append(actions);
    box.append(row);
  }
}

async function analyzeNow(id) {
  startingIds.add(id);
  refreshJobs();
  try {
    const res = await fetch(`/api/pending/${encodeURIComponent(id)}/retry`, { method: 'POST' });
    const body = await res.json();
    if (!body.ok) showError(body.message || '無法開始分析');
  } catch (e) {
    showError(describeClientFailure(e));
  } finally {
    startingIds.delete(id);
    refreshJobs();
  }
}

async function discardJob(id) {
  await fetch(`/api/pending/${encodeURIComponent(id)}`, { method: 'DELETE' });
  refreshJobs();
}

async function removeJob(id) {
  await fetch(`/api/completed/${encodeURIComponent(id)}`, { method: 'DELETE' });
  refreshJobs();
}

// 「處理中」那頁是可以進出的：不急的時候留在這裡看它跑完，趕時間就按出口去錄下一場。
// 從清單上「分析中」那列點「查看進度」也回到這裡。
let watchingId = null;
let watchTimer = null;
let watchStartedAt = 0;
let sawAnalyzing = false;

function stopWatching() {
  clearInterval(watchTimer);
  watchTimer = null;
  watchingId = null;
  const el = $('proc-detail');
  el.textContent = '';
  el.classList.remove('is-retrying');
}

function renderProgressLines(p) {
  const { lines, retrying } = describeProgress(p);
  const el = $('proc-detail');
  el.textContent = '';
  for (const line of lines) addLine(el, line);
  el.classList.toggle('is-retrying', retrying);
}

// 分析結束的那一刻要分辨「成功」還是「失敗」：成功的那筆會出現在已完成，
// 失敗的則以待分析留在磁碟上。但「還沒開始跑」看起來也是待分析，
// 所以要先確認真的看過它在跑（或已等超過寬限時間）才敢判定失敗。
const WATCH_GRACE_MS = 5000;

async function watchTick() {
  const id = watchingId;
  if (!id) return;
  let p;
  try {
    p = await (await fetch('/api/progress')).json();
  } catch { return; }   // 查不到就下一輪再問，不要誤判成結束

  if (p.active && p.recordingId === id) {
    sawAnalyzing = true;
    renderProgressLines(p);
    return;
  }
  if (!sawAnalyzing && Date.now() - watchStartedAt < WATCH_GRACE_MS) return;

  let job;
  try {
    const items = (await (await fetch('/api/jobs')).json()).items || [];
    job = items.find((i) => i.id === id);
  } catch { return; }

  if (job?.state === 'done') {
    stopWatching();
    openSummary(id);   // 人就在這裡等它，直接把摘要顯示出來
    return;
  }
  if (job?.state === 'analyzing') return;   // 又被別的路徑接手了，繼續看
  stopWatching();
  // 失敗或那筆已被刪掉：回待機頁，清單上會有它（附上原因）等你按「立即分析」
  if (job) showError('分析未成功。錄音已保留在分析清單，可按「立即分析」重試。');
  else show('idle');
  refreshJobs();
}

function watchAnalysis(id) {
  clearError();
  watchingId = id;
  sawAnalyzing = false;
  watchStartedAt = Date.now();
  $('proc-detail').textContent = '';
  show('processing');
  clearInterval(watchTimer);
  watchTimer = setInterval(watchTick, 2000);
  watchTick();
}

// 看完就把那一列收掉——它的用途是「這個好了，去看一下」，看過就沒有存在的必要。
// 筆記的永久位置是 Notion 或桌面的 .md，這一列只是通知。
let viewingId = null;

async function openSummary(id) {
  try {
    const res = await fetch(`/api/completed/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error('找不到這份摘要');
    viewingId = id;
    renderDone(await res.json());
  } catch (e) {
    showError(describeClientFailure(e));
    refreshJobs();
  }
}

// 伺服器收下錄音就回應，分析自己在背景跑，所以這裡直接回待機頁——
// 分析一場長會議要好幾分鐘，而使用者往往正要開下一場。
async function sendForProcessing() {
  const fd = new FormData();
  fd.set('title', $('title').value || '');
  fd.set('audio', lastBlob, 'recording.webm');
  try {
    const res = await fetch('/api/process', { method: 'POST', body: fd });
    const body = await res.json();
    if (!body.ok) throw new Error(body.message || '上傳失敗');
    lastBlob = null;
    $('title').value = '';
    // 沒有真的開始分析（已有另一個在跑）就別去處理中那頁——
    // 那頁會顯示成正在跑，但其實那筆還在等你按「立即分析」
    if (body.started) watchAnalysis(body.id);
    else show('idle');
  } catch (e) {
    // 這裡的失敗是「錄音沒送到伺服器」，跟分析失敗不同——後者由清單那一列表達
    showError(`上傳失敗：${describeClientFailure(e)}`, { blobRetry: true });
  } finally {
    refreshJobs();
  }
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function renderDone(body) {
  $('done-title').textContent = body.title || '';
  // 寫入 Notion 時不顯示連結——使用者不會從這裡點進去看（Notion 網頁還要再登入一次）。
  // 但輸出成 .md 時仍要顯示路徑，否則使用者不知道檔案在哪。
  const link = $('result-link');
  const isFile = body.destination.type !== 'notion';
  link.classList.toggle('hidden', !isFile);
  if (isFile) {
    link.textContent = `已存成桌面檔案：${body.destination.filePath}`;
    link.removeAttribute('href');
    link.classList.add('is-file');
  }
  const topics = body.topics.map((t) => `
    <h4 class="pv-topic">${esc(t.title)}</h4>
    <ul>${t.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`).join('');
  // 沒有待辦是常態，空標題只會讓人以為漏了東西
  const next = body.nextSteps.length === 0 ? '' : `
    <h3 class="pv-section">◻️ What's next?</h3>
    <ul class="pv-todo">${body.nextSteps.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`;
  // 逐字稿的去向跟著輸出目的地走：寫死「在 Notion」在沒設定 Notion 時會是錯的
  const where = isFile ? '在 .md 檔' : '在 Notion';
  // 待辦排在前面：打開筆記最先想知道的是「我還要做什麼」，回顧細節是其次
  $('preview').innerHTML = `${next}
    <h3 class="pv-section">📝 Mins</h3>${topics}
    <small class="pv-note">（完整逐字稿已另存${where}）</small>`;
  show('done');
}

// 這裡只剩「當下就知道失敗」的錯誤：麥克風權限、錄音送不出去。
// 分析失敗不走這裡——那時候使用者早就離開了，改由清單那一列表達。
// blobRetry：錄音還在記憶體裡，可以重傳一次。
function showError(msg, { blobRetry = false } = {}) {
  const err = $('err');
  err.textContent = msg;
  err.classList.remove('hidden');
  $('btn-retry').classList.toggle('hidden', !(blobRetry && lastBlob));
  show('idle');   // 回到可操作狀態
}

function clearError() {
  $('err').classList.add('hidden');
  $('btn-retry').classList.add('hidden');
}

// 複製摘要：取 innerText（而非 innerHTML）才會拿到人看得懂的純文字，
// 且 <li> 之間會保留換行。成功後短暫把圖示換成勾勾當作回饋。
let copiedTimer = null;
$('btn-copy').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('preview').innerText.trim());
    const btn = $('btn-copy');
    btn.classList.add('copied');
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => btn.classList.remove('copied'), 1500);
  } catch {
    showError('複製失敗，請手動選取摘要文字。');
  }
};

$('btn-start').onclick = () => { clearError(); startRecording(); };
$('btn-pause').onclick = togglePause;
$('btn-stop').onclick = stopAndAnalyze;
$('btn-restart').onclick = restartRecording;
$('btn-quota-ok').onclick = () => $('quota-notice').close();
$('btn-cancel-restart').onclick = () => $('confirm-restart').close();
$('btn-confirm-restart').onclick = () => { $('confirm-restart').close(); discardRecording(); };
// 出口：分析繼續在背景跑，那一列會留在清單上
$('btn-leave').onclick = () => { stopWatching(); show('idle'); refreshJobs(); };
// 看完了：把那一列收掉再回待機頁
$('btn-new').onclick = async () => {
  if (viewingId) await removeJob(viewingId);
  viewingId = null;
  clearError();
  show('idle');
};
$('btn-retry').onclick = () => { if (lastBlob) { clearError(); sendForProcessing(); } };

show('idle');
refreshJobs();   // 開啟視窗就看得到分析清單的現況
