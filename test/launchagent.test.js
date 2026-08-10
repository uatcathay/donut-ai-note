import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function printPlist() {
  return execFileSync('bash', ['scripts/install-launchagent.sh', '--print-plist'], {
    cwd: ROOT, encoding: 'utf8',
  });
}

test('--print-plist 產出 launchd 需要的基本欄位', () => {
  const out = printPlist();
  assert.match(out, /<key>Label<\/key>\s*<string>com\.local\.browser-ai-note<\/string>/);
  assert.match(out, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(out, /<key>KeepAlive<\/key>\s*<true\/>/);
});

test('--print-plist 的 ProgramArguments 必須是絕對路徑', () => {
  // launchd 的 PATH 極精簡，相對路徑或裸的 node 都會啟動失敗
  const out = printPlist();
  const block = out.match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/);
  assert.ok(block, '找不到 ProgramArguments');
  const paths = [...block[1].matchAll(/<string>(.*?)<\/string>/g)].map((m) => m[1]);
  assert.equal(paths.length, 2);
  for (const p of paths) assert.ok(p.startsWith('/'), `不是絕對路徑：${p}`);
  assert.ok(paths[1].endsWith('/src/server.js'), `第二個參數應為 server.js：${paths[1]}`);
});

test('--print-plist 的 WorkingDirectory 指向專案根（伺服器需讀 .env）', () => {
  const out = printPlist();
  const wd = out.match(/<key>WorkingDirectory<\/key>\s*<string>(.*?)<\/string>/);
  assert.ok(wd, '找不到 WorkingDirectory');
  assert.equal(wd[1].replace(/\/$/, ''), ROOT.replace(/\/$/, ''));
});

test('未知參數會直接失敗並顯示用法，不會誤觸安裝流程', () => {
  // 這條路徑必須在任何 node／專案結構檢查、寫檔、launchctl 呼叫之前就退出，
  // 所以斷言只看 exit code 與 stderr，不驗證任何機器狀態（本測試無副作用）。
  assert.throws(
    () => {
      execFileSync('bash', ['scripts/install-launchagent.sh', '--bogus'], {
        cwd: ROOT, encoding: 'utf8',
      });
    },
    (err) => {
      assert.notEqual(err.status, 0, '未知參數應以非 0 結束');
      assert.match(err.stderr, /--print-plist/);
      assert.match(err.stderr, /--uninstall/);
      return true;
    },
  );
});
