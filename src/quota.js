// 沒有任何 API 查得到「現在還剩多少額度」，唯一的信號是曾經撞到 429。
// 所以這裡存的是推論而不是事實，必須會自己過期——否則額度早就恢復了，
// 畫面還在叫人別錄。任何一次分析成功也會清掉它（見 clearQuota 的呼叫端）。
//
// 也不能先探測一次再判斷：日額度算的是請求次數（429 的 quotaId 是
// GenerateRequestsPerDayPerProjectPerModel-FreeTier，上限 20），探測本身就會用掉一次。
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
