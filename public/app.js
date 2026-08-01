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
    stopWave();
    $('btn-pause').textContent = '▶ 繼續';
    $('rec-label').textContent = '已暫停';
  } else if (mediaRecorder.state === 'paused') {
    mediaRecorder.resume();
    startTimer();
    drawWave();
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

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function renderDone(body) {
  const link = $('result-link');
  if (body.destination.type === 'notion') {
    link.textContent = '📄 已寫入 Notion → 開啟會議記錄';
    link.href = body.destination.url;
  } else {
    link.textContent = `📄 已存成桌面檔案：${body.destination.filePath}`;
    link.href = '#';
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

$('btn-start').onclick = () => { clearError(); startRecording(); };
$('btn-pause').onclick = togglePause;
$('btn-stop').onclick = stopAndAnalyze;
$('btn-restart').onclick = restartRecording;
$('btn-new').onclick = () => { clearError(); lastBlob = null; $('title').value = ''; show('idle'); };
$('btn-retry').onclick = () => { if (lastBlob) { clearError(); sendForProcessing(); } };

// 視窗關閉時通知伺服器結束（配合啟動器達成「關窗即結束」）。
// 註：在 App 視窗模式下，離開頁面幾乎只會發生於關窗；重新整理雖也會觸發，但 App 模式極少手動重整。
window.addEventListener('pagehide', () => {
  try { navigator.sendBeacon('/shutdown'); } catch { /* 忽略 */ }
});

show('idle');
