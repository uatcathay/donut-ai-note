import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// public/app.js 是瀏覽器腳本，沒有匯出任何東西。用 vm 載入它並配上最小的假 DOM，
// 頂層的 function 宣告會掛在 context 上，測試才叫得到。
const APP_SOURCE = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

function fakeElement() {
  const classes = new Set();
  const children = [];
  return {
    children,
    className: '',
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
    append(...nodes) { children.push(...nodes); },
    focus() {},
    close() {},
    removeAttribute() {},
  };
}

function loadApp(routes, globals = {}) {
  const elements = new Map();
  const document = {
    getElementById: (id) => {
      if (!elements.has(id)) elements.set(id, fakeElement());
      return elements.get(id);
    },
    querySelectorAll: () => [],
    createElement: () => fakeElement(),
  };
  const requests = [];
  const fetch = async (url, init = {}) => {
    const path = String(url).split('?')[0];
    requests.push(`${init.method || 'GET'} ${path}`);
    const route = routes[path] ?? { items: [] };
    return { ok: true, json: async () => route };
  };
  const context = vm.createContext({
    document, fetch, setInterval: () => 0, clearInterval: () => {}, setTimeout, clearTimeout,
    ...globals,
  });
  vm.runInContext(APP_SOURCE, context);
  return { app: context, el: document.getElementById, requests };
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

// writeText 只放得進純文字，貼到 Notion 或文件裡標題和列點都會變成一行行的普通文字
test('複製摘要時同時放 HTML 與純文字，貼到編輯器才保留格式', async () => {
  const written = [];
  class ClipboardItem {
    constructor(data) { this.data = data; }
  }
  const navigator = { clipboard: { write: async (items) => { written.push(...items); } } };
  const { el } = loadApp({}, { navigator, ClipboardItem, Blob });
  el('summary-body').innerHTML = '<h3>✨ Minutes</h3><ul><li>重點</li></ul>';
  el('summary-body').innerText = '✨ Minutes\n重點\n';
  el('err').classList.add('hidden');

  await el('btn-copy').onclick();

  assert.equal(written.length, 1, '應寫入一個 ClipboardItem');
  const blobText = async (type) => (await written[0].data[type]).text();
  assert.match(await blobText('text/html'), /<li>重點<\/li>/);
  assert.equal(await blobText('text/plain'), '✨ Minutes\n重點');
  assert.equal(el('err').classList.contains('hidden'), true, '成功時不該出現錯誤');
});

// 畫面上的粗體來自 <h3>／<h4> 的預設樣式。Slack 這類不認標題的地方貼上後只剩普通字，
// 包一層 <strong> 才保得住粗體。
test('摘要的標題包著 <strong>，貼到不認標題的地方仍是粗體', async () => {
  const { app, el } = loadApp({ '/api/completed/a.webm': { ...SUMMARY, nextSteps: ['寄出會議記錄'] } });

  await app.openSummary('a.webm');

  const html = el('preview').innerHTML;
  const headings = html.match(/<h[34][^>]*>.*?<\/h[34]>/gs) || [];
  assert.equal(headings.length, 3, '應有 What\'s next、Minutes 與一個議題標題');
  for (const h of headings) assert.match(h, /<strong>.+<\/strong>/s, `標題缺少 <strong>：${h}`);
});

// Slack 不吃標題的 margin，貼上後下一個議題標題緊貼著上一段列點
test('複製的 HTML 在每個標題前空一行，貼到 Slack 才分得開議題', async () => {
  const written = [];
  class ClipboardItem {
    constructor(data) { this.data = data; }
  }
  const navigator = { clipboard: { write: async (items) => { written.push(...items); } } };
  const { el } = loadApp({}, { navigator, ClipboardItem, Blob });
  el('summary-body').innerHTML = '<h3>Minutes</h3><h4>A</h4><ul><li>a</li></ul>\n    <h4>B</h4><ul><li>b</li></ul>';
  el('summary-body').innerText = '';

  await el('btn-copy').onclick();

  const html = await written[0].data['text/html'].text();
  assert.match(html, /<\/ul><p><br><\/p>\s*<h4>B<\/h4>/, '列點與下一個標題之間要有空行');
  assert.match(html, /^<h3>Minutes<\/h3><h4>A<\/h4>/, '大標與緊接的議題標題之間不需要空行');
});

// 這句只是告訴使用者逐字稿在哪，貼到別處就成了雜訊
test('「完整逐字稿已另存」的提示放在可複製的本文之外', async () => {
  const { app, el } = loadApp({ '/api/completed/a.webm': SUMMARY });

  await app.openSummary('a.webm');

  const html = el('preview').innerHTML;
  assert.match(html, /<div id="summary-body">[\s\S]*✨ Minutes[\s\S]*<\/div>\s*<small class="pv-note">/);
});

// ── 付費版備援 ─────────────────────────────────────────
const PENDING = { id: 'a.webm', label: '週會（20261113 10:00）', sizeBytes: 60_000_000, state: 'pending' };

async function renderJobs(job) {
  const loaded = loadApp({ '/api/jobs': { items: [job] } });
  await loaded.app.refreshJobs();
  const row = loaded.el('jobs').children.find((c) => c.className === 'pending-item');
  const [label, actions] = row.children;
  return { ...loaded, label, actions };
}

const texts = (node) => node.children.map((c) => c.textContent);

test('免費版放棄的錄音：那一列多一行紅字，「付費分析」排在立即分析與刪除中間', async () => {
  const { label, actions } = await renderJobs({ ...PENDING, paid: { note: '免費版忙碌，3 次都沒成功', costNtd: 6 } });
  const red = label.children.find((c) => c.className === 'job-retry');
  assert.equal(red?.textContent, '免費版忙碌，3 次都沒成功');
  assert.deepEqual(texts(actions), ['立即分析', '付費分析・約 NT$6', '刪除']);
});

test('估不出金額時按鈕只寫「付費分析」', async () => {
  const { actions } = await renderJobs({ ...PENDING, paid: { note: null, costNtd: null } });
  assert.deepEqual(texts(actions), ['立即分析', '付費分析', '刪除']);
});

test('紅字已經過時（額度恢復了）就只留按鈕，不顯示紅字', async () => {
  const { label } = await renderJobs({ ...PENDING, paid: { note: null, costNtd: 6 } });
  assert.equal(label.children.some((c) => c.className === 'job-retry'), false);
});

test('沒被免費版放棄過的錄音維持原本兩顆按鈕', async () => {
  const { actions } = await renderJobs(PENDING);
  assert.deepEqual(texts(actions), ['立即分析', '刪除']);
});

test('按「付費分析」送到付費版的端點，不是一般的重試', async () => {
  const { actions, requests } = await renderJobs({ ...PENDING, paid: { note: null, costNtd: 6 } });
  await actions.children[1].onclick();
  assert.ok(requests.includes('POST /api/pending/a.webm/paid-retry'));
  assert.ok(!requests.includes('POST /api/pending/a.webm/retry'));
});

test('已完成那一列標出這筆用的是免費版還是付費版', async () => {
  const done = { id: 'a.webm', title: '週會', state: 'done' };
  const meta = async (job) => (await renderJobs(job)).label.children[1].textContent;
  assert.equal(await meta({ ...done, tier: 'free' }), '已完成・免費版');
  assert.equal(await meta({ ...done, tier: 'paid' }), '已完成・付費版');
  assert.equal(await meta(done), '已完成', '舊資料沒有版本就不標');
});
