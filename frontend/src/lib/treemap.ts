export interface TreeItem { id: string; value: number }
export interface TreeRect { id: string; x: number; y: number; w: number; h: number }

/** The worst width-to-height ratio of a row of areas laid along a side of length `side`. */
function worst(areas: number[], side: number): number {
  const sum = areas.reduce((a, b) => a + b, 0);
  const max = Math.max(...areas), min = Math.min(...areas);
  return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
}

/**
 * Squarified treemap: rectangles whose areas are proportional to the values, filling a `width` by `height` box, as
 * close to squares as the method manages. Items with no value are left out. The biggest comes first.
 */
export function treemap(items: TreeItem[], width: number, height: number): TreeRect[] {
  const sorted = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const total = sorted.reduce((a, i) => a + i.value, 0);
  if (sorted.length === 0 || total === 0) return [];
  const scale = (width * height) / total;
  const out: TreeRect[] = [];
  let x = 0, y = 0, w = width, h = height;
  let i = 0;
  while (i < sorted.length) {
    const horizontal = w >= h;                       // lay a row along the shorter side
    const side = horizontal ? h : w;
    let row = [sorted[i]];
    let j = i + 1;
    while (j < sorted.length && worst([...row, sorted[j]].map((r) => r.value * scale), side) <= worst(row.map((r) => r.value * scale), side)) {
      row = [...row, sorted[j]];
      j += 1;
    }
    const rowArea = row.reduce((a, r) => a + r.value * scale, 0);
    const thickness = rowArea / side;
    let offset = 0;
    for (const item of row) {
      const length = (item.value * scale) / thickness;
      out.push(horizontal ? { id: item.id, x, y: y + offset, w: thickness, h: length } : { id: item.id, x: x + offset, y, w: length, h: thickness });
      offset += length;
    }
    if (horizontal) { x += thickness; w -= thickness; } else { y += thickness; h -= thickness; }
    i = j;
  }
  return out;
}
