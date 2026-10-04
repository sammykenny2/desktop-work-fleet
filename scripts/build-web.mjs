/** Build bundled local UI assets. Usage: node scripts/build-web.mjs [--help] */
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readBuildConfig } from './config.mjs';

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/build-web.mjs\nCopies app/core/layout/interaction/storage assets and pinned vendor modules to build/app.');
} else {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const destination = path.join(root, 'build', 'app');
  const config = await readBuildConfig(new URL('../', import.meta.url));
  await mkdir(path.join(root, 'build', 'config'), { recursive: true });
  await writeFile(path.join(root, 'build', 'config', 'public.json'), JSON.stringify(config, null, 2) + '\n');
  await mkdir(destination, { recursive: true });
  for (const folder of ['app', 'core', 'layout', 'interaction', 'storage', 'sources', 'backup', 'desktop']) {
    await cp(path.join(root, 'src', folder), path.join(destination, folder), { recursive: true });
  }
  await mkdir(path.join(destination, 'native'), { recursive: true });
  for (const name of ['bridge.js', 'shortcuts.js']) await cp(path.join(root, 'src', 'native', name), path.join(destination, 'native', name));
  for (const folder of ['app', 'desktop']) {
    const htmlPath = path.join(destination, folder, 'index.html');
    const html = await readFile(htmlPath, 'utf8');
    const importMap = html.match(/<script type="importmap">([^<]+)<\/script>/)[1];
    const hash = createHash('sha256').update(importMap).digest('base64');
    await writeFile(htmlPath, html.replace('IMPORT_MAP_HASH', `'sha256-${hash}'`));
  }
  await mkdir(path.join(destination, 'vendor'), { recursive: true });
  for (const [name, target, license] of [['marked', 'marked.js', 'LICENSE'], ['dompurify', 'dompurify.js', 'LICENSE'], ['fflate', 'fflate.js', 'LICENSE']]) {
    const entry = fileURLToPath(import.meta.resolve(name === 'fflate' ? 'fflate/browser' : name));
    await cp(entry, path.join(destination, 'vendor', target));
    await cp(path.join(root, 'node_modules', name, license), path.join(destination, 'vendor', `${name}-LICENSE.txt`));
  }
  await cp(path.join(root, 'THIRD-PARTY-NOTICES.md'), path.join(destination, 'THIRD-PARTY-NOTICES.md'));
  await cp(path.join(root, 'LICENSE'), path.join(destination, 'LICENSE'));
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  await writeFile(path.join(destination, 'build-info.json'), JSON.stringify({ version: pkg.version, dependencies: pkg.dependencies }, null, 2) + '\n');
  console.log('Built build/app (local bundled assets, no application server).');
}
