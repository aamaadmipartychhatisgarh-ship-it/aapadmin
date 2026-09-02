"use client";

// Client-only helpers to snapshot on-screen visualizations (charts/maps) into
// raster images that @react-pdf/renderer can embed, so a chart never lands in the
// PDF blank. Dependency-free: it serializes the live <svg> nodes (Recharts renders
// SVG) to PNG via an offscreen canvas. Anything that can't be captured is skipped
// rather than throwing, so a partial page still exports.

// Serialize one <svg> element to a PNG data URI. Scaled up for crisp text.
function svgToPng(svg, scale = 2) {
  return new Promise((resolve) => {
    try {
      const rect = svg.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width || svg.viewBox?.baseVal?.width || 600));
      const height = Math.max(1, Math.round(rect.height || svg.viewBox?.baseVal?.height || 300));

      const clone = svg.cloneNode(true);
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("width", String(width));
      clone.setAttribute("height", String(height));
      // Give the SVG an opaque white ground so dark text stays legible on the PDF.
      const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      bg.setAttribute("x", "0"); bg.setAttribute("y", "0");
      bg.setAttribute("width", String(width)); bg.setAttribute("height", String(height));
      bg.setAttribute("fill", "#ffffff");
      clone.insertBefore(bg, clone.firstChild);

      const xml = new XMLSerializer().serializeToString(clone);
      const svg64 = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = width * scale;
          canvas.height = height * scale;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/png"));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = svg64;
    } catch {
      resolve(null);
    }
  });
}

// Capture every chart inside `root` (a DOM node or selector). Returns an array of
// { src, caption } snapshots — one per <svg>. `captions` (optional) maps index →
// label. Charts with zero size are skipped.
export async function captureCharts(root, captions = []) {
  const node = typeof root === "string" ? document.querySelector(root) : root;
  if (!node) return [];
  const svgs = Array.from(node.querySelectorAll("svg")).filter((s) => {
    const r = s.getBoundingClientRect();
    return r.width > 20 && r.height > 20;
  });
  const out = [];
  for (let i = 0; i < svgs.length; i++) {
    // eslint-disable-next-line no-await-in-loop
    const src = await svgToPng(svgs[i]);
    if (src) out.push({ src, caption: captions[i] || null });
  }
  return out;
}

// Capture a single specific chart node (its first sizable <svg>).
export async function captureChart(root, caption) {
  const shots = await captureCharts(root);
  if (!shots.length) return [];
  return [{ src: shots[0].src, caption: caption || null }];
}
