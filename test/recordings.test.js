import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildRecordingName, extensionFor, saveRecording, discardRecording } from '../src/recordings.js';

const stamp = { date: '2026-08-13', time: '1430' };

test('extensionFor 由 mime type 取出副檔名', () => {
  assert.equal(extensionFor('audio/webm'), 'webm');
  assert.equal(extensionFor('audio/webm;codecs=opus'), 'webm');
  assert.equal(extensionFor('audio/mp4'), 'mp4');
});

test('extensionFor 認不出來時退回 bin，不要產生無副檔名的檔案', () => {
  assert.equal(extensionFor(''), 'bin');
  assert.equal(extensionFor(undefined), 'bin');
});

test('buildRecordingName 帶入時間與標題', () => {
  assert.equal(buildRecordingName('週會', stamp, 'audio/webm'), '錄音_2026-08-13_1430_週會.webm');
});

test('buildRecordingName 淨化路徑字元，避免寫到別的目錄', () => {
  const name = buildRecordingName('8/13 Planning', stamp, 'audio/webm');
  assert.ok(!name.includes('/'), `檔名不該含斜線：${name}`);
  assert.equal(name, '錄音_2026-08-13_1430_8_13 Planning.webm');
});

test('buildRecordingName 沒有標題時仍產生可用檔名', () => {
  assert.equal(buildRecordingName('', stamp, 'audio/webm'), '錄音_2026-08-13_1430_未命名.webm');
});

test('saveRecording 真的把音檔寫到磁碟，內容一致', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'rec-'));
  const buf = Buffer.from('假裝這是音檔');
  const filePath = await saveRecording(buf, 'a.webm', dir);
  assert.deepEqual(await readFile(filePath), buf);
});

test('saveRecording 會自動建立不存在的目錄', async () => {
  const dir = path.join(await mkdtemp(path.join(tmpdir(), 'rec-')), '還沒建的目錄');
  await saveRecording(Buffer.from('x'), 'a.webm', dir);
  assert.deepEqual(await readdir(dir), ['a.webm']);
});

test('discardRecording 刪掉檔案', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'rec-'));
  const filePath = await saveRecording(Buffer.from('x'), 'a.webm', dir);
  await discardRecording(filePath);
  assert.deepEqual(await readdir(dir), []);
});

test('discardRecording 對不存在的檔案不拋錯（清理失敗不該蓋掉真正的錯誤）', async () => {
  await discardRecording(path.join(tmpdir(), '這個檔案不存在-12345.webm'));
});
