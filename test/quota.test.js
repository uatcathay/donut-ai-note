import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteQuotaExhausted, clearQuota, isQuotaExhausted } from '../src/quota.js';

const at = (iso) => new Date(iso);

test('沒撞過額度就不提醒', () => {
  clearQuota();
  assert.equal(isQuotaExhausted(at('2026-08-19T02:00:00Z')), false);
});

test('撞到額度後，重置時間之前都要提醒', () => {
  clearQuota();
  noteQuotaExhausted(at('2026-08-19T07:00:00Z'));
  assert.equal(isQuotaExhausted(at('2026-08-19T02:00:00Z')), true);
});

// 這個狀態是推論不是事實，一定要會自己過期——
// 否則額度早就恢復了，畫面還在叫人別錄。
test('過了重置時間就自動失效', () => {
  clearQuota();
  noteQuotaExhausted(at('2026-08-19T07:00:00Z'));
  assert.equal(isQuotaExhausted(at('2026-08-19T07:00:01Z')), false);
});

// 推論可能是錯的（例如撞到的其實是別的限制），也可能使用者升級了方案。
// 任何一次分析成功都是額度可用的直接證據，比我們的推算可信。
test('分析成功就清掉，不再提醒', () => {
  clearQuota();
  noteQuotaExhausted(at('2026-08-19T07:00:00Z'));
  clearQuota();
  assert.equal(isQuotaExhausted(at('2026-08-19T02:00:00Z')), false);
});
