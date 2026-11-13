/** Per-device starting sizes. Placed papers keep their geometry until an explicit layout reset or resize. */
export const paperSizes = Object.freeze({
  small: Object.freeze({ width: 160, height: 160 }),
  medium: Object.freeze({ width: 240, height: 240 }),
  large: Object.freeze({ width: 320, height: 320 }),
  tall: Object.freeze({ width: 320, height: 480 }),
});

export const validPaperSize = value => typeof value === 'string' && Object.hasOwn(paperSizes, value);
export const newPaperSize = layout => validPaperSize(layout.newPaperSize) ? layout.newPaperSize : 'medium';
export const paperDimensions = layout => ({ ...paperSizes[newPaperSize(layout)] });
