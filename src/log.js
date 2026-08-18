// log 沒有時間戳記時，只知道「發生過什麼」、不知道「何時發生」——
// 排查時無法判斷失敗與伺服器重啟的先後，也無從得知失敗集中在哪些時段。
// 用本地時間而非 UTC：這是本機工具，看的人就在這個時區。
const pad = (n) => String(n).padStart(2, '0');

export function stamped(message, now = new Date()) {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return `[${date} ${time}] ${message}`;
}

export function log(message) {
  console.log(stamped(message));
}

export function warn(message) {
  console.warn(stamped(message));
}
