#!/usr/bin/env python3
"""Generate future-state ECC architecture diagram (SVG/PNG/PDF)."""

from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs"

# 16:9 presentation canvas (2× HD for crisp slides)
W, H = 3840, 2160

# Palette
NAVY = "#0B1220"
CHARCOAL = "#121A2B"
PANEL = "#162033"
PANEL2 = "#1A2740"
BORDER = "#2E3F5C"
CYAN = "#38BDF8"
CYAN_DIM = "#1E3A5F"
WHITE = "#F1F5F9"
MUTED = "#94A3B8"
ORANGE = "#F59E0B"
RED = "#EF4444"
GREEN = "#22C55E"
YELLOW = "#EAB308"
LABEL = "#CBD5E1"


def esc(t: str) -> str:
    return (
        t.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


class Svg:
    def __init__(self) -> None:
        self.parts: list[str] = []

    def add(self, s: str) -> None:
        self.parts.append(s)

    def rect(
        self,
        x: float,
        y: float,
        w: float,
        h: float,
        *,
        fill: str = PANEL,
        stroke: str = BORDER,
        sw: float = 1.5,
        rx: float = 8,
        opacity: float = 1.0,
    ) -> None:
        self.add(
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" '
            f'fill="{fill}" stroke="{stroke}" stroke-width="{sw}" opacity="{opacity}"/>'
        )

    def text(
        self,
        x: float,
        y: float,
        t: str,
        *,
        size: float = 18,
        fill: str = WHITE,
        weight: str = "500",
        anchor: str = "start",
        family: str = "Inter,Segoe UI,Helvetica,Arial,sans-serif",
    ) -> None:
        self.add(
            f'<text x="{x}" y="{y}" fill="{fill}" font-size="{size}" font-weight="{weight}" '
            f'font-family="{family}" text-anchor="{anchor}">{esc(t)}</text>'
        )

    def multiline(
        self,
        x: float,
        y: float,
        lines: list[str],
        *,
        size: float = 15,
        fill: str = MUTED,
        weight: str = "400",
        lh: float = 20,
        anchor: str = "start",
    ) -> None:
        for i, line in enumerate(lines):
            self.text(x, y + i * lh, line, size=size, fill=fill, weight=weight, anchor=anchor)

    def arrow(
        self,
        x1: float,
        y1: float,
        x2: float,
        y2: float,
        *,
        color: str = CYAN,
        dashed: bool = False,
        width: float = 2.5,
        marker: str = "url(#arrowCyan)",
    ) -> None:
        dash = ' stroke-dasharray="8 6"' if dashed else ""
        self.add(
            f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" '
            f'stroke-width="{width}"{dash} marker-end="{marker}"/>'
        )

    def vflow(
        self,
        cx: float,
        y0: float,
        steps: list[tuple[str, float, str]],
        *,
        box_w: float,
        gap: float = 14,
        fill: str = PANEL2,
        stroke: str = BORDER,
        title_size: float = 15,
    ) -> float:
        """Draw stacked boxes centered at cx. steps: (label, height, accent?). Returns final y."""
        y = y0
        for label, bh, accent in steps:
            x = cx - box_w / 2
            st = accent if accent else stroke
            self.rect(x, y, box_w, bh, fill=fill, stroke=st, sw=1.6 if accent else 1.2)
            # wrap-ish: single or multi-line by |
            parts = [p.strip() for p in label.split("|")]
            ty = y + bh / 2 + 5 - (len(parts) - 1) * 8
            for i, p in enumerate(parts):
                self.text(
                    cx,
                    ty + i * 16,
                    p,
                    size=title_size,
                    fill=WHITE if not accent else accent,
                    weight="600",
                    anchor="middle",
                )
            y += bh + gap
            if y < y0 + 2000:  # draw down-arrow between steps
                pass
        # redraw with arrows between — simpler second pass style:
        return y

    def vflow_arrows(
        self,
        cx: float,
        y0: float,
        steps: list[tuple[str, float, str | None]],
        *,
        box_w: float,
        gap: float = 18,
        fill: str = PANEL2,
        title_size: float = 14,
        arrow_color: str = CYAN,
    ) -> float:
        y = y0
        for idx, (label, bh, accent) in enumerate(steps):
            x = cx - box_w / 2
            st = accent or BORDER
            self.rect(x, y, box_w, bh, fill=fill, stroke=st, sw=1.8 if accent else 1.3)
            parts = [p.strip() for p in label.split("|")]
            ty = y + bh / 2 + 5 - (len(parts) - 1) * 8
            for i, p in enumerate(parts):
                self.text(
                    cx,
                    ty + i * 15,
                    p,
                    size=title_size,
                    fill=WHITE,
                    weight="600",
                    anchor="middle",
                )
            y_next = y + bh + gap
            if idx < len(steps) - 1:
                self.arrow(cx, y + bh + 2, cx, y_next - 4, color=arrow_color, width=2)
            y = y_next
        return y

    def section_header(
        self, x: float, y: float, w: float, h: float, num: str, title: str, accent: str = CYAN
    ) -> None:
        self.rect(x, y, w, h, fill=CHARCOAL, stroke=accent, sw=2, rx=10)
        self.rect(x, y, 8, h, fill=accent, stroke=accent, sw=0, rx=0)
        self.text(x + 22, y + 28, f"{num}  {title}", size=20, fill=WHITE, weight="700")

    def build(self) -> str:
        head = f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
<defs>
  <marker id="arrowCyan" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
    <path d="M0,0 L8,3 L0,6 Z" fill="{CYAN}"/>
  </marker>
  <marker id="arrowOrange" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
    <path d="M0,0 L8,3 L0,6 Z" fill="{ORANGE}"/>
  </marker>
  <marker id="arrowRed" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
    <path d="M0,0 L8,3 L0,6 Z" fill="{RED}"/>
  </marker>
  <marker id="arrowGreen" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
    <path d="M0,0 L8,3 L0,6 Z" fill="{GREEN}"/>
  </marker>
  <marker id="arrowMuted" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
    <path d="M0,0 L8,3 L0,6 Z" fill="{MUTED}"/>
  </marker>
  <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
    <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1A2336" stroke-width="1"/>
  </pattern>
</defs>
<rect width="{W}" height="{H}" fill="{NAVY}"/>
<rect width="{W}" height="{H}" fill="url(#grid)" opacity="0.45"/>
'''
        return head + "\n".join(self.parts) + "\n</svg>\n"


def draw() -> str:
    s = Svg()

    # Title
    s.text(80, 70, "YVI DWAN Executive Cyber Risk Command Center", size=42, fill=WHITE, weight="800")
    s.text(
        80,
        112,
        "Future-State Technical Architecture",
        size=28,
        fill=CYAN,
        weight="600",
    )
    s.text(
        80,
        148,
        "From Security Signals  →  Business Risk  →  Executive Decision  →  Closed Loop",
        size=20,
        fill=MUTED,
        weight="400",
    )
    s.text(
        3200,
        70,
        "TARGET / FUTURE STATE",
        size=16,
        fill=ORANGE,
        weight="700",
        anchor="end",
    )
    s.text(
        3200,
        98,
        "Not the current MVP · Conceptual + proposed implementation",
        size=14,
        fill=MUTED,
        weight="400",
        anchor="end",
    )

    # Layout constants
    top = 175
    lane_h = 1180
    gap = 18
    # Six columns
    xs = [50, 520, 980, 1680, 2480, 3100]
    ws = [450, 440, 680, 780, 600, 690]

    # Section backgrounds
    accents = [CYAN, CYAN, CYAN, RED, ORANGE, GREEN]
    titles = [
        ("01", "DOMAIN SOURCES"),
        ("02", "INGESTION"),
        ("03", "NORMALIZATION & CORRELATION"),
        ("04", "RISK / IMPACT ENGINE"),
        ("05", "EXECUTIVE DECISION"),
        ("06", "ACTION & FEEDBACK"),
    ]
    for i, (x, w) in enumerate(zip(xs, ws)):
        s.rect(x, top, w, lane_h, fill=CHARCOAL, stroke=accents[i], sw=2.2, rx=12)
        s.rect(x, top, w, 48, fill="#0F1828", stroke=accents[i], sw=0, rx=0)
        # clip header visually
        s.rect(x, top, 10, 48, fill=accents[i], stroke=accents[i], sw=0, rx=0)
        s.text(x + 24, top + 32, f"{titles[i][0]}  {titles[i][1]}", size=17, fill=WHITE, weight="700")

    # ——— SECTION 1: Domain sources ———
    x1, w1 = xs[0], ws[0]
    s.text(x1 + 20, top + 72, "12 DOMAIN SECURITY / COMPLIANCE SOLUTIONS", size=13, fill=CYAN, weight="700")
    domains = [
        ("SOC / MDR", "SIEM / EDR alerts"),
        ("IAM / PAM", "Identity & privileged access"),
        ("Cloud", "CSPM / CNAPP findings"),
        ("Ransomware Readiness", "Recovery readiness signals"),
        ("VAPT / ASM", "Attack surface & vulns"),
        ("Phishing / BEC", "Human-risk signals"),
        ("Compliance", "Control / evidence signals"),
        ("PCI DSS", "Cardholder-data scope"),
        ("OT / ICS", "Industrial control signals"),
        ("AI Governance", "AI risk / policy signals"),
        ("Third-Party Risk", "Vendor / supply chain"),
        ("vCISO / Cyber CoE", "Advisory / CoE inputs"),
    ]
    bx, by = x1 + 16, top + 88
    bw, bh = (w1 - 40) / 2 - 6, 72
    for i, (a, b) in enumerate(domains):
        col = i % 2
        row = i // 2
        xx = bx + col * (bw + 12)
        yy = by + row * (bh + 8)
        s.rect(xx, yy, bw, bh, fill=PANEL2, stroke=BORDER, sw=1.2, rx=6)
        s.text(xx + 10, yy + 28, a, size=13, fill=WHITE, weight="700")
        s.text(xx + 10, yy + 50, b, size=11, fill=MUTED, weight="400")
    s.rect(x1 + 16, top + lane_h - 70, w1 - 32, 52, fill=CYAN_DIM, stroke=CYAN, sw=1.2, rx=6)
    s.multiline(
        x1 + 28,
        top + lane_h - 42,
        ["ECC aggregates signals from domain solutions;", "it does not replace them."],
        size=13,
        fill=CYAN,
        weight="500",
        lh=18,
    )

    # ——— SECTION 2: Ingestion ———
    x2, w2 = xs[1], ws[1]
    cx2 = x2 + w2 / 2
    s.vflow_arrows(
        cx2,
        top + 70,
        [
            ("Connectors / Adapters|REST · Webhooks · Events|Scheduled pulls · Product adapters", 78, CYAN),
            ("Raw Event Intake", 42, None),
            ("Raw Event Store|Preserve source evidence|for traceability & audit", 70, None),
            ("Schema Validation|payload · required fields|source · tenant", 70, ORANGE),
        ],
        box_w=w2 - 36,
        gap=22,
        title_size=13,
    )
    s.text(cx2, top + 420, "Purpose", size=12, fill=MUTED, weight="600", anchor="middle")
    s.rect(x2 + 18, top + 435, w2 - 36, 90, fill=PANEL2, stroke=BORDER, rx=6)
    s.multiline(
        x2 + 32,
        top + 465,
        [
            "• Accept heterogeneous domain payloads",
            "• Keep original evidence immutable",
            "• Reject invalid / wrong-tenant events",
            "• Hand off clean events to normalization",
        ],
        size=13,
        fill=LABEL,
        lh=18,
    )
    s.rect(x2 + 18, top + 545, w2 - 36, 56, fill="#1A2030", stroke=MUTED, rx=6)
    s.multiline(
        x2 + 32,
        top + 570,
        ["No mandatory single protocol —", "adapters are the integration contract."],
        size=12,
        fill=MUTED,
        lh=16,
    )
    s.rect(x2 + 18, top + 620, w2 - 36, 200, fill=PANEL2, stroke=BORDER, rx=6)
    s.text(x2 + 32, top + 648, "Ingestion outcomes", size=13, fill=CYAN, weight="700")
    s.multiline(
        x2 + 32,
        top + 678,
        [
            "• Tenant-scoped event envelope",
            "• Provenance (source system / time)",
            "• Validation pass → normalize",
            "• Validation fail → quarantine / audit",
            "• Evidence retained for closed-loop",
            "  verification later",
        ],
        size=12,
        fill=LABEL,
        lh=18,
    )
    s.rect(x2 + 18, top + 840, w2 - 36, 100, fill=CYAN_DIM, stroke=CYAN, rx=6)
    s.multiline(
        x2 + 32,
        top + 872,
        [
            "MVP today: Excel / DB import",
            "Future: live domain adapters",
            "feeding this same intake path",
        ],
        size=12,
        fill=CYAN,
        lh=18,
    )

    # ——— SECTION 3: Normalization & Correlation ———
    x3, w3 = xs[2], ws[2]
    cx3 = x3 + w3 / 2
    s.vflow_arrows(
        cx3,
        top + 68,
        [
            ("Raw Security Event", 36, None),
            ("Parser / Source Adapter", 36, None),
            ("Canonical ECC Event Model", 40, CYAN),
            ("Common Risk Taxonomy Mapping", 40, CYAN),
            ("Entity / Asset Resolution", 40, None),
            ("Deduplication", 36, None),
            ("Business Context Mapping", 40, None),
            ("Cross-Domain Correlation", 44, RED),
        ],
        box_w=w3 - 40,
        gap=12,
        title_size=13,
    )

    # Entity resolution detail
    ey = top + 620
    s.text(x3 + 24, ey, "Entity / Asset Resolution", size=13, fill=CYAN, weight="700")
    tags = ["IP", "Hostname", "Application", "Cloud Resource", "User", "CVE", "Business Process"]
    tx, ty = x3 + 20, ey + 14
    for i, tag in enumerate(tags):
        tw = 88 if len(tag) < 10 else 120
        if tag == "Business Process":
            tw = 130
        if tag == "Cloud Resource":
            tw = 120
        if tx + tw > x3 + w3 - 20:
            tx = x3 + 20
            ty += 32
        s.rect(tx, ty, tw, 26, fill=PANEL2, stroke=BORDER, rx=4)
        s.text(tx + tw / 2, ty + 18, tag, size=11, fill=LABEL, weight="600", anchor="middle")
        tx += tw + 6
    s.arrow(cx3, ty + 32, cx3, ty + 48, color=CYAN, width=2)
    s.rect(x3 + 80, ty + 52, w3 - 160, 36, fill=CYAN_DIM, stroke=CYAN, rx=6)
    s.text(cx3, ty + 76, "Canonical Asset / Business Entity", size=13, fill=CYAN, weight="700", anchor="middle")

    # Dedup + correlation callouts
    dy = ty + 110
    s.rect(x3 + 16, dy, (w3 - 44) / 2, 130, fill=PANEL2, stroke=BORDER, rx=6)
    s.rect(x3 + 28 + (w3 - 44) / 2, dy, (w3 - 44) / 2, 130, fill=PANEL2, stroke=RED, rx=6)
    s.text(x3 + 28, dy + 24, "Deduplication", size=13, fill=ORANGE, weight="700")
    s.multiline(
        x3 + 28,
        dy + 48,
        ["Same asset + same issue", "+ same event identity", "→ One logical finding", "/ risk item"],
        size=12,
        fill=LABEL,
        lh=16,
    )
    rx0 = x3 + 40 + (w3 - 44) / 2
    s.text(rx0, dy + 24, "Cross-Domain Correlation", size=13, fill=RED, weight="700")
    s.multiline(
        rx0,
        dy + 48,
        ["VAPT + SOC + IAM", "+ Compliance + Business", "→ Correlated Risk Context", "(business-relevant)"],
        size=12,
        fill=LABEL,
        lh=16,
    )

    # ——— SECTION 4: Risk / Impact ———
    x4, w4 = xs[3], ws[3]
    # Two parallel engines
    half = (w4 - 48) / 2
    lx, rx = x4 + 16, x4 + 24 + half
    s.rect(lx, top + 64, half, 420, fill="#1A1520", stroke=YELLOW, sw=1.8, rx=8)
    s.rect(rx, top + 64, half, 420, fill="#1A1520", stroke=ORANGE, sw=1.8, rx=8)
    s.text(lx + half / 2, top + 92, "A. LIKELIHOOD ENGINE", size=14, fill=YELLOW, weight="800", anchor="middle")
    s.text(rx + half / 2, top + 92, "B. BUSINESS IMPACT ENGINE", size=14, fill=ORANGE, weight="800", anchor="middle")

    s.rect(lx + 12, top + 110, half - 24, 100, fill=PANEL2, stroke=BORDER, rx=6)
    s.text(lx + 24, top + 132, "Technical Evidence (inputs may include)", size=11, fill=MUTED, weight="600")
    s.multiline(
        lx + 24,
        top + 154,
        ["exploitability · exposure · attack evidence", "vulnerability age · control weakness", "threat context"],
        size=12,
        fill=LABEL,
        lh=16,
    )
    s.arrow(lx + half / 2, top + 214, lx + half / 2, top + 232, color=YELLOW, width=2, marker="url(#arrowCyan)")
    s.rect(lx + 12, top + 236, half - 24, 50, fill=PANEL2, stroke=BORDER, rx=6)
    s.text(lx + half / 2, top + 268, "Normalize Factors", size=13, fill=WHITE, weight="700", anchor="middle")
    s.arrow(lx + half / 2, top + 290, lx + half / 2, top + 308, color=YELLOW, width=2)
    s.rect(lx + 12, top + 312, half - 24, 70, fill="#2A2410", stroke=YELLOW, rx=6)
    s.text(lx + half / 2, top + 342, "Likelihood Score  0–100", size=14, fill=YELLOW, weight="800", anchor="middle")
    s.text(lx + half / 2, top + 366, "Policy / Rules-Based Likelihood Model", size=11, fill=MUTED, weight="500", anchor="middle")
    s.text(lx + half / 2, top + 455, "(Proposed implementation — not fixed weights)", size=10, fill=MUTED, weight="400", anchor="middle")

    s.rect(rx + 12, top + 110, half - 24, 100, fill=PANEL2, stroke=BORDER, rx=6)
    s.text(rx + 24, top + 132, "Business Context (inputs may include)", size=11, fill=MUTED, weight="600")
    s.multiline(
        rx + 24,
        top + 154,
        ["financial exposure · downtime", "business criticality · affected BU", "compliance scope · data/process criticality"],
        size=12,
        fill=LABEL,
        lh=16,
    )
    s.arrow(rx + half / 2, top + 214, rx + half / 2, top + 232, color=ORANGE, width=2, marker="url(#arrowOrange)")
    s.rect(rx + 12, top + 236, half - 24, 50, fill=PANEL2, stroke=BORDER, rx=6)
    s.text(rx + half / 2, top + 268, "Normalize Impact Factors", size=13, fill=WHITE, weight="700", anchor="middle")
    s.arrow(rx + half / 2, top + 290, rx + half / 2, top + 308, color=ORANGE, width=2, marker="url(#arrowOrange)")
    s.rect(rx + 12, top + 312, half - 24, 70, fill="#2A1E10", stroke=ORANGE, rx=6)
    s.text(rx + half / 2, top + 342, "Business Impact Score  0–100", size=14, fill=ORANGE, weight="800", anchor="middle")
    s.text(rx + half / 2, top + 366, "Business Impact Quantification", size=11, fill=MUTED, weight="500", anchor="middle")
    s.text(rx + half / 2, top + 455, "(Proposed implementation — policy engine)", size=10, fill=MUTED, weight="400", anchor="middle")

    # Combine
    cy = top + 510
    s.rect(x4 + 16, cy, w4 - 32, 120, fill="#2A1218", stroke=RED, sw=2.5, rx=10)
    s.text(x4 + w4 / 2, cy + 32, "RISK CALCULATION", size=14, fill=RED, weight="800", anchor="middle")
    s.text(
        x4 + w4 / 2,
        cy + 62,
        "LIKELIHOOD   ×   BUSINESS IMPACT   =   RISK SCORE (0–100)",
        size=16,
        fill=WHITE,
        weight="800",
        anchor="middle",
    )
    s.text(
        x4 + w4 / 2,
        cy + 92,
        "Risk = f(Likelihood, Impact)   ·   conceptual product — no fabricated weights",
        size=12,
        fill=MUTED,
        weight="500",
        anchor="middle",
    )

    s.vflow_arrows(
        x4 + w4 / 2,
        cy + 140,
        [
            ("Risk Severity / Classification", 36, None),
            ("Risk Prioritization", 36, None),
            ("Enterprise Risk Register", 40, CYAN),
        ],
        box_w=w4 - 80,
        gap=14,
        title_size=13,
        arrow_color=CYAN,
    )

    # Tolerance diamond area
    ty = top + 920
    s.rect(x4 + 16, ty, w4 - 32, 200, fill=PANEL2, stroke=ORANGE, sw=2, rx=8)
    s.text(x4 + 32, ty + 28, "EXECUTIVE RISK TOLERANCE", size=14, fill=ORANGE, weight="800")
    s.multiline(
        x4 + 32,
        ty + 52,
        [
            "Org + Business Unit + Asset Criticality + Configured Risk Appetite",
            "→ Risk Threshold   ·   compare Calculated Risk vs Allowed Tolerance",
        ],
        size=12,
        fill=LABEL,
        lh=18,
    )
    # Decision diamond (approx as rotated-looking box)
    s.rect(x4 + 100, ty + 100, w4 - 200, 72, fill="#2A2010", stroke=ORANGE, sw=2, rx=6)
    s.text(x4 + w4 / 2, ty + 132, "Exceeds Executive Risk Tolerance?", size=15, fill=ORANGE, weight="800", anchor="middle")
    s.text(x4 + w4 / 2, ty + 156, "YES → Escalate    ·    NO → Continue Monitoring", size=12, fill=LABEL, weight="600", anchor="middle")

    # ——— SECTION 5: Executive Decision ———
    x5, w5 = xs[4], ws[4]
    s.vflow_arrows(
        x5 + w5 / 2,
        top + 68,
        [
            ("Executive Escalation", 36, RED),
            ("ECC Executive Dashboard", 40, CYAN),
        ],
        box_w=w5 - 40,
        gap=16,
        title_size=14,
        arrow_color=RED,
    )
    # Exec card
    card_y = top + 200
    s.rect(x5 + 16, card_y, w5 - 32, 420, fill="#141C2C", stroke=ORANGE, sw=2, rx=10)
    s.text(x5 + 32, card_y + 32, "EXECUTIVE RISK CARD", size=13, fill=ORANGE, weight="800")
    blocks = [
        ("RISK", "Critical internet-facing vulnerability", RED),
        ("IMPACT", "Financial exposure · Downtime · PCI / compliance", ORANGE),
        ("RECOMMENDATION", "Emergency remediation", YELLOW),
        ("EXECUTIVE ACTION", "", CYAN),
    ]
    by = card_y + 50
    for title, body, col in blocks:
        s.rect(x5 + 28, by, w5 - 56, 58 if title != "EXECUTIVE ACTION" else 100, fill=PANEL2, stroke=col, rx=6)
        s.text(x5 + 42, by + 22, title, size=12, fill=col, weight="800")
        if body:
            s.text(x5 + 42, by + 44, body, size=12, fill=LABEL, weight="500")
            by += 70
        else:
            # action buttons
            btns = [("Approve", GREEN), ("Request Info", CYAN), ("Decline", RED), ("Acknowledge", MUTED)]
            bx = x5 + 40
            for bi, (lab, c) in enumerate(btns):
                s.rect(bx + (bi % 2) * 120, by + 32 + (bi // 2) * 28, 110, 24, fill="#0F1828", stroke=c, rx=4)
                s.text(bx + (bi % 2) * 120 + 55, by + 49 + (bi // 2) * 28, lab, size=11, fill=c, weight="700", anchor="middle")
            by += 112

    s.vflow_arrows(
        x5 + w5 / 2,
        card_y + 440,
        [
            ("Decision Record", 34, None),
            ("Decision Status", 34, None),
            ("Assigned Action Owner", 40, GREEN),
        ],
        box_w=w5 - 60,
        gap=12,
        title_size=13,
        arrow_color=ORANGE,
    )

    # ——— SECTION 6: Action & Feedback ———
    x6, w6 = xs[5], ws[5]
    s.vflow_arrows(
        x6 + w6 / 2,
        top + 68,
        [
            ("Action Owner|SOC · IT · Infra · Compliance · BU", 56, GREEN),
            ("Remediation", 36, None),
            ("Verification / Evidence|rescan · control evidence|remediation confirmation", 70, None),
            ("Updated Security Signal", 40, CYAN),
            ("Re-ingestion", 34, None),
            ("Re-normalization", 34, None),
            ("Re-correlation", 34, None),
            ("Recalculate Risk", 40, RED),
        ],
        box_w=w6 - 40,
        gap=14,
        title_size=13,
        arrow_color=GREEN,
    )
    s.rect(x6 + 16, top + lane_h - 90, w6 - 32, 70, fill="#0F2A1A", stroke=GREEN, sw=2, rx=8)
    s.text(x6 + w6 / 2, top + lane_h - 52, "CLOSED-LOOP FEEDBACK", size=15, fill=GREEN, weight="800", anchor="middle")
    s.text(
        x6 + w6 / 2,
        top + lane_h - 30,
        "Evidence re-enters the pipeline · risk is recomputed",
        size=12,
        fill=LABEL,
        weight="500",
        anchor="middle",
    )

    # Major section arrows (top of lanes)
    mid_y = top + 30
    for i in range(5):
        x_a = xs[i] + ws[i] + 4
        x_b = xs[i + 1] - 4
        s.arrow(x_a, mid_y, x_b, mid_y, color=CYAN, width=3)

    # Large feedback arrow from section 6 back to 3 and 4
    # Path along bottom of lanes
    fb_y = top + lane_h + 28
    s.add(
        f'<path d="M {x6 + w6 / 2} {top + lane_h - 2} '
        f'L {x6 + w6 / 2} {fb_y} '
        f'L {cx3} {fb_y} '
        f'L {cx3} {top + lane_h - 2}" '
        f'fill="none" stroke="{GREEN}" stroke-width="3" stroke-dasharray="10 7" '
        f'marker-end="url(#arrowGreen)"/>'
    )
    s.add(
        f'<path d="M {x6 + 80} {fb_y} '
        f'L {x4 + w4 / 2} {fb_y} '
        f'L {x4 + w4 / 2} {top + lane_h - 2}" '
        f'fill="none" stroke="{GREEN}" stroke-width="2.5" stroke-dasharray="10 7" '
        f'marker-end="url(#arrowGreen)"/>'
    )
    s.text(1800, fb_y - 12, "Closed-Loop Feedback  →  Normalization / Correlation  &  Risk Engine", size=14, fill=GREEN, weight="700", anchor="middle")

    # ——— Example callout (right of title area / overlay near section 4-5 bottom was crowded)
    # Place as floating panel left of legend area... Use space above data layer on left? 
    # Actually put example as a dedicated strip between lanes and data layer on the left side
    ex_y = top + lane_h + 55
    s.rect(50, ex_y, 1180, 195, fill="#1A1520", stroke=RED, sw=2, rx=10)
    s.text(70, ex_y + 30, "PAYMENT GATEWAY EXAMPLE  (illustrative walkthrough)", size=15, fill=RED, weight="800")
    s.multiline(
        70,
        ex_y + 58,
        [
            "VAPT: Critical CVE  +  SOC: Exploit attempt  +  IAM: Privileged service account",
            "+  PCI: Payment system in scope  +  Business: High financial / downtime exposure",
        ],
        size=13,
        fill=LABEL,
        lh=18,
    )
    s.text(
        70,
        ex_y + 110,
        "→ Correlation  →  HIGH LIKELIHOOD + HIGH IMPACT  →  HIGH RISK  →  EXCEEDS TOLERANCE",
        size=13,
        fill=YELLOW,
        weight="700",
    )
    s.text(
        70,
        ex_y + 140,
        "→ ECC Escalation  →  Executive Decision: “Approve Emergency Patch Window”",
        size=13,
        fill=ORANGE,
        weight="700",
    )
    s.text(
        70,
        ex_y + 172,
        "Visually mirrors sections 03 → 04 → 05 of the main pipeline",
        size=12,
        fill=MUTED,
        weight="400",
    )

    # ——— Database layer ———
    db_y = ex_y + 215
    s.rect(50, db_y, 3740, 200, fill=CHARCOAL, stroke=CYAN, sw=1.8, rx=10)
    s.text(70, db_y + 32, "DATA LAYER  (logical entities from ECC ERD / schema — not every column)", size=16, fill=CYAN, weight="800")

    groups = [
        ("TENANCY & IDENTITY", ["Organizations", "Users"], CYAN, 420),
        ("RISK", ["Risk Domains", "Domain / Enterprise Snapshots"], CYAN, 460),
        ("FINDINGS & IMPACT", ["Risk Findings", "Business Impact Assessments"], ORANGE, 460),
        ("EXECUTIVE DECISIONS", ["Executive Decisions", "Decision Action Log"], ORANGE, 440),
        ("COMPLIANCE", ["Frameworks", "Org Compliance Status"], MUTED, 360),
        ("ACTIVITY / REPORTS", ["Activity", "Generated Reports"], MUTED, 360),
        ("AUDIT", ["Audit Log"], MUTED, 280),
    ]
    gx = 70
    for title, items, col, gw in groups:
        s.rect(gx, db_y + 48, gw - 12, 88, fill=PANEL2, stroke=BORDER, rx=6)
        s.text(gx + 12, db_y + 70, title, size=11, fill=col, weight="800")
        for i, it in enumerate(items):
            s.text(gx + 12, db_y + 92 + i * 18, f"• {it}", size=12, fill=LABEL, weight="500")
        gx += gw

    # Core relationship highlight — full-width strip under entity groups
    s.rect(70, db_y + 148, 3700, 42, fill="#2A1218", stroke=RED, sw=2, rx=6)
    s.text(90, db_y + 176, "CORE RELATIONSHIP:", size=13, fill=RED, weight="800")
    s.text(
        320,
        db_y + 176,
        "Finding  →  Business Impact  →  Executive Decision  →  Decision Action Log"
        "     ·     Risk → Impact → Decision → Action",
        size=14,
        fill=WHITE,
        weight="700",
    )

    # ——— Technology layer ———
    tech_y = db_y + 220
    s.rect(50, tech_y, 2600, 110, fill=CHARCOAL, stroke=BORDER, sw=1.5, rx=8)
    s.text(
        70,
        tech_y + 28,
        "REPRESENTATIVE TECHNOLOGY LAYER  (implementation technologies — not mandated vendors)",
        size=14,
        fill=MUTED,
        weight="700",
    )
    row1 = [
        ("Ingestion", "API / Webhook / Event Connectors"),
        ("Processing", "Backend · Rules · Correlation"),
        ("Data", "PostgreSQL + Evidence Store"),
    ]
    row2 = [
        ("API", "REST / Service APIs"),
        ("Presentation", "React Executive Dashboard"),
        ("Reporting", "Report Generation Service"),
    ]
    for i, (a, b) in enumerate(row1):
        xx = 80 + i * 860
        s.text(xx, tech_y + 62, a, size=12, fill=CYAN, weight="700")
        s.text(xx + 100, tech_y + 62, b, size=12, fill=LABEL, weight="500")
    for i, (a, b) in enumerate(row2):
        xx = 80 + i * 860
        s.text(xx, tech_y + 88, a, size=12, fill=CYAN, weight="700")
        s.text(xx + 110, tech_y + 88, b, size=12, fill=LABEL, weight="500")

    # Legend
    leg_x, leg_y = 2720, tech_y
    s.rect(leg_x, leg_y, 1070, 110, fill=CHARCOAL, stroke=BORDER, sw=1.5, rx=8)
    s.text(leg_x + 20, leg_y + 28, "LEGEND", size=14, fill=WHITE, weight="800")
    legend = [
        (CYAN, "BLUE — Data / processing"),
        (ORANGE, "ORANGE — Decision / policy"),
        (RED, "RED — Risk / escalation"),
        (GREEN, "GREEN — Remediation / closed loop"),
    ]
    for i, (c, lab) in enumerate(legend):
        xx = leg_x + 20 + (i % 2) * 520
        yy = leg_y + 50 + (i // 2) * 28
        s.rect(xx, yy - 12, 16, 16, fill=c, stroke=c, rx=3)
        s.text(xx + 26, yy, lab, size=12, fill=LABEL, weight="500")
    s.text(leg_x + 20, leg_y + 100, "Solid arrow = primary flow    ·    Dashed arrow = feedback / async", size=12, fill=MUTED, weight="500")

    # Footer
    s.text(
        80,
        H - 28,
        "YVI DWAN ECC · Future-state architecture for presentation · Source concepts: High-Level Flow, ERD, schema, HTML reference",
        size=13,
        fill=MUTED,
        weight="400",
    )

    return s.build()


def write_mermaid() -> str:
    return """%%{init: {'theme': 'dark', 'themeVariables': { 'primaryColor': '#162033', 'primaryTextColor': '#F1F5F9', 'lineColor': '#38BDF8', 'secondaryColor': '#1A2740', 'tertiaryColor': '#0B1220'}}}%%
flowchart LR
  subgraph S1["01 DOMAIN SOURCES<br/>12 Domain Security / Compliance Solutions"]
    SOC["SOC / MDR"]
    IAM["IAM / PAM"]
    CLD["Cloud CSPM/CNAPP"]
    RAN["Ransomware Readiness"]
    VAPT["VAPT / ASM"]
    PHISH["Phishing / BEC"]
    COMP["Compliance"]
    PCI["PCI DSS"]
    OT["OT / ICS"]
    AI["AI Governance"]
    TPR["Third-Party Risk"]
    VCISO["vCISO / Cyber CoE"]
  end

  subgraph S2["02 INGESTION"]
    CONN["Connectors / Adapters<br/>REST · Webhooks · Events · Pulls"]
    RAW["Raw Event Intake"]
    STORE["Raw Event Store<br/>source evidence"]
    VAL["Schema Validation<br/>payload · fields · source · tenant"]
    CONN --> RAW --> STORE --> VAL
  end

  subgraph S3["03 NORMALIZATION & CORRELATION"]
    PARSE["Parser / Source Adapter"]
    CANON["Canonical ECC Event Model"]
    TAX["Common Risk Taxonomy Mapping"]
    ENT["Entity / Asset Resolution<br/>IP·Host·App·Cloud·User·CVE·Process"]
    DEDUP["Deduplication<br/>same asset + issue + identity"]
    BIZ["Business Context Mapping"]
    CORR["Cross-Domain Correlation<br/>→ Correlated Risk Context"]
    PARSE --> CANON --> TAX --> ENT --> DEDUP --> BIZ --> CORR
  end

  subgraph S4["04 RISK / IMPACT ENGINE"]
    direction TB
    subgraph L["Likelihood Engine"]
      TE["Technical Evidence"]
      NL["Normalize Factors"]
      LS["Likelihood Score 0–100<br/>Policy / Rules-Based Model"]
      TE --> NL --> LS
    end
    subgraph I["Business Impact Engine"]
      BC["Business Context"]
      NI["Normalize Impact Factors"]
      IS["Business Impact Score 0–100<br/>Impact Quantification"]
      BC --> NI --> IS
    end
    LS --> RISK
    IS --> RISK
    RISK["Risk = f(Likelihood, Impact)<br/>Risk Score 0–100"]
    SEV["Severity / Classification"]
    PRI["Risk Prioritization"]
    REG["Enterprise Risk Register"]
    TOL{"Exceeds Executive<br/>Risk Tolerance?"}
    RISK --> SEV --> PRI --> REG --> TOL
    TOL -->|YES| ESC["Executive Escalation"]
    TOL -->|NO| MON["Continue Monitoring"]
  end

  subgraph S5["05 EXECUTIVE DECISION"]
    DASH["ECC Executive Dashboard"]
    CARD["Risk → Impact → Recommendation → Action"]
    DEC["Decision Record"]
    STAT["Decision Status"]
    OWN["Assigned Action Owner"]
    ESC --> DASH --> CARD --> DEC --> STAT --> OWN
  end

  subgraph S6["06 ACTION & FEEDBACK"]
    ACT["Action Owner<br/>SOC·IT·Infra·Compliance·BU"]
    REM["Remediation"]
    VER["Verification / Evidence"]
    SIG["Updated Security Signal"]
    RECALC["Recalculate Risk"]
    ACT --> REM --> VER --> SIG --> RECALC
  end

  S1 --> S2 --> S3 --> S4
  OWN --> ACT
  RECALC -.->|Closed-Loop Feedback| S3
  RECALC -.->|Closed-Loop Feedback| S4

  subgraph DATA["DATA LAYER"]
    T["Tenancy: Orgs · Users"]
    R["Risk: Domains · Snapshots"]
    F["Findings · Business Impact"]
    E["Executive Decisions · Action Log"]
    C["Compliance · Activity · Reports · Audit"]
  end

  note["Payment Gateway Example:<br/>VAPT CVE + SOC exploit + IAM priv + PCI scope + high $ exposure<br/>→ HIGH risk → exceeds tolerance → Approve Emergency Patch Window"]
"""


def write_markdown() -> str:
    return """# YVI DWAN ECC — Future-State Technical Architecture

**Title:** YVI DWAN Executive Cyber Risk Command Center — Future-State Technical Architecture  
**Subtitle:** From Security Signals → Business Risk → Executive Decision → Closed Loop  

> This document describes the **target / future** architecture that implements the intended ECC concept.  
> It is **not** a diagram of the current MVP (snapshot display + sample import).

## Artifacts

| File | Purpose |
|------|---------|
| [ecc-future-architecture.svg](./ecc-future-architecture.svg) | Presentation-ready vector diagram |
| [ecc-future-architecture.png](./ecc-future-architecture.png) | 16:9 raster (≥1920×1080) |
| [ecc-future-architecture.pdf](./ecc-future-architecture.pdf) | Slide / print export |
| [ecc-future-architecture.mermaid](./ecc-future-architecture.mermaid) | Editable flowchart source |

## Story this diagram tells (≈60 seconds)

1. **Domain solutions** (SOC, IAM, Cloud, VAPT, Compliance, PCI, OT, AI, TPRM, …) produce security and compliance **signals**. ECC aggregates; it does not replace them.  
2. **Ingestion** accepts those signals via connectors/adapters, stores raw evidence, and validates schema/tenant.  
3. **Normalization & correlation** parse into a canonical ECC event, map taxonomy, resolve assets/entities, deduplicate, attach business context, and correlate across domains into one **correlated risk context**.  
4. **Risk / impact engine** computes **Likelihood** (rules/policy model) and **Business Impact** (quantification) in parallel, then **Risk = f(Likelihood, Impact)**. Risks are classified, prioritized, and entered in the enterprise risk register.  
5. **Executive risk tolerance** compares calculated risk vs configured appetite (org / BU / criticality). Above threshold → escalate; else continue monitoring.  
6. **Executive decision** surfaces Risk → Impact → Recommendation → Action on the ECC dashboard; decisions are recorded and owners assigned.  
7. **Action & closed loop**: remediation produces verification evidence → new signals → re-ingest → re-normalize → re-correlate → **recalculate risk**.

## Six pipeline stages (source-aligned)

| # | Stage | Responsibility |
|---|--------|----------------|
| 01 | Data Ingestion | Connectors, raw event store, schema validation |
| 02 | Normalization & Correlation | Taxonomy, entity resolution, dedup, business context, cross-domain correlation |
| 03 | Risk → Impact Translation | Likelihood engine + business impact engine → risk score & prioritization |
| 04 | Executive Decision | Tolerance check, escalation, dashboard, decision record |
| 05 | Action & Closed-Loop | Assignment, remediation, evidence, feedback into scoring |
| — | Data layer | Logical ERD entities supporting the chain Finding → Impact → Decision → Action Log |

*(Diagram swim-lanes expand stage 02–03 of the product flow into dedicated visual columns for clarity.)*

## Accuracy notes

- Exact scoring **weights**, ML algorithms, and vendor product names are **not** claimed as specified by source PDFs/schema.  
- Likelihood and impact internals are labeled **Proposed implementation** / **Policy / Rules-Based** / **Scoring rules / policy engine**.  
- Technology strip lists **representative** categories (PostgreSQL, React, REST, rules/correlation engines) — not a vendor BOM.  
- Optional future tech (Kafka, graph DB, ML/LLM, K8s) is intentionally omitted unless separately marked optional.

## Core formula (conceptual)

```
Risk = f(Likelihood, Impact)
```

Presented as a conceptual product of Likelihood × Business Impact scores (0–100 each → Risk Score 0–100). No fabricated percentage weights.

## Core data relationship

```
Finding → Business Impact → Executive Decision → Decision Action Log
```

## Regenerating the diagram

```bash
python3 scripts/build_ecc_future_architecture.py
```
"""


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    svg = draw()
    svg_path = OUT / "ecc-future-architecture.svg"
    svg_path.write_text(svg, encoding="utf-8")
    print(f"Wrote {svg_path}")

    (OUT / "ecc-future-architecture.mermaid").write_text(write_mermaid(), encoding="utf-8")
    (OUT / "ecc-future-architecture.md").write_text(write_markdown(), encoding="utf-8")
    print("Wrote mermaid + markdown")

    png_path = OUT / "ecc-future-architecture.png"
    pdf_path = OUT / "ecc-future-architecture.pdf"

    # Rasterize via ImageMagick
    r = subprocess.run(
        [
            "convert",
            "-background",
            NAVY,
            "-density",
            "120",
            str(svg_path),
            "-resize",
            f"{W}x{H}",
            str(png_path),
        ],
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        # Fallback: try rsvg or inkscape
        print("convert failed:", r.stderr)
        r2 = subprocess.run(
            ["inkscape", str(svg_path), f"--export-filename={png_path}", f"--export-width={W}"],
            capture_output=True,
            text=True,
        )
        if r2.returncode != 0:
            raise SystemExit(f"PNG render failed:\n{r.stderr}\n{r2.stderr}")
    print(f"Wrote {png_path}")

    # PDF from PNG
    r3 = subprocess.run(
        ["convert", str(png_path), str(pdf_path)],
        capture_output=True,
        text=True,
    )
    if r3.returncode != 0:
        # reportlab fallback
        from reportlab.lib.pagesizes import landscape
        from reportlab.lib.units import inch
        from reportlab.pdfgen import canvas
        from PIL import Image

        img = Image.open(png_path)
        pw, ph = 13.333 * inch, 7.5 * inch  # 16:9
        c = canvas.Canvas(str(pdf_path), pagesize=(pw, ph))
        c.drawImage(str(png_path), 0, 0, width=pw, height=ph, preserveAspectRatio=True, anchor="c")
        c.save()
    print(f"Wrote {pdf_path}")


if __name__ == "__main__":
    main()
