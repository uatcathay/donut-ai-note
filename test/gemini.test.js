import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../src/errors.js';
import { buildPrompt, parseGeminiJson, analyze } from '../src/analyzers/gemini.js';

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
