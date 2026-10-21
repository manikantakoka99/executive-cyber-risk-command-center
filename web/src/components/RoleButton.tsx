import type { ReactNode } from "react";

/**
 * An action the role cannot perform stays on screen, disabled, with a tooltip.
 * Board and Auditor are read-only: those controls are omitted.
 */
export function RoleButton({
  role,
  allowed,
  hint,
  children,
  className,
  onClick,
  disabled,
  type = "button",
}: {
  role: string | null | undefined;
  allowed: boolean;
  hint: string;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  const readOnly = role === "board_member" || role === "auditor";
  if (!allowed && readOnly) return null;
  const blocked = !allowed;
  return (
    <span className="tip-wrap" title={blocked ? hint : undefined}>
      <button
        type={type}
        className={className}
        disabled={blocked || !!disabled}
        onClick={blocked ? undefined : onClick}
      >
        {children}
      </button>
    </span>
  );
}
