import { requireValue } from '../core/contracts.js';

// A thumbnail is presentation data, never an attachment document or an arbitrary file URL.
export function thumbnailBlob(png) {
  requireValue(typeof png === 'string' && png.length <= 350000 && /^[A-Za-z0-9+/]*={0,2}$/.test(png),
    'attachment-preview', '附件縮圖格式無效。');
  const bytes = Uint8Array.from(atob(png), character => character.charCodeAt(0));
  requireValue([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte),
    'attachment-preview', '附件縮圖格式無效。');
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

export function renderAttachmentTiles(container, files, { preview, open, report = () => {} }) {
  let closed = false; const urls = []; container.replaceChildren();
  container.classList.add('attachment-tiles');
  for (const file of files) {
    const tile = document.createElement('button'); tile.type = 'button'; tile.className = 'attachment-tile';
    tile.dataset.attachmentId = file.id; tile.title = `${file.name}｜雙擊開啟附件副本；外部修改不會回存便箋`;
    tile.setAttribute('aria-label', `開啟附件 ${file.name}`);
    const image = document.createElement('span'); image.className = 'attachment-icon'; image.textContent = file.name.split('.').at(-1)?.slice(0, 6).toUpperCase() || 'FILE';
    const name = document.createElement('span'); name.className = 'attachment-name'; name.textContent = file.name;
    tile.append(image, name); container.append(tile);
    let opening = false;
    const launch = async () => {
      if (closed || opening) return; opening = true; tile.setAttribute('aria-busy', 'true');
      try { await open(file); } catch (error) { if (!closed) report(error); }
      finally { opening = false; tile.removeAttribute('aria-busy'); }
    };
    tile.onclick = event => { event.stopPropagation(); if (event.detail === 0) void launch(); };
    tile.ondblclick = event => { event.preventDefault(); event.stopPropagation(); void launch(); };
    if (preview) void schedule(async () => {
      if (closed) return;
      const result = await preview(file); if (closed) return;
      if (!result.available) { tile.classList.add('missing'); tile.title = `${file.name}（尚未下載）`; return; }
      if (!result.png) return;
      const url = URL.createObjectURL(thumbnailBlob(result.png)); urls.push(url);
      const thumbnail = document.createElement('img'); thumbnail.src = url; thumbnail.alt = ''; thumbnail.draggable = false;
      thumbnail.onerror = () => thumbnail.replaceWith(image); image.replaceWith(thumbnail);
    }).catch(() => {}); // A failed preview keeps the filename and icon; opening still reports actionable errors.
  }
  return () => { closed = true; for (const url of urls) URL.revokeObjectURL(url); container.replaceChildren(); };
}
