/**
 * Which muscle overlay is under a tap on the body diagram. The overlays are CSS
 * masks, which don't take part in hit-testing, so draw each silhouette to a
 * canvas at the displayed size and look for opaque pixels near the tap.
 */

export interface HitLayer<Id> {
  id: Id;
  image: HTMLImageElement;
}

/** How far from the tap (CSS px) a muscle still counts, so small muscles are tappable on a phone. */
export const HIT_REACH = 10;

const alphaCache = new WeakMap<HTMLImageElement, { width: number; data: Uint8ClampedArray; height: number }>();

function alphaAt(image: HTMLImageElement, width: number) {
  const cached = alphaCache.get(image);
  if (cached && cached.width === width) return cached;
  // The overlay sits at the body's top left with the body's width, like the mask it is drawn as.
  const w = Math.ceil(width);
  const h = Math.ceil((width * image.naturalHeight) / image.naturalWidth);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, w, h);
  const entry = { width, height: h, data: ctx.getImageData(0, 0, w, h).data };
  alphaCache.set(image, entry);
  return entry;
}

/** The layer with an opaque pixel nearest (x, y), within HIT_REACH, or null. `width` is the displayed body width. */
export function findLayerAt<Id>(layers: HitLayer<Id>[], x: number, y: number, width: number): Id | null {
  let best: { id: Id; distance: number } | null = null;
  for (const { id, image } of layers) {
    if (!image.complete || image.naturalWidth === 0) continue;
    const alpha = alphaAt(image, width);
    if (!alpha) continue;
    const w = Math.ceil(alpha.width);
    for (let dy = -HIT_REACH; dy <= HIT_REACH; dy++) {
      for (let dx = -HIT_REACH; dx <= HIT_REACH; dx++) {
        const distance = Math.hypot(dx, dy);
        if (distance > HIT_REACH || (best && distance >= best.distance)) continue;
        const px = Math.round(x + dx);
        const py = Math.round(y + dy);
        if (px < 0 || py < 0 || px >= w || py >= alpha.height) continue;
        if (alpha.data[(py * w + px) * 4 + 3]! > 0) best = { id, distance };
      }
    }
  }
  return best?.id ?? null;
}
