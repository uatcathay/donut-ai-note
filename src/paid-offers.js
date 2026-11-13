import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { RECORDINGS_DIR } from './recordings.js';

// 免費版放棄之後，那段錄音旁邊要一直掛著「付費分析」，直到成功或被刪掉為止——
// 這是「不急的錄音慢慢等」與「現在就花錢」之間的選擇，伺服器重啟不該替使用者做掉。
// 所以不能像 completed.js 只放記憶體。跟錄音放在同一個目錄，
// 檔名以點開頭，不符合錄音檔名的格式，清單自然不會把它當成錄音。
const FILE_NAME = '.paid-offers.json';

export async function readOffers(dir = RECORDINGS_DIR) {
  try {
    return JSON.parse(await readFile(path.join(dir, FILE_NAME), 'utf8'));
  } catch {
    return {};   // 沒有檔案或檔案壞了：少一顆按鈕，總比整個清單出不來好
  }
}

async function writeOffers(offers, dir) {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, FILE_NAME), JSON.stringify(offers, null, 2));
}

export async function noteOffer(id, offer, dir = RECORDINGS_DIR) {
  const offers = await readOffers(dir);
  await writeOffers({ ...offers, [id]: offer }, dir);
}

export async function clearOffer(id, dir = RECORDINGS_DIR) {
  const offers = await readOffers(dir);
  if (!(id in offers)) return;
  const { [id]: _removed, ...rest } = offers;
  await writeOffers(rest, dir);
}
