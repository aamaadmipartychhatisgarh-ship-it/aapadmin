import { sniffImage, IMAGE_TYPES } from "@/lib/imageSniff";

// Media uploads (press notes / coverage / brief PDFs) accept documents in
// addition to images. As with images, the REAL type is validated from the
// file's magic bytes — never the client-declared MIME — so a renamed
// executable can't slip through. DOCX is a ZIP container, so it is only
// accepted when the filename also ends in .docx (a bare .zip is rejected).
export const MEDIA_TYPES = {
  ...IMAGE_TYPES, // image/jpeg→jpg, image/png→png, image/webp→webp
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  // Video (press-conference recordings, §10.3). MP4/MOV share the ISO-BMFF
  // "ftyp" header; WEBM is a Matroska/EBML container.
  "video/mp4": "mp4",
  "video/webm": "webm",
};

export function sniffMediaFile(buf, filename = "") {
  const img = sniffImage(buf);
  if (img) return img;
  // PDF: "%PDF"
  if (buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    return "application/pdf";
  }
  // MP4 / MOV (ISO-BMFF): bytes 4-7 spell "ftyp".
  if (buf.length >= 12 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    return "video/mp4";
  }
  // WEBM / Matroska (EBML): 1A 45 DF A3
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return "video/webm";
  }
  // Legacy .doc (OLE2 compound file): D0 CF 11 E0 A1 B1 1A E1
  if (buf.length >= 8 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0 &&
      buf[4] === 0xa1 && buf[5] === 0xb1 && buf[6] === 0x1a && buf[7] === 0xe1) {
    return "application/msword";
  }
  // ZIP container (PK..) — .docx is a zip; require the .docx extension so other
  // zip-based files aren't accepted as documents.
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b &&
      (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07) &&
      (buf[3] === 0x04 || buf[3] === 0x06 || buf[3] === 0x08)) {
    if (/\.docx$/i.test(filename)) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    return null;
  }
  return null;
}
