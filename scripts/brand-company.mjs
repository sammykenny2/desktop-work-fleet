/**
 * Publisher marks for sammykenny2.dev. Letters are constructed here as monoline strokes (no font files), so the
 * artwork is repository-owned. Used by scripts/render-brand-assets.mjs; no dependencies.
 */
const PALETTE = { ink: '#16202C', paper: '#FFF4D9', accent: '#EE5A3C', line: '#FFF4D9' };
const f = value => Number(value.toFixed(2));
const point = (cx, cy, rx, ry, degrees) => [f(cx + rx * Math.cos(degrees * Math.PI / 180)), f(cy + ry * Math.sin(degrees * Math.PI / 180))];

/** Glyphs with the baseline at y = 0 and the left edge of the ink at x = 0. Each returns { d, width }. */
function glyph(character, { cap, x: xHeight, ascender, descender, stroke: s }) {
  const h = s / 2;
  const ellipseS = (height, width) => {
    const rx = (width - s) / 2, ry = (height - s) / 4, cx = width / 2, top = -height + h + ry, bottom = top + 2 * ry;
    const [x1, y1] = point(cx, top, rx, ry, -28), [x2, y2] = point(cx, bottom, rx, ry, 152);
    return `M${x1} ${y1}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx)} ${f(top + ry)}A${f(rx)} ${f(ry)} 0 1 1 ${x2} ${y2}`;
  };
  const bowl = (height, stemTop) => {
    const r = (xHeight - s) / 2, cx = h + r, cy = -xHeight / 2;
    return { d: `M${f(cx + r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 0 ${f(cx - r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 0 ${f(cx + r)} ${f(cy)}M${f(cx + r)} ${f(stemTop)}V${f(-h)}`, width: 2 * r + s };
  };
  const arches = count => {
    const r = xHeight * 0.36, top = -xHeight + h + r; let d = `M${h} ${-h}V${f(top)}`;
    for (let index = 0; index < count; index++) d += `${index ? `M${f(h + 2 * r * index)} ${f(top)}` : ''}A${f(r)} ${f(r)} 0 0 1 ${f(h + 2 * r * (index + 1))} ${f(top)}V${-h}`;
    return { d, width: 2 * r * count + s };
  };
  switch (character) {
    case 'S': { const width = cap * 0.6; return { d: ellipseS(cap, width), width }; }
    case 's': { const width = xHeight * 0.82; return { d: ellipseS(xHeight, width), width }; }
    case 'K': case 'k': {
      const height = character === 'K' ? cap : ascender, width = character === 'K' ? cap * 0.6 : xHeight * 0.86, armTop = character === 'K' ? -cap + h : -xHeight + h;
      const joint = [h, character === 'K' ? -cap * 0.36 : -xHeight * 0.34], end = [width - h, armTop];
      const leg = [f(joint[0] + (end[0] - joint[0]) * 0.38), f(joint[1] + (end[1] - joint[1]) * 0.38)];
      return { d: `M${h} ${f(-height + h)}V${-h}M${end[0]} ${end[1]}L${joint[0]} ${f(joint[1])}M${leg[0]} ${leg[1]}L${f(width - h)} ${-h}`, width };
    }
    case '2': {
      const height = cap, width = cap * 0.6, rx = (width - s) / 2, ry = (height - s) * 0.29, cx = width / 2, cy = -height + h + ry;
      const [x1, y1] = point(cx, cy, rx, ry, 198), [x2, y2] = point(cx, cy, rx, ry, 28);
      return { d: `M${x1} ${y1}A${f(rx)} ${f(ry)} 0 1 1 ${x2} ${y2}L${h} ${-h}H${f(width - h)}`, width };
    }
    case 'a': return bowl(xHeight, -xHeight + h);
    case 'd': return bowl(xHeight, -ascender + h);
    case 'e': {
      const r = (xHeight - s) / 2, cx = h + r, cy = -xHeight / 2, [x2, y2] = point(cx, cy, r, r, 42);
      return { d: `M${h} ${f(cy)}H${f(cx + r)}A${f(r)} ${f(r)} 0 1 0 ${x2} ${y2}`, width: 2 * r + s };
    }
    case 'm': return arches(2);
    case 'n': return arches(1);
    case 'v': { const width = xHeight * 0.9; return { d: `M${h} ${f(-xHeight + h)}L${f(width / 2)} ${-h}L${f(width - h)} ${f(-xHeight + h)}`, width }; }
    case 'y': {
      const width = xHeight * 0.9, top = -xHeight + h, slope = (width / 2 - (width - h)) / (xHeight - h), bottom = descender - h;
      return { d: `M${h} ${f(top)}L${f(width / 2)} ${-h}M${f(width - h)} ${f(top)}L${f(width / 2 + slope * (bottom + h))} ${f(bottom)}`, width };
    }
    case '.': return { d: `M${h} ${-h}h0.01`, width: s };
    default: throw new Error(`No glyph for ${character}`);
  }
}

