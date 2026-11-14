import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compose, groups, iconDocument, listConcepts, loadConcept } from '../scripts/brand-assets.mjs';
import { company } from '../scripts/brand-company.mjs';

const concepts = await Promise.all((await listConcepts()).map(loadConcept));
const ids = markup => [...markup.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
const references = markup => [...markup.matchAll(/(?:url\(#|href="#)([^)"]+)/g)].map(match => match[1]);

test('every concept has its metadata and layer files', () => {
  assert.ok(concepts.length >= 1);
  for (const concept of concepts) {
    const { meta } = concept;
    assert.ok(meta.name && meta.summary, concept.id);
    for (const key of ['fill', 'darkFill']) assert.match(`${meta[key].top}${meta[key].bottom}`, /^#[0-9A-F]{6}#[0-9A-F]{6}$/i, `${concept.id} ${key}`);
    for (const platform of ['ios', 'macos', 'android', 'freeform']) assert.equal(typeof meta.scale[platform], 'number', `${concept.id} ${platform}`);
    for (const layer of ['background', 'foreground', 'monochrome']) assert.match(concept[layer], /viewBox="0 0 1024 1024"/, `${concept.id} ${layer}`);
    for (const layer of ['small', 'tray']) assert.match(concept[layer], /viewBox="0 0 32 32"/, `${concept.id} ${layer}`);
  }
});

test('composed icons are self-contained and every reference resolves', () => {
  for (const concept of concepts) {
    const outputs = { square: compose.square(concept), dark: compose.square(concept, { dark: true }), iosDark: compose.iosDark(concept), iosTinted: compose.iosTinted(concept),
      macos: compose.macos(concept), macosSmall: compose.macosSmall(concept), freeform: compose.freeform(concept), foreground: compose.androidForeground(concept),
      background: compose.androidBackground(concept), monochrome: compose.androidMonochrome(concept) };
    for (const [name, svg] of Object.entries(outputs)) {
      assert.doesNotMatch(svg, /(?:href|src)="(?:https?:|file:|data:)|<text|<image|@import/, `${concept.id} ${name} must not load fonts or external art`);
      const defined = ids(svg);
      assert.equal(new Set(defined).size, defined.length, `${concept.id} ${name} has duplicate ids`);
      for (const reference of references(svg)) assert.ok(defined.includes(reference), `${concept.id} ${name} references missing #${reference}`);
    }
    assert.doesNotMatch(outputs.foreground, /data-legacy/, `${concept.id} adaptive foreground must leave shadows to the launcher`);
  }
});

test('Icon Composer documents follow the layer limits', () => {
  for (const concept of concepts) {
    const document = iconDocument(concept), layers = compose.iconLayers(concept);
    assert.ok(document.groups.length >= 1 && document.groups.length <= 4, `${concept.id} needs one to four groups`);
    assert.deepEqual(document.groups.map(group => group.layers[0]['image-name']), layers.map(layer => `${layer.name}.svg`).reverse());
    assert.equal(new Set(layers.map(layer => layer.name)).size, layers.length);
    for (const layer of layers) {
      assert.doesNotMatch(layer.svg, /data-legacy|filter|Gradient|fill-opacity/, `${concept.id} ${layer.name} must leave depth to Icon Composer`);
    }
    assert.ok(groups(concept.foreground).every(group => group.id), `${concept.id} foreground groups need ids`);
  }
});

test('tray glyphs are filled black shapes that hosts can recolour', () => {
  for (const concept of concepts) {
    assert.doesNotMatch(concept.tray, /stroke/, `${concept.id} tray must not use strokes (GNOME recolours fills)`);
    const colours = new Set([...concept.tray.matchAll(/fill="([^"]+)"/g)].map(match => match[1].toUpperCase()));
    assert.deepEqual([...colours], ['#000'], concept.id);
    assert.match(compose.tray(concept, '#FFFFFF'), /fill="#FFFFFF"/);
  }
});

test('the installed app and tray icons are complete at the sizes each project reads', async () => {
  const at = relative => fileURLToPath(new URL(`../${relative}`, import.meta.url));
  const pixels = async relative => {
    const data = await readFile(at(relative));
    assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${relative} is a PNG`);
    return [data.readUInt32BE(16), data.readUInt32BE(20)];
  };
  // Apple asset catalogs: every listed file exists at size x scale; iOS carries the dark and tinted appearances.
  const apple = 'src/native/apple/resources';
  for (const [platform, count] of [['ios', 3], ['macos', 10]]) {
    const set = `${apple}/${platform}-Icons.xcassets/AppIcon.appiconset`, { images } = JSON.parse(await readFile(at(`${set}/Contents.json`), 'utf8'));
    assert.equal(images.length, count, platform);
    for (const image of images) {
      const side = Number(image.size.split('x')[0]) * Number((image.scale ?? '1x').replace('x', ''));
      assert.deepEqual(await pixels(`${set}/${image.filename}`), [side, side], `${platform} ${image.filename}`);
    }
    if (platform === 'ios') assert.deepEqual(images.map(image => image.appearances?.[0].value ?? 'any'), ['any', 'dark', 'tinted']);
  }
  const status = `${apple}/macos-Icons.xcassets/StatusItem.imageset`, statusSet = JSON.parse(await readFile(at(`${status}/Contents.json`), 'utf8'));
  assert.equal(statusSet.properties['template-rendering-intent'], 'template');
  assert.doesNotMatch(await readFile(at(`${status}/${statusSet.images[0].filename}`), 'utf8'), /stroke/);
  assert.match(await readFile(at('src/native/apple/macos/Main.swift'), 'utf8'), /NSImage\(named: "StatusItem"\)/);
  // Android adaptive icon: the manifest's mipmaps exist, with every layer at 108 dp in each density.
  const res = 'src/native/android/app/src/main/res', manifest = await readFile(at('src/native/android/app/src/main/AndroidManifest.xml'), 'utf8');
  assert.match(manifest, /android:icon="@mipmap\/ic_launcher"/); assert.match(manifest, /android:roundIcon="@mipmap\/ic_launcher_round"/);
  for (const name of ['ic_launcher', 'ic_launcher_round']) {
    const adaptive = await readFile(at(`${res}/mipmap-anydpi/${name}.xml`), 'utf8');
    assert.deepEqual([...adaptive.matchAll(/@mipmap\/(\w+)/g)].map(match => match[1]), ['ic_launcher_background', 'ic_launcher_foreground', 'ic_launcher_monochrome']);
  }
  for (const [density, factor] of Object.entries({ mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }))
    for (const layer of ['background', 'foreground', 'monochrome'])
      assert.deepEqual(await pixels(`${res}/mipmap-${density}/ic_launcher_${layer}.png`), [108 * factor, 108 * factor], `${density} ${layer}`);
  // Windows: the embedded icon (executable, windows and tray) and the MSIX images. Each frame's PNG must be drawn at the
  // size its directory entry declares: Windows takes the 16-32 px frame for the notification area and scales whatever
  // it finds there, so a 256 px image in every slot draws a shrunken, blurred icon.
  const ico = await readFile(at('src/native/windows/app/PinItAnywhere.ico')), entries = ico.readUInt16LE(4);
  const frames = Array.from({ length: entries }, (_, index) => {
    const entry = 6 + 16 * index, length = ico.readUInt32LE(entry + 8), offset = ico.readUInt32LE(entry + 12), size = ico[entry] || 256;
    const data = ico.subarray(offset, offset + length);
    assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `ICO frame ${size} is a PNG`);
    assert.deepEqual([data.readUInt32BE(16), data.readUInt32BE(20)], [size, size], `ICO frame ${size} is drawn at its declared size`);
    return { size, data: data.toString('base64') };
  });
  assert.deepEqual(frames.map(frame => frame.size), [16, 20, 24, 32, 40, 48, 64, 256]);
  assert.equal(new Set(frames.map(frame => frame.data)).size, frames.length, 'every ICO frame is its own image');
  for (const [name, side] of [['Square44x44Logo', 44], ['Square150x150Logo', 150], ['StoreLogo', 50]])
    assert.deepEqual(await pixels(`src/native/windows/package-assets/${name}.png`), [side, side], name);
  // The taskbar and Start take these through resources.pri; without an unplated image Windows plates the icon in the
  // accent colour. Light-theme surfaces look for the lightunplated form first.
  for (const size of [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256]) for (const form of ['unplated', 'lightunplated']) {
    const name = `Square44x44Logo.targetsize-${size}_altform-${form}.png`;
    assert.deepEqual(await pixels(`src/native/windows/package-assets/${name}`), [size, size], name);
  }
  // Linux: a hicolor theme under the fixed name that packaging renames to the app ID.
  const theme = 'src/native/linux/icons/hicolor';
  for (const side of [16, 22, 24, 32, 48, 64, 128, 256, 512]) assert.deepEqual(await pixels(`${theme}/${side}x${side}/apps/app-icon.png`), [side, side]);
  assert.match(await readFile(at(`${theme}/scalable/apps/app-icon.svg`), 'utf8'), /^<svg /);
  assert.doesNotMatch(await readFile(at(`${theme}/symbolic/apps/app-icon-symbolic.svg`), 'utf8'), /stroke/);
});

test('pixel-grid icons fill their grid on whole pixels in the small icon\'s palette', () => {
  const fills = svg => new Set([...svg.matchAll(/fill="([^"]+)"/g)].map(match => match[1].toUpperCase()));
  const selected = concepts.find(concept => concept.id === 'cat-note');
  assert.deepEqual(Object.keys(selected.pixel).map(Number), [16, 20, 24, 30, 36], 'the selected concept draws every Windows grid');
  for (const concept of concepts) for (const [grid, svg] of Object.entries(concept.pixel)) {
    const name = `${concept.id} pixel-${grid}`;
    assert.match(svg, new RegExp(`viewBox="0 0 ${grid} ${grid}" width="${grid}" height="${grid}"`), name);
    // Every coordinate, size and arc radius is a whole number, so each edge lands on a pixel boundary at 1x and 2x.
    const shapes = svg.replace(/<!--[\s\S]*?-->/g, '').replace(/^<svg[^>]*>/, '');
    for (const [, value] of shapes.matchAll(/\b(?:d|x|y|width|height)="([^"]+)"/g))
      for (const number of value.match(/-?\d*\.?\d+/g) ?? []) assert.ok(Number.isInteger(Number(number)), `${name} has an off-grid value ${number}`);
    // It fills the cell from top to bottom, like other notification-area icons.
    assert.match(svg, new RegExp(`<path fill="[^"]+" d="M\\d+ ${grid}V`), `${name} reaches the bottom edge`);
    assert.match(svg, /L\d+ 0L/, `${name} reaches the top edge`);
    // The palette follows small.svg, so a colour revision has to reach these drawings too.
    assert.deepEqual([...fills(svg)].sort(), [...fills(concept.small)].sort(), `${name} uses the small icon's colours`);
    assert.equal(compose.pixel(concept, Number(grid)), svg);
  }
  assert.equal(compose.pixel(selected, 32), selected.pixel[16], '32 px doubles the 16 px drawing');
  assert.equal(compose.pixel(selected, 60), selected.pixel[30], 'the largest dividing grid wins');
  assert.equal(compose.pixel(selected, 72), selected.pixel[36]);
  assert.equal(compose.pixel(selected, 28), undefined);
});

test('the app sidebar mark is the selected concept\'s small icon', async () => {
  // ADR-069 selects cat-note; the sidebar draws its 32-unit art inline, so a source change must reach index.html too.
  const shapes = svg => (svg.match(/<(?:path|rect|circle|ellipse)\b[^>]*\/>/g) ?? []).map(shape => shape.replace(/\s+/g, ' '));
  const html = await readFile(fileURLToPath(new URL('../src/app/index.html', import.meta.url)), 'utf8');
  const mark = /<span class="brand-mark" aria-hidden="true">(<svg viewBox="0 0 32 32"[\s\S]*?<\/svg>)<\/span>/.exec(html);
  assert.ok(mark, 'index.html draws the brand mark as an inline 32-unit SVG');
  assert.deepEqual(shapes(mark[1]), shapes((await loadConcept('cat-note')).small));
});

test('publisher marks are constructed without fonts', () => {
  for (const svg of [company.badge(), company.square(), company.cat(), company.mono(), company.lockup(), company.lockup({ dark: true }), company.header()]) {
    assert.doesNotMatch(svg, /<text|font-family|<image/);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 \d+ \d+"/);
    assert.doesNotMatch(svg, /NaN|undefined/);
  }
  assert.match(company.header(), /viewBox="0 0 4096 2304"/);
});

test('publisher letters, with half their stroke, stay inside the canvas', () => {
  // Vertices of the absolute M, L, V, H and A commands; ascender, cap and descender extremes are all path vertices.
  const extents = (d, dx, dy) => {
    const xs = [], ys = [];
    for (const [, command, list] of d.matchAll(/([MLVHA])([^A-Za-z]*)/g)) {
      const values = list.trim().split(/[\s,]+/).filter(Boolean).map(Number);
      if (command === 'V') ys.push(...values); else if (command === 'H') xs.push(...values);
      else for (let index = 0; index < values.length; index += command === 'A' ? 7 : 2) {
        const pair = command === 'A' ? values.slice(index + 5, index + 7) : values.slice(index, index + 2);
        xs.push(pair[0]); ys.push(pair[1]);
      }
    }
    return { xs: xs.map(x => x + dx), ys: ys.map(y => y + dy) };
  };
  const marks = { badge: company.badge(), square: company.square(), cat: company.cat(), mono: company.mono(), lockup: company.lockup(), 'lockup-dark': company.lockup({ dark: true }) };
  for (const [name, svg] of Object.entries(marks)) {
    const [, width, height] = /viewBox="0 0 (\d+) (\d+)"/.exec(svg).map(Number);
    // The lockup's badge is a scaled copy of the badge mark, which is checked on its own.
    const letters = svg.replace(/<g transform="[^"]*scale\([^"]*">.*?<\/g>/s, '');
    let checked = 0;
    for (const [, dx, dy, d, stroke] of letters.matchAll(/<path transform="translate\(([-\d.]+) ([-\d.]+)\)" d="([^"]+)" fill="none" stroke="[^"]+" stroke-width="([\d.]+)"/g)) {
      const { xs, ys } = extents(d, Number(dx), Number(dy)), half = Number(stroke) / 2;
      assert.ok(Math.min(...xs) - half >= 0 && Math.max(...xs) + half <= width, `${name} letters overflow horizontally`);
      assert.ok(Math.min(...ys) - half >= 0 && Math.max(...ys) + half <= height, `${name} letters are clipped at the top or bottom`);
      checked++;
    }
    assert.ok(checked >= 3, `${name} has stroked letters`);
  }
});
