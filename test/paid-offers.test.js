import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readOffers, noteOffer, clearOffer } from '../src/paid-offers.js';

async function tempDir(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'donut-offers-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('沒有任何紀錄時回傳空物件（目錄還沒建立也一樣）', async (t) => {
  const dir = await tempDir(t);
  assert.deepEqual(await readOffers(path.join(dir, '不存在')), {});
});

test('記下的付費按鈕重新讀取時還在——伺服器重啟後不能消失', async (t) => {
  const dir = await tempDir(t);
  await noteOffer('a.webm', { reason: 'busy' }, dir);
  await noteOffer('b.webm', { reason: 'quota', resetAt: '2026-11-14T08:00:00.000Z' }, dir);
  assert.deepEqual(await readOffers(dir), {
    'a.webm': { reason: 'busy' },
    'b.webm': { reason: 'quota', resetAt: '2026-11-14T08:00:00.000Z' },
  });
});

test('同一段錄音再失敗時，以最新的原因為準', async (t) => {
  const dir = await tempDir(t);
  await noteOffer('a.webm', { reason: 'quota', resetAt: 'x' }, dir);
  await noteOffer('a.webm', { reason: 'paid' }, dir);
  assert.deepEqual(await readOffers(dir), { 'a.webm': { reason: 'paid' } });
});

test('分析成功或刪除後清掉，其他錄音的紀錄不受影響', async (t) => {
  const dir = await tempDir(t);
  await noteOffer('a.webm', { reason: 'busy' }, dir);
  await noteOffer('b.webm', { reason: 'busy' }, dir);
  await clearOffer('a.webm', dir);
  assert.deepEqual(await readOffers(dir), { 'b.webm': { reason: 'busy' } });
});

test('紀錄檔不會被當成錄音列進分析清單', async (t) => {
  const { listRecordings } = await import('../src/recordings.js');
  const dir = await tempDir(t);
  await noteOffer('a.webm', { reason: 'busy' }, dir);
  assert.equal((await readdir(dir)).length, 1);
  assert.deepEqual(await listRecordings(dir), []);
});

test('紀錄檔壞掉時當作沒有紀錄，不讓分析清單整個掛掉', async (t) => {
  const { writeFile } = await import('node:fs/promises');
  const dir = await tempDir(t);
  await writeFile(path.join(dir, '.paid-offers.json'), '{壞掉');
  assert.deepEqual(await readOffers(dir), {});
});
