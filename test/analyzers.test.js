import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../src/errors.js';
import { getAnalyzer } from '../src/analyzers/index.js';

test('getAnalyzer(gemini) 回傳函式', () => {
  assert.equal(typeof getAnalyzer('gemini'), 'function');
});
test('getAnalyzer 未知引擎拋 config 錯', () => {
  assert.throws(() => getAnalyzer('bogus'), (e) => e instanceof AppError && e.stage === 'config');
});
