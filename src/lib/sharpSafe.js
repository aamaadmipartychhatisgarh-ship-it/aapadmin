// Lazy, optional, memory-bounded access to `sharp`.
//
// `sharp` is a NATIVE module (libvips). A static top-level `import sharp` throws
// at module-evaluation time if the platform binary is missing or incompatible —
// which on some production/shared hosts takes down every route that imports it
// (directly or transitively). Loading it lazily behind a try/catch keeps a bad
// install from crashing the process: the caller just gets null and degrades.
//
// We also bound sharp's resource use the first time it loads: libvips otherwise
// keeps a large decode cache and spins up a worker thread per CPU, which on a
// memory-limited shared host can push the Node process past its RAM/CPU cap
// (a cause of OOM-kills / 504s under a burst of photo or PDF work). cache(false)
// + concurrency(1) keep each image op cheap and serial.

let cached; // undefined = not tried; null = unavailable; fn = the sharp factory

export function getSharp() {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
    const sharp = require("sharp");
    try {
      sharp.cache(false);      // no large persistent decode cache
      sharp.concurrency(1);    // one libvips worker — bounded CPU/RAM per op
    } catch { /* older/newer sharp without these knobs — ignore */ }
    cached = sharp;
  } catch (e) {
    console.error("[sharpSafe] sharp is unavailable — image transcoding will be skipped:", e?.message || e);
    cached = null;
  }
  return cached;
}
