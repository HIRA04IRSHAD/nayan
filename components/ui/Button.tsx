// One button for the whole app: every action is at least 56px tall and has a visible text label.
import type { ComponentPropsWithRef, MouseEvent } from "react";
import { Icon, type IconName } from "./Icon";

type Variant = "primary" | "secondary" | "ghost" | "success" | "danger";
type Size = "md" | "lg" | "xl";

interface Props extends ComponentPropsWithRef<"button"> {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  /** Icon above the label instead of before it (tall tiles). */
  stacked?: boolean;
  /** Natural width instead of full width. */
  inline?: boolean;
  /** Called instead of onClick while aria-disabled, e.g. to say why the action is not possible yet. */
  whenUnavailable?: () => void;
}

export function Button({ variant = "secondary", size = "lg", icon, stacked, inline, className, children, onClick, whenUnavailable, ...rest }: Props) {
  // aria-disabled (not disabled) keeps the button focusable while busy, so a screen reader user's focus
  // does not jump to the top of the page; the click is ignored (or explained, see whenUnavailable).
  const blocked = rest["aria-disabled"] === true || rest["aria-disabled"] === "true";
  const classes = ["btn", `btn--${variant}`, `btn--${size}`, stacked && "btn--stacked", inline && "btn--inline", className]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      className={classes}
      onClick={(e: MouseEvent<HTMLButtonElement>) => {
        if (blocked) {
          e.preventDefault();
          whenUnavailable?.();
          return;
        }
        onClick?.(e);
      }}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === "xl" ? 36 : size === "lg" ? 28 : 24} />}
      <span className="btn-label">{children}</span>
    </button>
  );
}
