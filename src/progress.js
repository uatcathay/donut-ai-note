// 分析是一次很長的請求，而前端只看得到一個轉圈——「正在第 2 次重試」與
// 「已經死了」在畫面上長得一模一樣。伺服器把當下在做什麼記下來，前端才問得到。
//
// 單一使用者的本機工具，同時間只會有一次分析，所以用模組層級的單一狀態即可。
let current = null;

export function startAnalysis(now = Date.now()) {
  current = { startedAt: now, stage: 'upload', retry: null };
}

export function setStage(stage) {
  if (!current) return;
  current.stage = stage;
  current.retry = null;   // 重試狀態屬於上一個階段，換階段就作廢
}

export function noteRetry(reason, attempt, total) {
  if (!current) return;
  current.retry = { reason, attempt, total };
}

export function endAnalysis() {
  current = null;
}

export function getProgress(now = Date.now()) {
  if (!current) return { active: false };
  return {
    active: true,
    stage: current.stage,
    elapsedMs: now - current.startedAt,
    retry: current.retry,
  };
}
