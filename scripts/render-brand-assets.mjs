/**
 * Render the icon concepts in assets/brand into every platform and store format. Design-time tool only: it needs the
 * Playwright dev dependency (npm ci) and, for .icns and Liquid Glass previews, macOS with Xcode. Package and release
 * scripts must not call it; once a concept is chosen its outputs are committed where the native projects read them.
 *
 * Usage: node scripts/render-brand-assets.mjs [--concept ID|all] [--output DIR] [--app-id ID] [--no-company] [--install]
 *   --concept   one directory under assets/brand/concepts, or all (default)
 *   --output    destination, default build/brand (Git-ignored)
 *   --app-id    Linux icon name, default dev.sammykenny2.pinitanywhere
 *   --install   also copy the one concept's app and tray icons into the native projects (see INSTALLED)
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compose, iconDocument, inner, listConcepts, loadConcept } from './brand-assets.mjs';
import { company } from './brand-company.mjs';

const ICON_COMPOSER_TOOL = '/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool';
const SCALES = [100, 125, 150, 200, 400];
const TARGET_SIZES = [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256];
const ANDROID_DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const SMALL_LIMIT = 32;
const USAGE = `Usage: node scripts/render-brand-assets.mjs [--concept ID|all] [--output DIR] [--app-id ID] [--no-company] [--install]
  --concept   one directory under assets/brand/concepts, or all (default)
  --output    destination, default build/brand (Git-ignored)
  --app-id    Linux icon name, default dev.sammykenny2.pinitanywhere
  --no-company  skip the sammykenny2.dev publisher marks
  --install   with one --concept, also replace the committed app and tray icons in src/native (commit the result)
Needs the Playwright dev dependency (npm ci); .icns and Liquid Glass previews need macOS with Xcode 26+.`;

function options(argv) {
  const result = { concept: 'all', output: 'build/brand', appId: 'dev.sammykenny2.pinitanywhere', company: true, install: false };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--help') result.help = true;
    else if (flag === '--no-company') result.company = false;
    else if (flag === '--install') result.install = true;
    else if (['--concept', '--output', '--app-id'].includes(flag) && argv[index + 1]) result[{ '--app-id': 'appId' }[flag] ?? flag.slice(2)] = argv[++index];
    else throw new Error(`Unknown or incomplete argument: ${flag}`);
  }
  if (result.install && result.concept === 'all') throw new Error('--install needs one --concept.');
  return result;
}

/** Committed destinations of the selected concept, relative to the repository root. Packaging reads only these. */
const INSTALLED = {
  appleResources: 'src/native/apple/resources',
  androidResources: 'src/native/android/app/src/main/res',
  windowsIcon: 'src/native/windows/app/PinItAnywhere.ico',
  windowsPackageAssets: 'src/native/windows/package-assets',
  linuxTheme: 'src/native/linux/icons/hicolor',
};
// MakeAppx packs without resources.pri, so the manifest names unqualified scale-100 files and Windows scales them.
const WINDOWS_PACKAGE_ASSETS = ['Square44x44Logo', 'Square150x150Logo', 'StoreLogo'];

/**
 * Copy one rendered concept into the native projects. Only named files are replaced: an asset-catalog set loses the
 * files its old Contents.json listed, and sibling resources (strings, other sets, XML) are never touched.
 */
async function install(rendered, appId) {
  const repository = fileURLToPath(new URL('../', import.meta.url)), at = relative => path.join(repository, relative);
  const place = async (source, destination) => { await mkdir(path.dirname(destination), { recursive: true }); await copyFile(source, destination); };
  const replaceSet = async (source, destination) => {
    try {
      for (const { filename } of JSON.parse(await readFile(path.join(destination, 'Contents.json'), 'utf8')).images ?? [])
        if (filename) await rm(path.join(destination, path.basename(filename)), { force: true });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const name of await readdir(source)) await place(path.join(source, name), path.join(destination, name));
  };
  const apple = at(INSTALLED.appleResources);
  await replaceSet(path.join(rendered, 'apple', 'ios', 'AppIcon.appiconset'), path.join(apple, 'ios-Icons.xcassets', 'AppIcon.appiconset'));
  await replaceSet(path.join(rendered, 'apple', 'macos', 'AppIcon.appiconset'), path.join(apple, 'macos-Icons.xcassets', 'AppIcon.appiconset'));
  await replaceSet(path.join(rendered, 'apple', 'macos', 'StatusItem.imageset'), path.join(apple, 'macos-Icons.xcassets', 'StatusItem.imageset'));
  for (const folder of [...Object.keys(ANDROID_DENSITIES).map(density => `mipmap-${density}`), 'mipmap-anydpi'])
    for (const name of await readdir(path.join(rendered, 'android', 'res', folder)))
      await place(path.join(rendered, 'android', 'res', folder, name), path.join(at(INSTALLED.androidResources), folder, name));
  await place(path.join(rendered, 'windows', 'AppIcon.ico'), at(INSTALLED.windowsIcon));
  for (const name of WINDOWS_PACKAGE_ASSETS)
    await place(path.join(rendered, 'windows', 'Assets', `${name}.scale-100.png`), path.join(at(INSTALLED.windowsPackageAssets), `${name}.png`));
  // Linux names follow the configured app ID, so the theme is committed under a fixed name and renamed when packaged.
  const theme = path.join(rendered, 'linux', 'hicolor');
  for (const size of await readdir(theme)) for (const name of await readdir(path.join(theme, size, 'apps')))
    await place(path.join(theme, size, 'apps', name), path.join(at(INSTALLED.linuxTheme), size, 'apps', name.replace(appId, 'app-icon')));
  console.log(`Installed ${path.basename(rendered)} into ${Object.values(INSTALLED).join(', ')}`);
}

