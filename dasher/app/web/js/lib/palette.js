/*
 * Colours of a cover picture, for the glow and moving colour fields on the full-screen player.
 */

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

const hsl = (h, s, l) => `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;

/**
 * Up to `count` lively colours from pixel data ([r, g, b, a, ...]): pixels are grouped by hue, grey and very dark or
 * very light ones are left out, and the groups are ranked by how many colourful pixels they hold. The result is
 * made bright enough to glow on a dark screen. Returns [] for a picture without colour.
 */
export function paletteFromPixels(data, count = 3) {
  const buckets = new Map();
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    const { h, s, l } = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    if (s < 0.22 || l < 0.1 || l > 0.92) continue;
    const key = Math.floor(h / 30) % 12;
    const b = buckets.get(key) ?? { n: 0, h: 0, s: 0, l: 0, hx: 0, hy: 0 };
    b.n += 1;
    b.s += s;
    b.l += l;
    b.hx += Math.cos((h * Math.PI) / 180);
    b.hy += Math.sin((h * Math.PI) / 180);
    buckets.set(key, b);
  }
  return [...buckets.values()]
    .sort((a, b) => b.n * (b.s / b.n) - a.n * (a.s / a.n))
    .slice(0, count)
    .map((b) => {
      const hue = ((Math.atan2(b.hy, b.hx) * 180) / Math.PI + 360) % 360;
      return hsl(hue, clamp(b.s / b.n + 0.15, 0.6, 0.95), clamp(b.l / b.n, 0.45, 0.6));
    });
}

const cache = new Map();

/** The palette of the picture at `url` (same origin, so the pixels can be read); [] when it cannot be read. */
export function extractPalette(url) {
  if (!url) return Promise.resolve([]);
  if (cache.has(url)) return cache.get(url);
  const promise = new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      try {
        const size = 24;
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(image, 0, 0, size, size);
        resolve(paletteFromPixels(context.getImageData(0, 0, size, size).data));
      } catch {
        resolve([]);
      }
    };
    image.onerror = () => resolve([]);
    image.src = url;
  });
  cache.set(url, promise);
  if (cache.size > 40) cache.delete(cache.keys().next().value);
  return promise;
}
