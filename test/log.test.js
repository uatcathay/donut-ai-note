import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stamped } from '../src/log.js';

test('stamped 在訊息前加上本地時間戳記', () => {
  assert.equal(
    stamped('[計時] 合計 141.7s', new Date(2026, 7, 18, 21, 7, 43)),
    '[2026-08-18 21:07:43] [計時] 合計 141.7s');
});

test('stamped 個位數的月日時分秒都補零，欄位才對得齊', () => {
  assert.equal(
    stamped('啟動', new Date(2026, 0, 5, 9, 3, 7)),
    '[2026-01-05 09:03:07] 啟動');
});

test('stamped 不更動訊息本身', () => {
  const msg = '[重試] 分析錄音遇到暫時性錯誤，5 秒後重試（第 1/3 次）';
  assert.ok(stamped(msg, new Date(2026, 7, 18)).endsWith(msg));
});
