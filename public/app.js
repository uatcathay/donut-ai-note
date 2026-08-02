const $ = (id) => document.getElementById(id);
const views = ['idle', 'recording', 'processing', 'done'];
const BARS = 48;
for (const el of document.querySelectorAll('.wave')) {
  el.innerHTML = '<span class="bar"></span>'.repeat(BARS);
}
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
  $('rec-title').classList.toggle('is-empty', !t);   // visibility:hidden 保留槽位，避免版面上移
  $('btn-pause').textContent = 'Pause';
  $('view-recording').classList.remove('paused');
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

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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

// 標題輸入：隨行數自動長高，上限兩行（再多則於欄位內捲動）。
// 錄音頁與完成頁對應為 -webkit-line-clamp: 2，兩邊上限一致，長標題才不會推動下方版面。
const TITLE_MAX_LINES = 2;
function autoGrowTitle() {
  const el = $('title');
  el.style.height = 'auto';
  const line = parseFloat(getComputedStyle(el).lineHeight);
  const max = line * TITLE_MAX_LINES + 13;   // padding 12 + 底線 1
  el.style.height = `${Math.min(el.scrollHeight + 1, max)}px`;
}
$('title').addEventListener('input', autoGrowTitle);
// 會議標題不需要換行，Enter 不插入換行
$('title').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
autoGrowTitle();

$('btn-start').onclick = () => { clearError(); startRecording(); };
$('btn-pause').onclick = togglePause;
$('btn-stop').onclick = stopAndAnalyze;
$('btn-restart').onclick = restartRecording;
$('btn-cancel-restart').onclick = () => $('confirm-restart').close();
$('btn-confirm-restart').onclick = () => { $('confirm-restart').close(); discardRecording(); };
$('btn-new').onclick = () => { clearError(); lastBlob = null; $('title').value = ''; autoGrowTitle(); show('idle'); };
$('btn-retry').onclick = () => { if (lastBlob) { clearError(); sendForProcessing(); } };

// 視窗關閉時通知伺服器結束（配合啟動器達成「關窗即結束」）。
// 註：在 App 視窗模式下，離開頁面幾乎只會發生於關窗；重新整理雖也會觸發，但 App 模式極少手動重整。
window.addEventListener('pagehide', () => {
  try { navigator.sendBeacon('/shutdown'); } catch { /* 忽略 */ }
});

show('idle');
