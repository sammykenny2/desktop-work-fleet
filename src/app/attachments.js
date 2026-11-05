import { requireValue } from '../core/contracts.js';
import { t } from '../i18n/index.js';

// A thumbnail is presentation data, never an attachment document or an arbitrary file URL.
export function thumbnailBlob(png) {
  requireValue(typeof png === 'string' && png.length <= 350000 && /^[A-Za-z0-9+/]*={0,2}$/.test(png),
    'attachment-preview', t('notes.errors.thumbnailInvalid'));
  const bytes = Uint8Array.from(atob(png), character => character.charCodeAt(0));
  requireValue([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte),
    'attachment-preview', t('notes.errors.thumbnailInvalid'));
  return new Blob([bytes], { type: 'image/png' });
}

// Every document shares two workers; a wall of papers must not flood the owner's command mailbox.
const waiting = []; let active = 0;
function schedule(action) {
  return new Promise((resolve, reject) => {
    waiting.push({ action, resolve, reject }); drain();
  });
}
function drain() {
  while (active < 2 && waiting.length) {
    const job = waiting.shift(); active++;
    Promise.resolve().then(job.action).then(job.resolve, job.reject).finally(() => { active--; drain(); });
  }
}

// What a browser or phone can draw itself, as those hosts have no thumbnailer; anything it cannot decode keeps its icon.
export async function imageThumbnail(blob, size = 96) {
  try {
    // Decoded small where the engine can, as a phone photo decoded whole takes tens of megabytes.
    const bitmap = await createImageBitmap(blob, { resizeWidth: size, resizeQuality: 'low' }).catch(() => createImageBitmap(blob)); const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close?.();
    return canvas.toDataURL('image/png').split(',')[1];
  } catch { return null; }
}

// A mouse opens a tile with a double click and shows its menu with a right click; a tap shows the menu, as a phone has
// no double click to spare. Without a menu, as on a desktop paper, a tap opens it.
export function renderAttachmentTiles(container, files, { preview, open, report = () => {}, menu = null, details = false }) {
  let closed = false; const urls = []; container.replaceChildren();
  container.classList.add('attachment-tiles');
  for (const file of files) {
    const tile = document.createElement('button'); tile.type = 'button'; tile.className = 'attachment-tile';
    tile.dataset.attachmentId = file.id; tile.title = t(menu ? 'notes.attachment.tileTitleMenu' : 'notes.attachment.tileTitle', { name: file.name });
    tile.setAttribute('aria-label', t('notes.attachment.open', { name: file.name }));
    const image = document.createElement('span'); image.className = 'attachment-icon'; image.textContent = file.name.split('.').at(-1)?.slice(0, 6).toUpperCase() || 'FILE';
    const name = document.createElement('span'); name.className = 'attachment-name'; name.textContent = file.name;
    tile.append(image, name); container.append(tile);
    if (details && file.size) { const size = document.createElement('span'); size.className = 'attachment-size'; size.textContent = t('notes.attachment.size', { size: Math.ceil(file.size / 1024) }); tile.append(size); }
    let opening = false;
    const launch = async () => {
      if (closed || opening) return; opening = true; tile.setAttribute('aria-busy', 'true');
      try { await open(file); } catch (error) { if (!closed) report(error); }
      finally { opening = false; tile.removeAttribute('aria-busy'); }
    };
    let touched = false;
    tile.onpointerdown = event => { touched = event.pointerType === 'touch' || event.pointerType === 'pen'; };
    tile.onclick = event => {
      event.stopPropagation();
      if (event.detail === 0) void launch();
      else if (touched) { if (menu) menu(file, tile); else void launch(); }
    };
    if (menu) tile.oncontextmenu = event => { event.preventDefault(); event.stopPropagation(); menu(file, { x: event.clientX, y: event.clientY }); };
    tile.ondblclick = event => { event.preventDefault(); event.stopPropagation(); if (!touched) void launch(); };
    if (preview) void schedule(async () => {
      if (closed) return;
      const result = await preview(file); if (closed) return;
      if (!result.available) { tile.classList.add('missing'); tile.title = t('notes.attachment.notDownloaded', { name: file.name }); return; }
      if (!result.png) return;
      const url = URL.createObjectURL(thumbnailBlob(result.png)); urls.push(url);
      const thumbnail = document.createElement('img'); thumbnail.src = url; thumbnail.alt = ''; thumbnail.draggable = false;
      thumbnail.onerror = () => thumbnail.replaceWith(image); image.replaceWith(thumbnail);
    }).catch(() => {}); // A failed preview keeps the filename and icon; opening still reports actionable errors.
  }
  return () => { closed = true; for (const url of urls) URL.revokeObjectURL(url); container.replaceChildren(); };
}
