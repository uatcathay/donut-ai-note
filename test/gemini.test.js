import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../src/errors.js';
import { buildPrompt, parseGeminiJson, analyze, formatTimings } from '../src/analyzers/gemini.js';

test('buildPrompt 要求繁中且禁止講者標記', () => {
  const p = buildPrompt();
  assert.match(p, /繁體中文/);
  assert.match(p, /不要標記講者|講者標籤/);
  assert.match(p, /suggestedTitle/);
});

test('parseGeminiJson 解析純 JSON', () => {
  const obj = parseGeminiJson('{"summary":"s","keyPoints":["a"],"transcript":"t","suggestedTitle":"x"}');
  assert.equal(obj.summary, 's');
});

test('parseGeminiJson 去除 ```json 圍欄', () => {
  const raw = '```json\n{"summary":"s","keyPoints":["a"],"transcript":"t","suggestedTitle":"x"}\n```';
  assert.equal(parseGeminiJson(raw).transcript, 't');
});

test('parseGeminiJson 非 JSON 拋錯', () => {
  assert.throws(() => parseGeminiJson('抱歉我不會'), (e) => e instanceof AppError && e.stage === 'analyze');
});

test('analyze 注入 generate 回傳解析結果', async () => {
  const fakeGenerate = async () => '{"summary":"開會摘要","keyPoints":["點一"],"transcript":"逐字","suggestedTitle":"週會"}';
  const out = await analyze(Buffer.from('x'), 'audio/webm', { generate: fakeGenerate });
  assert.equal(out.suggestedTitle, '週會');
  assert.equal(out.keyPoints[0], '點一');
});

test('formatTimings 標出三個階段的秒數與佔比，用來找出瓶頸', () => {
  const line = formatTimings({ uploadMs: 1200, waitMs: 1500, generateMs: 8300, bytes: 2 * 1024 * 1024 });
  assert.match(line, /上傳 1\.2s \(11%\)/);
  assert.match(line, /等待 1\.5s \(14%\)/);
  assert.match(line, /生成 8\.3s \(75%\)/);
  assert.match(line, /合計 11\.0s/);
  assert.match(line, /2\.0MB/);
});

test('formatTimings 合計為 0 時不會除以零', () => {
  const line = formatTimings({ uploadMs: 0, waitMs: 0, generateMs: 0, bytes: 0 });
  assert.match(line, /合計 0\.0s/);
  assert.doesNotMatch(line, /NaN/);
});
