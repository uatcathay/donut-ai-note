import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// public/app.js 是瀏覽器腳本，沒有匯出任何東西。用 vm 載入它並配上最小的假 DOM，
// 頂層的 function 宣告會掛在 context 上，測試才叫得到。
const APP_SOURCE = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

function fakeElement() {
  const classes = new Set();
  return {
    textContent: '',
    innerHTML: '',
    onclick: null,
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, force) => {
        const on = force ?? !classes.has(c);
        if (on) classes.add(c); else classes.delete(c);
        return on;
      },
    },
    append() {},
    focus() {},
    close() {},
    removeAttribute() {},
  };
}

function loadApp(routes) {
  const elements = new Map();
  const document = {
    getElementById: (id) => {
      if (!elements.has(id)) elements.set(id, fakeElement());
      return elements.get(id);
    },
    querySelectorAll: () => [],
    createElement: () => fakeElement(),
  };
  const fetch = async (url) => {
    const path = String(url).split('?')[0];
    const route = routes[path] ?? { items: [] };
    return { ok: true, json: async () => route };
  };
  const context = vm.createContext({
    document, fetch, setInterval: () => 0, clearInterval: () => {}, setTimeout, clearTimeout,
  });
  vm.runInContext(APP_SOURCE, context);
  return { app: context, el: document.getElementById };
}

const SUMMARY = {
  title: '設計評審',
  topics: [{ title: 'T', points: ['p'] }],
  nextSteps: [],
  destination: { type: 'notion' },
};

// 實際遇到的 bug：前一次分析失敗留下紅字，之後按「立即分析」重試成功、打開摘要，
// 紅字仍掛在摘要下方，看起來像這次又失敗了。
test('按「立即分析」重試時，清掉前一次失敗留下的紅字', async () => {
  const { app, el } = loadApp({ '/api/pending/a.webm/retry': { ok: true } });
  app.showError('分析未成功。錄音已保留在分析清單，可按「立即分析」重試。');
  assert.equal(el('err').classList.contains('hidden'), false);

  await app.analyzeNow('a.webm');

  assert.equal(el('err').classList.contains('hidden'), true, '重試開始後，舊的失敗訊息已經過時');
});

test('打開摘要時，清掉先前殘留的紅字', async () => {
  const { app, el } = loadApp({ '/api/completed/a.webm': SUMMARY });
  app.showError('分析未成功。錄音已保留在分析清單，可按「立即分析」重試。');

  await app.openSummary('a.webm');

  assert.equal(el('view-done').classList.contains('hidden'), false, '摘要頁要顯示出來');
  assert.equal(el('err').classList.contains('hidden'), true, '摘要頁不該掛著舊的失敗訊息');
});
