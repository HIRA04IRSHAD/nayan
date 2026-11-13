import type { ReactNode, Ref } from "react";

/** Every screen's <h1> has this id; after a tab change focus moves here so a screen reader starts on the new screen. */
export const SCREEN_TITLE_ID = "screen-title";

export function ScreenTitle({ children, sub, titleRef }: { children: ReactNode; sub?: ReactNode; titleRef?: Ref<HTMLHeadingElement> }) {
  return (
    <div className="screen-head">
      <h1 id={SCREEN_TITLE_ID} ref={titleRef} tabIndex={-1} className="screen-title">
        {children}
      </h1>
      {sub && <p className="screen-sub">{sub}</p>}
    </div>
  );
}
