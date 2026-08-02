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

// 頻譜的 1024 個格子涵蓋 0 – 取樣率/2（通常是 24kHz），但人聲能量幾乎全在 4kHz 以下。
// 線性切成 48 段的話，後面四十根長條對應的是幾乎沒有訊號的高頻，看起來像壞掉。
// 改用對數頻段：低頻分到較多長條、高頻壓縮，48 根都落在有內容的範圍內。
const WAVE_MIN_HZ = 60;
const WAVE_MAX_HZ = 6000;
const WAVE_GAMMA = 1.4;        // >1 拉開強弱對比；調大更戲劇化，調回 1 即為線性
const WAVE_PEAK_DECAY = 0.93;  // 峰值追隨器每幀的衰減率，越小則基準回落越快
const WAVE_SPEECH_SPAN = 8;    // 超出死區多少（0–255）即視為滿強度；調大則更不敏感
const WAVE_NOISE_DEV_K = 4;    // 死區＝底噪平均 + 波動幅度 × 此倍數；調大則更不容易被底噪觸發
const WAVE_NOISE_ADAPT = 0.02; // 底噪統計的適應速率

function bandEdges(binCount, nyquist, bands) {
  return Array.from({ length: bands + 1 }, (_, i) => {
    const hz = WAVE_MIN_HZ * (WAVE_MAX_HZ / WAVE_MIN_HZ) ** (i / bands);
    return Math.min(binCount - 1, Math.round((hz / nyquist) * binCount));
  });
}

// 以 ?debug=1 開啟：在左上角即時顯示波形判定用的數值，用來調校靜音死區。
const WAVE_DEBUG = new URLSearchParams(location.search).has('debug');
let dbgEl = null;
if (WAVE_DEBUG) {
  dbgEl = document.createElement('pre');
  dbgEl.style.cssText = 'position:fixed;left:8px;top:8px;margin:0;padding:6px 8px;'
    + 'background:rgba(0,0,0,.8);color:#4ade80;font:11px ui-monospace,Menlo,monospace;'
    + 'line-height:1.5;z-index:9999;white-space:pre;border-radius:6px;';
  document.body.appendChild(dbgEl);
}

function drawWave() {
  const bars = document.querySelectorAll('#wave .bar');
  const data = new Uint8Array(analyser.frequencyBinCount);
  const edges = bandEdges(data.length, audioCtx.sampleRate / 2, bars.length);
  const levels = new Float32Array(bars.length);
  let peak = 0;
  let noiseMean = null;   // 底噪的平均值，由第一幀起自動校準
  let noiseDev = 3;       // 底噪自身的波動幅度
  let frame = 0;
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
    // 死區取「底噪平均 + 波動幅度 × 4」：底噪本身持續在平均值上下起伏，
    // 只扣掉平均並不夠，必須連它的波動一起讓過，安靜時整排才會真正靜止。
    if (noiseMean === null) noiseMean = frameMean;
    const deadzone = noiseMean + noiseDev * WAVE_NOISE_DEV_K;
    const strength = Math.min(1, Math.max(0, (frameMean - deadzone) / WAVE_SPEECH_SPAN));
    // 只在判定為安靜時更新底噪統計，否則說話聲會把底噪一起拉高
    if (strength < 0.5) {
      const d = frameMean - noiseMean;
      noiseMean += d * WAVE_NOISE_ADAPT;
      noiseDev += (Math.abs(d) - noiseDev) * WAVE_NOISE_ADAPT;
    }

    // 逐幀正規化：以當下的峰值為基準，講話大聲小聲都能撐滿整排。
    // 用會衰減的峰值追隨器而非直接取當幀最大值——後者會讓整排每幀劇烈重新縮放。
    peak = Math.max(frameMax, peak * WAVE_PEAK_DECAY);

    if (dbgEl && frame % 6 === 0) {
      dbgEl.textContent =
        `frameMean ${frameMean.toFixed(1).padStart(6)}   frameMax ${frameMax.toFixed(1).padStart(6)}\n` +
        `noiseMean ${noiseMean.toFixed(1).padStart(6)}   noiseDev ${noiseDev.toFixed(2).padStart(6)}\n` +
        `deadzone  ${deadzone.toFixed(1).padStart(6)}   peak     ${peak.toFixed(1).padStart(6)}\n` +
        `strength  ${strength.toFixed(2).padStart(6)}`;
    }
    frame += 1;

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
  $('rec-title').classList.toggle('is-empty', !t);   // visibility:hidden 保留槽位，避免版面上移
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
