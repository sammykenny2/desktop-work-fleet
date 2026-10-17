/** Build bundled local UI assets. Usage: node scripts/build-web.mjs [--output DIR] [--config-output FILE] [--platform windows|linux] [--help] */
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readBuildConfig, secretPlatforms } from './config.mjs';

export async function buildWebAssets({
  root = fileURLToPath(new URL('../', import.meta.url)),
  destination = path.join(root, 'build', 'app'),
  configDestination = path.join(root, 'build', 'config', 'public.json'),
  environment = process.env,
  bundleScripts = false,
  platform,
} = {}) {
  // The config file stays beside the app, outside the renderer's assets; only the named desktop platform gets its secret.
  const config = await readBuildConfig(pathToFileURL(root + path.sep), environment, { platform });
  await mkdir(path.dirname(configDestination), { recursive: true });
  await writeFile(configDestination, JSON.stringify(config, null, 2) + '\n');
  await mkdir(destination, { recursive: true });
  for (const folder of ['app', 'core', 'layout', 'interaction', 'storage', 'sources', 'backup', 'desktop', 'i18n']) {
    await cp(path.join(root, 'src', folder), path.join(destination, folder), { recursive: true });
  }
  await mkdir(path.join(destination, 'native'), { recursive: true });
  for (const name of ['bridge.js', 'files.js', 'capture.js', 'shortcuts.js', 'google.js', 'attachments.js']) await cp(path.join(root, 'src', 'native', name), path.join(destination, 'native', name));
  for (const folder of ['app', 'desktop']) {
    const htmlPath = path.join(destination, folder, 'index.html');
    const html = await readFile(htmlPath, 'utf8');
    const importMap = html.match(/<script type="importmap">([^<]+)<\/script>/)[1];
    if (bundleScripts) {
      const { build } = await import('esbuild');
      const entry = folder === 'app' ? 'main' : 'scene';
      await build({
        absWorkingDir: root, entryPoints: [path.join(root, 'src', folder, `${entry}.js`)],
        outfile: path.join(destination, folder, `${entry}.bundle.js`), bundle: true,
        format: 'iife', platform: 'browser', target: 'safari16', charset: 'utf8', legalComments: 'inline',
      });
      await writeFile(htmlPath, html.replace(/\s*<script type="importmap">[^<]+<\/script>/, '')
        .replace(' IMPORT_MAP_HASH', '').replace(`type="module" src="${entry}.js"`, `defer src="${entry}.bundle.js"`));
    } else {
      const hash = createHash('sha256').update(importMap).digest('base64');
      await writeFile(htmlPath, html.replace('IMPORT_MAP_HASH', `'sha256-${hash}'`));
    }
  }
  await mkdir(path.join(destination, 'vendor'), { recursive: true });
  for (const [name, target, license] of [['marked', 'marked.js', 'LICENSE'], ['dompurify', 'dompurify.js', 'LICENSE'], ['fflate', 'fflate.js', 'LICENSE']]) {
    const entry = fileURLToPath(import.meta.resolve(name === 'fflate' ? 'fflate/browser' : name));
    await cp(entry, path.join(destination, 'vendor', target));
    await cp(path.join(root, 'node_modules', name, license), path.join(destination, 'vendor', `${name}-LICENSE.txt`));
  }
  const { build } = await import('esbuild');
  await build({ absWorkingDir: root, entryPoints: ['highlight.js/lib/common'], outfile: path.join(destination, 'vendor/highlight.js'), bundle: true, format: 'esm', platform: 'browser', target: 'safari16', minify: true, legalComments: 'inline' });
  await cp(path.join(root, 'node_modules/highlight.js/LICENSE'), path.join(destination, 'vendor/highlight.js-LICENSE.txt'));
  await cp(path.join(root, 'THIRD-PARTY-NOTICES.md'), path.join(destination, 'THIRD-PARTY-NOTICES.md'));
  await cp(path.join(root, 'LICENSE'), path.join(destination, 'LICENSE'));
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  await writeFile(path.join(destination, 'build-info.json'), JSON.stringify({ version: pkg.version, dependencies: pkg.dependencies }, null, 2) + '\n');
  return { destination, configDestination };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { help: { type: 'boolean' }, output: { type: 'string' }, 'config-output': { type: 'string' }, platform: { type: 'string' } } });
  if (values.help) {
    console.log('Usage: node scripts/build-web.mjs [--output DIR] [--config-output FILE] [--platform windows|linux]\nCopies local UI assets and pinned vendor modules. Defaults to build/app and build/config/public.json.\n--platform also writes that desktop platform\'s Google client secret into the config file.');
  } else {
    const options = {};
    if (values.output) options.destination = path.resolve(values.output);
    if (values['config-output']) options.configDestination = path.resolve(values['config-output']);
    if (values.platform) {
      if (!secretPlatforms.includes(values.platform)) throw new Error(`--platform must be one of ${secretPlatforms.join(', ')}.`);
      options.platform = values.platform;
    }
    const { destination } = await buildWebAssets(options);
    console.log(`Built ${destination} (local bundled assets, no application server).`);
  }
}
