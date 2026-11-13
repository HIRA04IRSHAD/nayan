// Pointer state shared by the ripple lens and the koi (set by SiteEffects' pointer listeners).
export const pointer = { u: 0.5, v: 0.5, tx: 0, ty: 0, inside: false };

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** t²(3−2t) with t = clamp((v−a)/(b−a)). */
export function smoothstep(a: number, b: number, v: number): number {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
