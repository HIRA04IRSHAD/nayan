// Chart geometry for the website's "Nayan app preview" (illustrative demo data). Deterministic: the same paths
// on the server and in every browser, so the SVG is rendered once on the server and never re-generated.

/**
 * series(n, seed, base, amp, trend)[i] = base + trend·i/(n−1) + sin(i·0.9 + seed)·amp·0.5 + (r − 0.5)·amp,
 * where r comes from the seeded generator s ← (s × 9301 + 49297) mod 233280, r = s / 233280 (s starts at seed).
 */
export function series(n: number, seed: number, base: number, amp: number, trend: number): number[] {
  let s = seed;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    s = (s * 9301 + 49297) % 233280;
    const r = s / 233280;
    out.push(base + (trend * i) / (n - 1) + Math.sin(i * 0.9 + seed) * amp * 0.5 + (r - 0.5) * amp);
  }
  return out;
}

export interface Pt {
  x: number;
  y: number;
}

const f = (v: number) => (Math.round(v * 100) / 100).toString();

/** A smooth cubic path: each segment from q to p uses control points (mid-x, q.y) and (mid-x, p.y). */
export function smoothPath(pts: Pt[]): string {
  if (!pts.length) return "";
  let d = `M${f(pts[0].x)} ${f(pts[0].y)}`;
  for (let i = 1; i < pts.length; i++) {
    const q = pts[i - 1];
    const p = pts[i];
    const mx = (q.x + p.x) / 2;
    d += ` C${f(mx)} ${f(q.y)} ${f(mx)} ${f(p.y)} ${f(p.x)} ${f(p.y)}`;
  }
  return d;
}

/** The line, closed down to the bottom edge (for the fill under it). */
export const areaPath = (pts: Pt[], bottom: number) =>
  pts.length ? `${smoothPath(pts)} L${f(pts[pts.length - 1].x)} ${f(bottom)} L${f(pts[0].x)} ${f(bottom)} Z` : "";

/** Sparkline in a 200×30 box: x = i·200/(n−1), y = 28 − normalised(v)·24. */
export function sparkline(values: number[]): { line: string; area: string } {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => ({ x: (i * 200) / (values.length - 1), y: 28 - ((v - min) / span) * 24 }));
  return { line: smoothPath(pts), area: areaPath(pts, 30) };
}

/** The four KPI sparklines, in tile order. */
export const SPARK_SERIES: [number, number, number, number, number][] = [
  [14, 3, 20, 7, 10],
  [14, 7, 18, 6, 9],
  [14, 11, 22, 6, -6],
  [14, 5, 12, 4, 14],
];

export interface AreaChart {
  grid: number[];
  a: { line: string; area: string };
  b: { line: string; area: string };
  marker: Pt;
}

/**
 * The 600×190 area chart: 5 grid lines at y = 12 + i·41.5; A = series(30,2,90,26,60), B = series(30,9,70,22,30);
 * max = largest value + 10; x = i·600/29; y = 190 − 12 − (v/max)·160; marker at A's point 22.
 */
export function areaChart(): AreaChart {
  const a = series(30, 2, 90, 26, 60);
  const b = series(30, 9, 70, 22, 30);
  const max = Math.max(...a, ...b) + 10;
  const toPts = (vs: number[]) => vs.map((v, i) => ({ x: (i * 600) / 29, y: 190 - 12 - (v / max) * 160 }));
  const pa = toPts(a);
  const pb = toPts(b);
  return {
    grid: [0, 1, 2, 3, 4].map((i) => 12 + i * 41.5),
    a: { line: smoothPath(pa), area: areaPath(pa, 190) },
    b: { line: smoothPath(pb), area: areaPath(pb, 190) },
    marker: pa[22],
  };
}
