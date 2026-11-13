import assert from 'node:assert/strict';
import test from 'node:test';
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

test('publisher marks are constructed without fonts', () => {
  for (const svg of [company.badge(), company.square(), company.cat(), company.mono(), company.lockup(), company.lockup({ dark: true }), company.header()]) {
    assert.doesNotMatch(svg, /<text|font-family|<image/);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 \d+ \d+"/);
    assert.doesNotMatch(svg, /NaN|undefined/);
  }
  assert.match(company.header(), /viewBox="0 0 4096 2304"/);
});
