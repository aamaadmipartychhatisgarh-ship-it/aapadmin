// Browser-side preparation of a photo chosen from the camera or the gallery, so an upload works on every phone:
//  - the file is accepted by its type OR its extension (some Android file managers hand over an EMPTY mime type, and many phones save
//    HEIC/HEIF);
//  - it is decoded, turned upright (camera EXIF orientation), scaled down (long side <= maxDim) and re-encoded as JPEG - a typical
//    phone-camera photo is 3-10 MB, over the server's 5 MB limit;
//  - if the browser cannot decode it, an original JPEG / PNG / WEBP that already fits the limit is sent unchanged.
// Throws an Error whose `code` is "type" | "size" | "decode" so the caller shows the matching message.
const EXT_OK = /\.(jpe?g|png|webp|heic|heif)$/i;
const TYPE_OK = /^image\/(jpeg|png|webp|heic|heif)$/i;
const SERVER_OK = /^image\/(jpeg|png|webp)$/i;
const fail = (code) => Object.assign(new Error(code), { code });

async function decode(file) {
  if (typeof createImageBitmap === "function") {
    try { const bmp = await createImageBitmap(file); return { w: bmp.width, h: bmp.height, draw: (ctx, w, h) => ctx.drawImage(bmp, 0, 0, w, h), done: () => bmp.close?.() }; } catch { /* fall through to <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    return { w: img.naturalWidth, h: img.naturalHeight, draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h), done: () => {} };
  } finally { URL.revokeObjectURL(url); }
}

export async function prepareImageForUpload(file, { maxDim = 1600, quality = 0.85, maxBytes = 5 * 1024 * 1024, maxRawBytes = 40 * 1024 * 1024 } = {}) {
  if (!file) throw fail("type");
  // Neither a known type nor a known extension (e.g. an empty mime type AND a name with no extension): don't refuse yet - if the browser
  // can really decode it as an image it is one; otherwise it is reported as the wrong type below.
  const known = TYPE_OK.test(file.type || "") || EXT_OK.test(file.name || "");
  if (file.size > maxRawBytes) throw fail("size");
  try {
    const src = await decode(file);
    const scale = Math.min(1, maxDim / Math.max(src.w, src.h));
    const w = Math.max(1, Math.round(src.w * scale)), h = Math.max(1, Math.round(src.h * scale));
    const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); // PNG/WEBP transparency -> white, not black, in the JPEG
    src.draw(ctx, w, h); src.done();
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
    if (blob && blob.size > 0 && blob.size <= maxBytes) return blob;
  } catch { /* undecodable here - try the original below */ }
  if (SERVER_OK.test(file.type || "") && file.size <= maxBytes) return file;
  throw fail(!known ? "type" : file.size > maxBytes ? "size" : "decode");
}
