// 沒有任何 API 查得到「現在還剩多少額度」，唯一的信號是曾經撞到 429。
// 所以這裡存的是推論而不是事實，必須會自己過期——否則額度早就恢復了，
// 畫面還在叫人別錄。任何一次分析成功也會清掉它（見 clearQuota 的呼叫端）。
//
// 探測一次再判斷是行不通的：擋住我們的是 token 量不是請求次數，
// 一個「回一個字」的探測會通過，同一時間 9MB 的錄音照樣被拒。
let exhaustedUntil = null;

export function noteQuotaExhausted(resetAt) {
  exhaustedUntil = resetAt;
}

export function clearQuota() {
  exhaustedUntil = null;
}

export function isQuotaExhausted(now = new Date()) {
  if (!exhaustedUntil) return false;
  if (now >= exhaustedUntil) {
    exhaustedUntil = null;
    return false;
  }
  return true;
}
