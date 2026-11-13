/**
 * Compose platform icon SVGs from the layered brand masters in assets/brand. Pure string work with no dependencies;
 * scripts/render-brand-assets.mjs rasterises the results. Each concept directory holds:
 *   concept.json     name, summary, background fill, dark palette, per-platform scale and offset
 *   background.svg   1024 full-bleed backplate
 *   foreground.svg   1024 transparent motif; top-level <g id> groups are layers, data-legacy="true" groups are
 *                    drawn only in pre-rendered PNGs because Icon Composer and launchers add their own depth
 *   monochrome.svg   1024 single-colour silhouette (Android themed icon, tinted appearances)
 *   small.svg        32-unit hand-simplified colour icon for 16-32 px
 *   tray.svg         32-unit black glyph for menu bars, notification areas and symbolic icons
 */
import { readFile, readdir } from 'node:fs/promises';

export const brandRoot = new URL('../assets/brand/', import.meta.url);
const LAYERS = ['background', 'foreground', 'monochrome', 'small', 'tray'];

export async function listConcepts() {
  const entries = await readdir(new URL('concepts/', brandRoot), { withFileTypes: true });
  return entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
}

export async function loadConcept(id) {
  const directory = new URL(`concepts/${id}/`, brandRoot), concept = { id, directory };
  concept.meta = JSON.parse(await readFile(new URL('concept.json', directory), 'utf8'));
  for (const layer of LAYERS) concept[layer] = await readFile(new URL(`${layer}.svg`, directory), 'utf8');
  return concept;
}

/** The markup between the outer <svg> tags, with comments removed and every id made unique to `prefix`. */
export function inner(svg, prefix) {
  let body = svg.replace(/<!--[\s\S]*?-->/g, '').replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  if (prefix) body = body.replace(/\bid="([^"]+)"/g, `id="${prefix}-$1"`).replace(/url\(#([^)]+)\)/g, `url(#${prefix}-$1)`).replace(/href="#([^"]+)"/g, `href="#${prefix}-$1"`);
  return body.trim();
}

/** Top-level <g> groups of a layer file, in drawing order. Groups must not nest other <g> elements. */
export function groups(svg) {
  return [...inner(svg).matchAll(/<g\b([^>]*)>([\s\S]*?)<\/g>/g)].map(([markup, attributes]) => ({
    id: /\bid="([^"]+)"/.exec(attributes)?.[1], legacy: /data-legacy="true"/.test(attributes), markup,
  }));
}

export const withoutLegacy = svg => svg.replace(/<g\b[^>]*data-legacy="true"[^>]*>[\s\S]*?<\/g>/g, '');

export function recolor(svg, map = {}) {
  let result = svg;
  for (const [from, to] of Object.entries(map)) result = result.replace(new RegExp(from.replace('#', '#?'), 'gi'), to);
  return result;
}

