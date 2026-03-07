/**
 * Hexagonal grid utilities using axial coordinates (q, r).
 * Pointy-top orientation, centered at (0.5, 0.5) in normalized map space.
 *
 * Reference: https://www.redblobgames.com/grids/hexagons/
 */

export interface Hex {
  q: number;
  r: number;
}

// Grid sizing — ~11 hexes across the normalized 0–1 map
const SQRT3 = Math.sqrt(3);
export const HEX_SIZE = 0.0525; // circumradius in normalized coords
export const HEX_CENTER_X = 0.5;
export const HEX_CENTER_Y = 0.5;

// ── Coordinate conversions ──────────────────────────────────

/** Convert axial hex to normalized (0–1) pixel coordinates (pointy-top). */
export function hexToPixel(hex: Hex): { x: number; y: number } {
  return {
    x: HEX_CENTER_X + HEX_SIZE * (SQRT3 * hex.q + (SQRT3 / 2) * hex.r),
    y: HEX_CENTER_Y + HEX_SIZE * (1.5 * hex.r),
  };
}

/** Convert normalized pixel coordinates to the nearest hex (pointy-top). */
export function pixelToHex(x: number, y: number): Hex {
  const px = x - HEX_CENTER_X;
  const py = y - HEX_CENTER_Y;
  const q = ((SQRT3 / 3) * px - (1 / 3) * py) / HEX_SIZE;
  const r = ((2 / 3) * py) / HEX_SIZE;
  return hexRound({ q, r });
}

// ── Rounding ────────────────────────────────────────────────

/** Round fractional axial coordinates to the nearest hex. */
export function hexRound(frac: { q: number; r: number }): Hex {
  const s = -frac.q - frac.r;
  let rq = Math.round(frac.q);
  let rr = Math.round(frac.r);
  const rs = Math.round(s);

  const dq = Math.abs(rq - frac.q);
  const dr = Math.abs(rr - frac.r);
  const ds = Math.abs(rs - s);

  if (dq > dr && dq > ds) {
    rq = -rr - rs;
  } else if (dr > ds) {
    rr = -rq - rs;
  }
  // else keep rq and rr

  return { q: rq, r: rr };
}

// ── Distance & neighbors ────────────────────────────────────

/** Hex distance (number of steps) between two hexes. */
export function hexDistance(a: Hex, b: Hex): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

/** The 6 neighboring hexes (pointy-top, consistent ordering). */
const HEX_DIRECTIONS: readonly Hex[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function hexNeighbors(hex: Hex): Hex[] {
  return HEX_DIRECTIONS.map((d) => ({ q: hex.q + d.q, r: hex.r + d.r }));
}

// ── Line drawing ────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Returns all hexes along the shortest path from `a` to `b` (inclusive).
 * Uses the standard hex line-draw algorithm with a small nudge to avoid
 * ambiguous rounding on grid edges.
 */
export function hexLineDraw(a: Hex, b: Hex): Hex[] {
  const N = hexDistance(a, b);
  if (N === 0) return [{ q: a.q, r: a.r }];

  const results: Hex[] = [];
  // Nudge slightly to break ties deterministically
  const aq = a.q + 1e-6;
  const ar = a.r + 1e-6;
  const bq = b.q + 1e-6;
  const br = b.r + 1e-6;

  for (let i = 0; i <= N; i++) {
    const t = i / N;
    results.push(hexRound({ q: lerp(aq, bq, t), r: lerp(ar, br, t) }));
  }
  return results;
}

// ── Grid enumeration ────────────────────────────────────────

/** Returns true if the hex center falls within the 0–1 map bounds (with padding). */
function hexInBounds(hex: Hex): boolean {
  const { x, y } = hexToPixel(hex);
  const pad = HEX_SIZE * 0.5; // allow hexes partially off-edge
  return x >= -pad && x <= 1 + pad && y >= -pad && y <= 1 + pad;
}

/** All hexes that fit on the map. Cached after first call. */
let _allHexes: Hex[] | null = null;
export function allGridHexes(): Hex[] {
  if (_allHexes) return _allHexes;
  const hexes: Hex[] = [];
  const maxQ = Math.ceil(0.6 / (SQRT3 * HEX_SIZE));
  const maxR = Math.ceil(0.6 / (1.5 * HEX_SIZE));
  for (let r = -maxR; r <= maxR; r++) {
    for (let q = -maxQ; q <= maxQ; q++) {
      const hex = { q, r };
      if (hexInBounds(hex)) {
        hexes.push(hex);
      }
    }
  }
  _allHexes = hexes;
  return hexes;
}

// ── Hex polygon vertices (for SVG rendering) ────────────────

/** Returns the 6 corner vertices of a hex in normalized coordinates. */
export function hexCorners(hex: Hex): { x: number; y: number }[] {
  const center = hexToPixel(hex);
  const corners: { x: number; y: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const angleDeg = 60 * i - 30; // pointy-top: first corner at -30°
    const angleRad = (Math.PI / 180) * angleDeg;
    corners.push({
      x: center.x + HEX_SIZE * Math.cos(angleRad),
      y: center.y + HEX_SIZE * Math.sin(angleRad),
    });
  }
  return corners;
}

// ── Hex equality helper ─────────────────────────────────────

export function hexEqual(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r;
}

export function hexKey(hex: Hex): string {
  return `${hex.q},${hex.r}`;
}
