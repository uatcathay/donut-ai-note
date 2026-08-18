import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startAnalysis, setStage, noteRetry, endAnalysis, getProgress } from '../src/progress.js';

test('沒有進行中的分析時回報 active: false', () => {
  endAnalysis();
  assert.deepEqual(getProgress(), { active: false });
});

test('開始分析後回報階段與已耗時', () => {
  startAnalysis(1000);
  const p = getProgress(4500);
  assert.equal(p.active, true);
  assert.equal(p.stage, 'upload');
  assert.equal(p.elapsedMs, 3500);
  assert.equal(p.retry, null);
  endAnalysis();
});

test('切換階段後回報新階段', () => {
  startAnalysis(0);
  setStage('analyze');
  assert.equal(getProgress(0).stage, 'analyze');
  endAnalysis();
});

test('重試中要能被前端看見——這是「還在努力」與「已經死了」的唯一區別', () => {
  startAnalysis(0);
  setStage('analyze');
  noteRetry('busy', 2, 3);
  const p = getProgress(0);
  assert.deepEqual(p.retry, { reason: 'busy', attempt: 2, total: 3 });
  endAnalysis();
});

test('進入新階段時清掉上一階段的重試狀態', () => {
  startAnalysis(0);
  noteRetry('busy', 1, 3);
  setStage('analyze');
  assert.equal(getProgress(0).retry, null);
  endAnalysis();
});

test('分析結束後回到 active: false，不留殘影', () => {
  startAnalysis(0);
  noteRetry('timeout', 1, 1);
  endAnalysis();
  assert.deepEqual(getProgress(), { active: false });
});

test('沒有進行中的分析時，setStage 與 noteRetry 不會憑空造出狀態', () => {
  endAnalysis();
  setStage('analyze');
  noteRetry('busy', 1, 3);
  assert.deepEqual(getProgress(), { active: false });
});
