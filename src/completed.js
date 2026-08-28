// 分析成功之後，錄音檔就被刪掉了——「這筆完成了」這件事沒有任何檔案可以代表它，
// 得另外記著，清單才有東西可以顯示。
//
// 只放在記憶體，不寫檔：這一列是通知不是資料，看完（返回）或按「移除」就拿掉，
// 本來就短命。筆記的永久位置是 Notion 或桌面的 .md，伺服器重開只是少了提醒。
let entries = [];

export function noteCompleted(id, result) {
  entries = entries.filter((e) => e.id !== id);   // 重試成功時不要留下兩列
  entries.unshift({ id, title: result.title, result });
}

export function listCompleted() {
  return entries.map(({ id, title }) => ({ id, title }));
}

export function takeCompleted(id) {
  return entries.find((e) => e.id === id)?.result ?? null;
}

export function removeCompleted(id) {
  const before = entries.length;
  entries = entries.filter((e) => e.id !== id);
  return entries.length < before;
}

export function clearCompleted() {
  entries = [];
}
