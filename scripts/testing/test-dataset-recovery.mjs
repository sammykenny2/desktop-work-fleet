/** Run recovery renderer regressions against disposable loopback/browser/provider fixtures. */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/testing/test-dataset-recovery.mjs\nRequires built web assets and Playwright Chromium/WebKit. Starts an ephemeral loopback preview and checks desktop/iOS/Android renderer recovery with synthetic host/Drive adapters.');
  process.exit(0);
}
const cwd = fileURLToPath(new URL('../../', import.meta.url));
const server = spawn(process.platform === 'win32' ? 'python' : 'python3', ['scripts/testing/serve_preview.py', '--port', '0'],
  { cwd, stdio: ['ignore', 'pipe', 'inherit'] });
try {
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Preview did not start within 10 seconds')), 10000);
    let text = '';
    const stop = value => { clearTimeout(timer); return value; };
    server.on('error', error => reject(stop(error)));
    server.on('exit', code => reject(stop(new Error(`Preview exited: ${code}`))));
    server.stdout.on('data', bytes => {
      text += bytes.toString(); const match = text.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) resolve(stop(match[0]));
    });
  });
  const probe = async (script, ...args) => {
    const child = spawn(process.execPath, [`scripts/testing/${script}`, '--url', url, ...args], { cwd, stdio: 'inherit', timeout: 120000 });
    const [code, signal] = await once(child, 'exit');
    if (code !== 0) throw new Error(`Probe failed: ${script} ${args.join(' ')}, ${signal ?? code}`);
  };
  for (const [browser, platform] of [['chromium', 'linux'], ['webkit', 'linux'], ['webkit', 'ios'], ['chromium', 'android']]) {
    await probe('legacy-google-reset-ui-probe.mjs', '--browser', browser, '--platform', platform);
  }
  for (const browser of ['chromium', 'webkit']) await probe('group-dialog-sync-probe.mjs', '--browser', browser);
  await probe('shared-ids-probe.mjs');
  await probe('notifications-probe.mjs', '--browser', 'chromium');
  await probe('notifications-probe.mjs', '--browser', 'webkit', '--locale', 'zh-TW');
  await probe('layout-probe.mjs', '--browser', 'chromium');
  await probe('layout-probe.mjs', '--browser', 'webkit', '--locale', 'zh-TW');
} finally {
  if (server.exitCode === null) { server.kill(); await once(server, 'exit'); }
}
