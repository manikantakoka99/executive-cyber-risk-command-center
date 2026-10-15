import { Link } from "react-router-dom";
import { Lock, SearchX } from "lucide-react";

export function EmptyState({
  code,
  title,
  reason,
  home,
}: {
  code: "403" | "404";
  title: string;
  reason: string;
  home: string;
}) {
  const Icon = code === "403" ? Lock : SearchX;
  return (
    <div className="page empty-state">
      <div className="empty-state-card">
        <Icon className="empty-state-icon" aria-hidden size={36} strokeWidth={1.5} />
        <p className="eyebrow">
          {code} · {code === "403" ? "Forbidden" : "Not found"}
        </p>
        <h1 className="page-title">{title}</h1>
        <p className="page-sub">{reason}</p>
        <Link className="btn primary sm" to={home}>
          Back to home
        </Link>
      </div>
    </div>
  );
}
