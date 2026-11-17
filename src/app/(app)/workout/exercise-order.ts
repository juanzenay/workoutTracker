/** The ids in `ids` with `id` moved to `index` (clamped to the list). Unknown ids leave the order as it is. */
export function moveTo(ids: string[], id: string, index: number): string[] {
  if (!ids.includes(id)) return ids;
  const rest = ids.filter((other) => other !== id);
  const at = Math.min(Math.max(index, 0), rest.length);
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

/**
 * Where a dragged card lands. `centers` are the cards' vertical midpoints in their current order, `from` is the
 * dragged card's index and `pointerY` where the pointer is now: the card goes after every other card whose
 * midpoint is above the pointer.
 */
export function dropIndex(centers: number[], from: number, pointerY: number): number {
  return centers.filter((center, index) => index !== from && center < pointerY).length;
}