/** Lay out text; returns stroked groups so callers can colour individual characters. */
function setText(text, metrics, { tracking = metrics.stroke * 0.9, colours = [] } = {}) {
  let x = 0; const parts = [];
  [...text].forEach((character, index) => {
    const { d, width } = glyph(character, metrics);
    parts.push({ d, x, colour: colours[index] }); x += width + tracking;
  });
  return { parts, width: x - tracking };
}
const strokes = (parts, colour, stroke, dx = 0, dy = 0) => parts.map(part =>
  `<path transform="translate(${f(part.x + dx)} ${f(dy)})" d="${part.d}" fill="none" stroke="${part.colour ?? colour}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>`).join('');

const svg = (width, height, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${body}</svg>\n`;

/** "SK2" set inside a 1024 square, centred, letters cream with the 2 in the accent colour. */
function monogram({ cap = 330, stroke = 78, centre = [512, 512], paper = PALETTE.paper, accent = PALETTE.accent } = {}) {
  const metrics = { cap, x: cap, ascender: cap, descender: 0, stroke }, text = setText('SK2', metrics, { tracking: stroke * 0.95, colours: [paper, paper, accent] });
  return strokes(text.parts, paper, stroke, centre[0] - text.width / 2, centre[1] + cap / 2);
}

export const company = {
  palette: PALETTE,
  /** Rounded-square badge: avatars, Play developer icon, favicons. */
  badge: ({ plate = true } = {}) => svg(1024, 1024, `${plate ? `<rect width="1024" height="1024" rx="230" fill="${PALETTE.ink}"/>` : ''}${monogram()}`),
  /** Full-bleed square for services that apply their own mask (Play developer icon, GitHub avatar). */
  square: () => svg(1024, 1024, `<rect width="1024" height="1024" fill="${PALETTE.ink}"/>${monogram({ cap: 300, stroke: 72 })}`),
  /** Cat-eared badge that echoes the cat-led product family. */
  cat: () => svg(1024, 1024, `<path fill="${PALETTE.ink}" d="M112 400L150 132Q160 76 206 112L380 250H644L818 112Q864 76 874 132L912 400V820Q912 912 820 912H204Q112 912 112 820Z"/>${monogram({ cap: 300, stroke: 72, centre: [512, 590] })}`),
  /** One-colour mark for embossing, watermarks and dark-on-light print. */
  mono: (colour = '#000') => svg(1024, 1024, monogram({ paper: colour, accent: colour })),
  /** Monogram badge plus the domain, on a transparent canvas; the dark version inverts the badge. */
  lockup: ({ dark = false } = {}) => {
    const { body, width, height } = lockup(dark);
    return svg(width, height, body);
  },
  /** Google Play developer page header: 4096 x 2304, opaque, content kept to the centre 64% for device crops. */
  header: () => {
    const { body, width, height } = lockup(true), scale = (4096 * 0.64) / width;
    return svg(4096, 2304, `<rect width="4096" height="2304" fill="${PALETTE.ink}"/><g transform="translate(${f((4096 - width * scale) / 2)} ${f((2304 - height * scale) / 2)}) scale(${f(scale)})">${body}</g>`);
  },
};

function lockup(dark) {
  const stroke = 44, metrics = { cap: 330, x: 220, ascender: 330, descender: 110, stroke }, margin = 20, badgeSize = 360;
  const words = setText('sammykenny2.dev', metrics, { colours: Object.assign([], { 10: PALETTE.accent, 11: PALETTE.accent }) });
  const plate = dark ? PALETTE.paper : PALETTE.ink, letters = dark ? PALETTE.ink : PALETTE.paper;
  // The x-height is centred on the badge; ascenders (k, 2, d) and the y descender reach beyond it, so they set the height.
  const half = Math.max(badgeSize / 2, metrics.ascender - metrics.x / 2, metrics.descender + metrics.x / 2), centre = margin + half;
  const badge = `<g transform="translate(${margin} ${f(centre - badgeSize / 2)}) scale(${f(badgeSize / 1024)})"><rect width="1024" height="1024" rx="230" fill="${plate}"/>${monogram({ paper: letters })}</g>`;
  const left = margin + badgeSize + 64, baseline = centre + metrics.x / 2;
  return { body: `${badge}${strokes(words.parts, dark ? PALETTE.paper : PALETTE.ink, stroke, left, baseline)}`, width: Math.ceil(left + words.width + stroke / 2 + margin), height: Math.ceil(2 * centre) };
}
