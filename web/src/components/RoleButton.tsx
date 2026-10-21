import { useId, type ReactNode } from "react";

/**
 * Workflow actions stay visible for every role. When this role cannot use the
 * action, the button is aria-disabled and a tooltip names who can. Native
 * disabled is not used: it would drop the button from the tab order, so the
 * tooltip would be unreachable from the keyboard. Edit, delete, and inline
 * save controls are omitted by the page instead of rendered here.
 */
export function RoleButton({
  allowed,
  hint,
  children,
  className,
  onClick,
  disabled,
  type = "button",
}: {
  role?: string | null;
  allowed: boolean;
  hint: string;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  const blocked = !allowed;
  const inactive = blocked || !!disabled;
  const tipId = useId();
  return (
    <span className="tip-wrap">
      <button
        type={type}
        className={className}
        aria-disabled={inactive ? true : undefined}
        aria-describedby={blocked ? tipId : undefined}
        onClick={(event) => {
          if (inactive) {
            event.preventDefault();
            return;
          }
          onClick?.();
        }}
      >
        {children}
      </button>
      {blocked ? (
        <span id={tipId} role="tooltip" className="tip">
          {hint}
        </span>
      ) : null}
    </span>
  );
}