/** Centre a square SVG inside a width x height canvas, `size` pixels across, over an optional backdrop. */
function frame(svg, width, height, size, backdrop = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${backdrop}<svg x="${(width - size) / 2}" y="${(height - size) / 2}" width="${size}" height="${size}" viewBox="${/viewBox="([^"]+)"/.exec(svg)[1]}">${inner(svg)}</svg></svg>\n`;
}
const fill = ({ top, bottom }, width, height) => `<defs><linearGradient id="backdrop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs><rect width="${width}" height="${height}" fill="url(#backdrop)"/>`;

/** Windows .ico with PNG-compressed entries; a width/height byte of 0 means 256 px. */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length); let offset = header.length;
  header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  images.forEach(({ size, data }, index) => {
    const entry = 6 + 16 * index; header[entry] = header[entry + 1] = size % 256; header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8); header.writeUInt32LE(offset, entry + 12); offset += data.length;
  });
  return Buffer.concat([header, ...images.map(image => image.data)]);
}
const contents = (images, properties) => JSON.stringify({ images, info: { author: 'xcode', version: 1 }, ...(properties ? { properties } : {}) }, null, 2) + '\n';

async function main() {
  const settings = options(process.argv.slice(2));
  if (settings.help) { console.log(USAGE); return; }
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch { throw new Error('Playwright is a dev dependency; run npm ci first.'); }
  const ids = settings.concept === 'all' ? await listConcepts() : [settings.concept];
  const browser = await chromium.launch(), page = await browser.newPage();
  // One page draws every image, so calls are queued: concurrent callers (the ICO builders use Promise.all) would
  // otherwise interleave viewport, content and screenshot, and every frame would come out as the last image set.
  let queue = Promise.resolve();
  const raster = (svg, width, height = width) => {
    const run = queue.then(async () => {
      await page.setViewportSize({ width, height });
      await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}body>svg{display:block;width:${width}px;height:${height}px}</style>${svg}`);
      return page.screenshot({ omitBackground: true, type: 'png' });
    });
    queue = run.catch(() => {});
    return run;
  };
  const write = async (file, data) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, data); };
  const png = async (file, svg, width, height) => write(file, await raster(svg, width, height));
  try {
    for (const id of ids) {
      const concept = await loadConcept(id), root = path.join(settings.output, id);
      await rm(root, { recursive: true, force: true });
      const art = {
        square: compose.square(concept), squareDark: compose.square(concept, { dark: true }), iosDark: compose.iosDark(concept), iosTinted: compose.iosTinted(concept),
        macos: compose.macos(concept), macosSmall: compose.macosSmall(concept), freeform: compose.freeform(concept), small: compose.small(concept),
        androidBackground: compose.androidBackground(concept), androidForeground: compose.androidForeground(concept), androidMonochrome: compose.androidMonochrome(concept),
        tray: compose.tray(concept),
      };
      for (const [name, svg] of Object.entries(art)) await write(path.join(root, 'sources', `${name}.svg`), svg);
      const appIcon = size => size <= SMALL_LIMIT ? art.small : art.freeform;
      // Windows small frames (notification area, title bars, small taskbar targets) use the pixel-grid drawings, which
      // fill the cell with whole-pixel edges; other sizes fall back to the shared art.
      const windowsIcon = size => (size <= SMALL_LIMIT && compose.pixel(concept, size)) || appIcon(size);

      // Apple: Icon Composer document (Xcode 26+ builds fallbacks from it) and the asset-catalog route.
      const iconPath = path.join(root, 'apple', 'AppIcon.icon');
      for (const layer of compose.iconLayers(concept)) await write(path.join(iconPath, 'Assets', `${layer.name}.svg`), layer.svg);
      await write(path.join(iconPath, 'icon.json'), JSON.stringify(iconDocument(concept), null, 2) + '\n');
      const ios = path.join(root, 'apple', 'ios', 'AppIcon.appiconset');
      await png(path.join(ios, 'icon-1024.png'), art.square, 1024); await png(path.join(ios, 'icon-1024-dark.png'), art.iosDark, 1024); await png(path.join(ios, 'icon-1024-tinted.png'), art.iosTinted, 1024);
      await write(path.join(ios, 'Contents.json'), contents([
        { filename: 'icon-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' },
        { appearances: [{ appearance: 'luminosity', value: 'dark' }], filename: 'icon-1024-dark.png', idiom: 'universal', platform: 'ios', size: '1024x1024' },
        { appearances: [{ appearance: 'luminosity', value: 'tinted' }], filename: 'icon-1024-tinted.png', idiom: 'universal', platform: 'ios', size: '1024x1024' },
      ]));
      const mac = path.join(root, 'apple', 'macos', 'AppIcon.appiconset'), iconset = path.join(root, 'apple', 'macos', 'AppIcon.iconset'), macImages = [];
      for (const size of [16, 32, 128, 256, 512]) for (const scale of [1, 2]) {
        const pixels = size * scale, name = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`, data = await raster(pixels <= SMALL_LIMIT ? art.macosSmall : art.macos, pixels);
        await write(path.join(mac, name), data); await write(path.join(iconset, name), data);
        macImages.push({ filename: name, idiom: 'mac', scale: `${scale}x`, size: `${size}x${size}` });
      }
      await write(path.join(mac, 'Contents.json'), contents(macImages));
      if (process.platform === 'darwin') { execFileSync('iconutil', ['--convert', 'icns', '--output', path.join(root, 'apple', 'macos', 'AppIcon.icns'), iconset]); }
      await rm(iconset, { recursive: true, force: true });
      const status = path.join(root, 'apple', 'macos', 'StatusItem.imageset');
      await write(path.join(status, 'StatusItem.svg'), art.tray);
      await write(path.join(status, 'Contents.json'), contents([{ filename: 'StatusItem.svg', idiom: 'universal' }], { 'preserves-vector-representation': true, 'template-rendering-intent': 'template' }));
      await png(path.join(root, 'apple', 'macos', 'status-item.png'), art.tray, 16); await png(path.join(root, 'apple', 'macos', 'status-item@2x.png'), art.tray, 32);
      if (existsSync(ICON_COMPOSER_TOOL)) {
        for (const [platform, rendition] of [['iOS', 'Default'], ['iOS', 'Dark'], ['iOS', 'ClearLight'], ['iOS', 'ClearDark'], ['iOS', 'TintedLight'], ['iOS', 'TintedDark'], ['macOS', 'Default'], ['macOS', 'Dark']]) {
          const output = path.join(root, 'apple', 'previews', `${platform.toLowerCase()}-${rendition.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}.png`); await mkdir(path.dirname(output), { recursive: true });
          execFileSync(ICON_COMPOSER_TOOL, [iconPath, '--export-image', '--output-file', output, '--platform', platform, '--rendition', rendition, '--width', '512', '--height', '512', '--scale', '1',
            ...(rendition.startsWith('Tinted') ? ['--tint-color', '0.58', '--tint-strength', '0.8'] : [])], { stdio: 'pipe' });
        }
      }

      // Android adaptive icon (minSdk 28, so no legacy bitmaps and no -v26 qualifier) and Google Play listing art.
      const res = path.join(root, 'android', 'res');
      for (const [density, factor] of Object.entries(ANDROID_DENSITIES)) for (const layer of ['background', 'foreground', 'monochrome'])
        await png(path.join(res, `mipmap-${density}`, `ic_launcher_${layer}.png`), art[`android${layer[0].toUpperCase()}${layer.slice(1)}`], 108 * factor);
      const adaptive = `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@mipmap/ic_launcher_background" />\n    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />\n</adaptive-icon>\n`;
      await write(path.join(res, 'mipmap-anydpi', 'ic_launcher.xml'), adaptive); await write(path.join(res, 'mipmap-anydpi', 'ic_launcher_round.xml'), adaptive);
      await png(path.join(root, 'store', 'google-play-icon-512.png'), art.square, 512);
      await png(path.join(root, 'store', 'google-play-feature-graphic-1024x500.png'), frame(art.freeform, 1024, 500, 420, fill(concept.meta.fill, 1024, 500)), 1024, 500);

      // Windows: executable icon, MSIX visual assets, monochrome notification-area icons and Store listing art.
      const win = path.join(root, 'windows');
      await write(path.join(win, 'AppIcon.ico'), ico(await Promise.all([16, 20, 24, 32, 40, 48, 64, 256].map(async size => ({ size, data: await raster(windowsIcon(size), size) })))));
      for (const [name, colour] of [['tray-light-theme', '#1A1A1A'], ['tray-dark-theme', '#FFFFFF']])
        await write(path.join(win, `${name}.ico`), ico(await Promise.all([16, 20, 24, 32, 40, 48, 64].map(async size => ({ size, data: await raster(compose.tray(concept, colour), size) })))));
      const assets = path.join(win, 'Assets');
      for (const size of TARGET_SIZES) for (const suffix of ['', '_altform-unplated', '_altform-lightunplated'])
        await png(path.join(assets, `Square44x44Logo.targetsize-${size}${suffix}.png`), windowsIcon(size), size);
      const tiles = { Square44x44Logo: [44, 44, 1], Square71x71Logo: [71, 71, 0.6], Square150x150Logo: [150, 150, 0.6], Wide310x150Logo: [310, 150, 0.6], Square310x310Logo: [310, 310, 0.6], StoreLogo: [50, 50, 1], SplashScreen: [620, 300, 0.6] };
      for (const [name, [width, height, share]] of Object.entries(tiles)) for (const scale of SCALES) {
        const w = Math.round(width * scale / 100), h = Math.round(height * scale / 100), size = Math.round(Math.min(w, h) * share);
        await png(path.join(assets, `${name}.scale-${scale}.png`), frame(appIcon(size), w, h, size), w, h);
      }
      await png(path.join(root, 'store', 'microsoft-app-tile-300.png'), art.square, 300);
      for (const size of [1080, 2160]) await png(path.join(root, 'store', `microsoft-box-art-${size}.png`), art.square, size);
      for (const [w, h] of [[720, 1080], [1440, 2160]]) await png(path.join(root, 'store', `microsoft-poster-${w}x${h}.png`), frame(art.freeform, w, h, Math.round(w * 0.62), fill(concept.meta.fill, w, h)), w, h);

      // Linux hicolor theme: bitmaps, scalable source and a recolourable symbolic glyph.
      const hicolor = path.join(root, 'linux', 'hicolor');
      for (const size of [16, 22, 24, 32, 48, 64, 128, 256, 512]) await png(path.join(hicolor, `${size}x${size}`, 'apps', `${settings.appId}.png`), appIcon(size), size);
      await write(path.join(hicolor, 'scalable', 'apps', `${settings.appId}.svg`), art.freeform);
      await write(path.join(hicolor, 'symbolic', 'apps', `${settings.appId}-symbolic.svg`), compose.tray(concept, '#2E3436').replace('width="32" height="32"', 'width="16" height="16"'));

      // App Store marketing icon for the asset-catalog route (opaque; Icon Composer builds supply their own).
      await png(path.join(root, 'store', 'app-store-1024.png'), art.square, 1024);
      console.log(`Rendered ${id} into ${root}`);
      if (settings.install) await install(root, settings.appId);
    }
    if (settings.company) {
      const root = path.join(settings.output, 'company'); await rm(root, { recursive: true, force: true });
      const marks = { 'sk2-badge': company.badge(), 'sk2-square': company.square(), 'sk2-cat': company.cat(), 'sk2-mono': company.mono(), 'sk2-lockup': company.lockup(), 'sk2-lockup-dark': company.lockup({ dark: true }) };
      for (const [name, svg] of Object.entries(marks)) await write(path.join(root, `${name}.svg`), svg);
      for (const size of [512, 1024]) { await png(path.join(root, `sk2-badge-${size}.png`), marks['sk2-badge'], size); await png(path.join(root, `sk2-cat-${size}.png`), marks['sk2-cat'], size); }
      await png(path.join(root, 'google-play-developer-icon-512.png'), marks['sk2-square'], 512);
      await png(path.join(root, 'google-play-developer-header-4096x2304.png'), company.header(), 4096, 2304);
      for (const name of ['sk2-lockup', 'sk2-lockup-dark']) { const [, w, h] = /viewBox="0 0 (\d+) (\d+)"/.exec(marks[name]); await png(path.join(root, `${name}.png`), marks[name], Number(w), Number(h)); }
      await write(path.join(root, 'web', 'favicon.ico'), ico(await Promise.all([16, 32, 48].map(async size => ({ size, data: await raster(marks['sk2-badge'], size) })))));
      await write(path.join(root, 'web', 'favicon.svg'), marks['sk2-badge']);
      await png(path.join(root, 'web', 'apple-touch-icon.png'), marks['sk2-square'], 180);
      for (const size of [192, 512]) await png(path.join(root, 'web', `icon-${size}.png`), marks['sk2-badge'], size);
      console.log(`Rendered company marks into ${root}`);
    }
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
