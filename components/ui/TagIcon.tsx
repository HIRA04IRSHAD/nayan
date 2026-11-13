// A drawing of each stick-on tactile tag (lib/tags.ts), so a sighted helper can see which sticker goes on
// which box. The blind user finds the same shape by touch; the Hindi name is the accessible label.
import type { ReactNode } from "react";
import type { TactileTagId } from "@/lib/types";
import { tagInfo } from "@/lib/tags";

// Drawn on a 48×48 sticker. Filled shapes for bumps/bars, an open ring for "गोला", so no two feel alike.
const SHAPES: Record<TactileTagId, ReactNode> = {
  one_dot: <circle cx="24" cy="24" r="6.5" />,
  two_dots: (
    <>
      <circle cx="16" cy="24" r="5.5" />
      <circle cx="32" cy="24" r="5.5" />
    </>
  ),
  three_dots: (
    <>
      <circle cx="12.5" cy="24" r="4.8" />
      <circle cx="24" cy="24" r="4.8" />
      <circle cx="35.5" cy="24" r="4.8" />
    </>
  ),
  line: <rect x="10" y="20.5" width="28" height="7" rx="3.5" />,
  triangle: <path d="M24 11.5L37 35H11z" strokeWidth="3" strokeLinejoin="round" className="tag-icon-stroke-fill" />,
  circle: <circle cx="24" cy="24" r="10.5" fill="none" strokeWidth="5" className="tag-icon-stroke" />,
  cross: <path d="M15 15l18 18M33 15L15 33" fill="none" strokeWidth="6" strokeLinecap="round" className="tag-icon-stroke" />,
  square: <rect x="13.5" y="13.5" width="21" height="21" rx="3" />,
};

/**
 * `decorative`: the tag's name is already in visible text right next to the drawing, so the drawing is hidden
 * from screen readers (otherwise they read "एक बिंदु, image, एक बिंदु").
 */
export function TagIcon({ tag, size = 48, className, decorative }: { tag: TactileTagId; size?: number; className?: string; decorative?: boolean }) {
  const name = tagInfo(tag).hi;
  const a11y = decorative ? { "aria-hidden": true, focusable: false } : { role: "img", "aria-label": name };
  return (
    <svg className={className ? `tag-icon ${className}` : "tag-icon"} {...a11y} width={size} height={size} viewBox="0 0 48 48">
      {!decorative && <title>{name}</title>}
      <rect className="tag-icon-bg" x="2" y="2" width="44" height="44" rx="13" />
      <g className="tag-icon-ink">{SHAPES[tag]}</g>
    </svg>
  );
}

/** Dashed empty sticker for a medicine that has no tag yet. */
export function NoTagIcon({ size = 48 }: { size?: number }) {
  return (
    <svg className="tag-icon tag-icon--empty" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <rect x="3" y="3" width="42" height="42" rx="12" fill="none" strokeWidth="2.5" strokeDasharray="6 5" />
    </svg>
  );
}
