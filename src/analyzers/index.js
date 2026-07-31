import { analyze as geminiAnalyze } from './gemini.js';
import { AppError } from '../errors.js';

const ENGINES = { gemini: geminiAnalyze };

export function getAnalyzer(name) {
  const fn = ENGINES[name];
  if (!fn) throw new AppError('config', `未知的分析引擎：${name}`);
  return fn;
}

export function analyze(audioBuffer, mimeType) {
  const name = process.env.ENGINE || 'gemini';
  return getAnalyzer(name)(audioBuffer, mimeType);
}