const document = (body, size = 1024, defs = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>\n`;
const place = (body, scale = 1, [dx, dy] = [0, 0], centre = 512) =>
  `<g transform="translate(${centre + dx} ${centre + dy}) scale(${scale}) translate(${-centre} ${-centre})">${body}</g>`;
const gradient = (id, { top, bottom }) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`;
/** Repaint everything a group draws in one colour, keeping its alpha. */
const paint = (id, colour) => `<filter id="${id}" color-interpolation-filters="sRGB"><feFlood flood-color="${colour}"/><feComposite in2="SourceAlpha" operator="in"/></filter>`;
const shadow = (id, dy, blur, opacity) => `<filter id="${id}" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="${dy}" stdDeviation="${blur}" flood-color="#000" flood-opacity="${opacity}"/></filter>`;

/** Superellipse close to Apple's continuous-corner icon shape. */
export function squircle(size = 824, centre = 512, exponent = 5, steps = 256) {
  const half = size / 2, points = [];
  for (let index = 0; index < steps; index++) {
    const angle = (index / steps) * 2 * Math.PI, cos = Math.cos(angle), sin = Math.sin(angle);
    points.push([centre + half * Math.sign(cos) * Math.abs(cos) ** (2 / exponent), centre + half * Math.sign(sin) * Math.abs(sin) ** (2 / exponent)]);
  }
  return `M${points.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join('L')}Z`;
}

function foreground(concept, platform, { dark = false, legacy = true } = {}) {
  let body = inner(concept.foreground, `${concept.id}-fg`);
  if (!legacy) body = withoutLegacy(body);
  if (dark) body = recolor(body, concept.meta.darkColors);
  return place(body, concept.meta.scale[platform], concept.meta.offset?.[platform]);
}
const background = (concept, dark = false) => dark
  ? `<rect width="1024" height="1024" fill="url(#${concept.id}-dark-fill)"/>`
  : inner(concept.background, `${concept.id}-bg`);

export const compose = {
  /** Full-bleed opaque square: iOS light, App Store, Google Play and store marketing art. */
  square: (concept, { dark = false } = {}) =>
    document(background(concept, dark) + foreground(concept, 'ios', { dark }), 1024, gradient(`${concept.id}-dark-fill`, concept.meta.darkFill)),
  /** iOS 18-25 dark appearance: motif on transparency; the system supplies the dark backdrop. */
  iosDark: concept => document(foreground(concept, 'ios', { dark: true })),
  /** iOS 18-25 tinted appearance: light grey silhouette on black; the system applies the tint. */
  iosTinted: concept => document(`<rect width="1024" height="1024" fill="#000"/><g filter="url(#${concept.id}-tint)">${place(inner(concept.monochrome, `${concept.id}-mono`), concept.meta.scale.ios, concept.meta.offset?.ios)}</g>`, 1024, paint(`${concept.id}-tint`, '#E6E6E6')),
  /** macOS 13-25 pre-rendered icon: 824 continuous-corner body on a 1024 canvas with the system drop shadow. */
  macos: (concept, { dark = false } = {}) => {
    const id = concept.id, defs = `<clipPath id="${id}-mac-clip"><path d="${squircle()}"/></clipPath>${shadow(`${id}-mac-shadow`, 10, 12, 0.3)}${gradient(`${id}-dark-fill`, concept.meta.darkFill)}`;
    return document(`<path d="${squircle()}" fill="#000" filter="url(#${id}-mac-shadow)"/><g clip-path="url(#${id}-mac-clip)">${background(concept, dark)}${place(foreground(concept, 'macos', { dark }), 824 / 1024)}</g>`, 1024, defs);
  },
  /** macOS 16 and 32 px frames: the same body with the hand-simplified motif. */
  macosSmall: concept => {
    const id = concept.id, defs = `<clipPath id="${id}-macs-clip"><path d="${squircle(30, 16, 5, 96)}"/></clipPath>`;
    return document(`<g clip-path="url(#${id}-macs-clip)">${inner(concept.background, `${id}-bgs`).replace('width="1024" height="1024"', 'width="32" height="32"')}${place(inner(concept.small, `${id}-sm`), 0.8, [0, 0], 16)}</g>`, 32, defs);
  },
  /** Android adaptive layers on the 108 dp canvas (1024 units); the launcher masks and adds depth. */
  androidBackground: concept => document(background(concept)),
  androidForeground: concept => document(foreground(concept, 'android', { legacy: false })),
  androidMonochrome: concept => document(place(inner(concept.monochrome, `${concept.id}-mono`), concept.meta.scale.android, concept.meta.offset?.android)),
  /** Free-form motif without a backplate: Windows app icon and tiles, Linux hicolor icons. */
  freeform: (concept, { dark = false } = {}) => {
    // An ink outline keeps light paper above 3:1 contrast on light Windows and GNOME surfaces.
    const id = `${concept.id}-free`, ink = concept.meta.ink ?? concept.meta.fill.bottom;
    const outline = `<filter id="${id}-outline" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB"><feMorphology in="SourceAlpha" operator="dilate" radius="14" result="grown"/><feFlood flood-color="${ink}"/><feComposite in2="grown" operator="in" result="edge"/><feMerge><feMergeNode in="edge"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
    return document(`<g filter="url(#${id}-shadow)"><g filter="url(#${id}-outline)">${foreground(concept, 'freeform', { dark, legacy: false })}</g></g>`, 1024, outline + shadow(`${id}-shadow`, 16, 18, 0.28));
  },
  small: concept => concept.small,
  tray: (concept, colour = '#000') => concept.tray.replace(/#000\b/g, colour),
  /** Layer files for an Icon Composer document: flat art only, no legacy shadows. */
  iconLayers: concept => groups(concept.foreground).filter(group => !group.legacy).map(group => ({
    name: group.id, svg: document(place(group.markup, concept.meta.scale.ios, concept.meta.offset?.ios)),
  })),
};

const srgb = hex => `srgb:${[1, 3, 5].map(index => (parseInt(hex.slice(index, index + 2), 16) / 255).toFixed(5)).join(',')},1.00000`;
const linear = ({ top, bottom }) => ({ 'linear-gradient': [srgb(top), srgb(bottom)], orientation: { start: { x: 0.5, y: 0 }, stop: { x: 0.5, y: 1 } } });

/**
 * icon.json for an Icon Composer document. Groups are listed front to back, one layer each, with the system's glass,
 * neutral shadow and translucency; the dark appearance swaps the backplate for the concept's dark fill.
 */
export function iconDocument(concept) {
  const layers = compose.iconLayers(concept).reverse();
  return {
    fill: linear(concept.meta.fill),
    'fill-specializations': [{ appearance: 'dark', value: linear(concept.meta.darkFill) }],
    groups: layers.map(layer => ({
      layers: [{ 'image-name': `${layer.name}.svg`, name: layer.name, glass: true }],
      shadow: { kind: 'neutral', opacity: 0.5 },
      translucency: { enabled: true, value: 0.4 },
    })),
    'supported-platforms': { squares: 'shared' },
  };
}

