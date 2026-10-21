/**
 * Capture screenshots of every app screen for each of the 8 DWAN roles.
 * Demo auth: localStorage ecc.orgId + ecc.userId (no password).
 */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE = process.env.PREVIEW_URL || "http://localhost:5173";
const OUT = process.env.ARTIFACT_DIR || "/opt/cursor/artifacts/role_screens";
const ORG = "2accc7de-f693-4b19-8fe8-6db501be05e2";

/** One persona per canonical DWAN role */
const ROLES = [
  { dwan: "board_member", label: "board", name: "Hessa Al Ketbi", email: "hessa@board.com", userId: "c1500001-a090-41a0-8ecc-000000000006" },
  { dwan: "cxo", label: "cxo", name: "Mariam Al Dhaheri", email: "mariam@cxo.com", userId: "c1500001-a090-41a0-8ecc-000000000005" },
  { dwan: "ciso", label: "ciso", name: "Layla Al Hashimi", email: "layla@ciso.com", userId: "c1500001-a090-41a0-8ecc-000000000001" },
  { dwan: "risk_lead", label: "risk_lead", name: "Rashid Al Maktoum", email: "rashid@risklead.com", userId: "c1500001-a090-41a0-8ecc-00000000000a" },
  { dwan: "domain_analyst", label: "analyst", name: "Yusuf Rahman", email: "yusuf@domainanalyst.com", userId: "c1500001-a090-41a0-8ecc-000000000007" },
  { dwan: "program_office", label: "program_office", name: "Sara Ibrahim", email: "sara@programoffice.com", userId: "c1500001-a090-41a0-8ecc-00000000000b" },
  { dwan: "auditor", label: "auditor", name: "James Okoye", email: "james@auditor.com", userId: "c1500001-a090-41a0-8ecc-00000000000c" },
  { dwan: "admin", label: "admin", name: "Nadia Farouk", email: "nadia@admin.com", userId: "c1500001-a090-41a0-8ecc-000000000009" },
];

/** Checklist + 8 command tabs + supporting ops screens that exist as routes */
const SCREENS = [
  { id: "login", path: "/login", note: "tenant selector on login", forceLogout: true },
  { id: "headline", path: "/c/headline", note: "HTML tab 1" },
  { id: "posture", path: "/c/posture", note: "HTML tab 2" },
  { id: "trust", path: "/c/trust", note: "HTML tab 3" },
  { id: "queue", path: "/c/queue", note: "HTML tab 4" },
  { id: "whatif", path: "/c/whatif", note: "HTML tab 5" },
  { id: "closure", path: "/c/closure", note: "HTML tab 6 / acceptance register surface" },
  { id: "changed", path: "/c/changed", note: "HTML tab 7" },
  { id: "pack", path: "/c/pack", note: "HTML tab 8" },
  { id: "compliance", path: "/compliance", note: "Dubai ISR / PCI frameworks" },
  { id: "audit", path: "/audit", note: "audit trail" },
  { id: "admin", path: "/admin", note: "users/roles" },
  { id: "findings", path: "/findings", note: "closest to risk register" },
  { id: "ingestion", path: "/ingestion", note: "closest to connector health" },
  { id: "operations", path: "/operations", note: "ops overview" },
  { id: "scenarios", path: "/scenarios", note: "risk scenarios / remediation context" },
  { id: "decisions", path: "/decisions", note: "decision history" },
  { id: "reports", path: "/reports", note: "reports" },
];

async function shot(page, file) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: file, fullPage: true });
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const manifest = [];
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  // Login page once (tenant selector)
  await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 60000 });
  await page.evaluate(() => {
    localStorage.removeItem("ecc.userId");
    localStorage.removeItem("ecc.orgId");
  });
  await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 60000 });
  const loginFile = path.join(OUT, "00_login_tenant_selector.png");
  await shot(page, loginFile);
  manifest.push({ role: "all", screen: "login", file: loginFile, status: "ok" });

  for (const role of ROLES) {
    const roleDir = path.join(OUT, role.label);
    await mkdir(roleDir, { recursive: true });

    for (const screen of SCREENS) {
      if (screen.forceLogout) continue; // already captured globally
      await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.evaluate(
        ({ orgId, userId }) => {
          localStorage.setItem("ecc.orgId", orgId);
          localStorage.setItem("ecc.userId", userId);
          localStorage.setItem("ecc.theme", "dark");
        },
        { orgId: ORG, userId: role.userId },
      );
      const url = BASE + screen.path;
      const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch((e) => e);
      await page.waitForTimeout(800);
      const bodyText = await page.locator("body").innerText().catch(() => "");
      const outside = /Outside this role/i.test(bodyText);
      const file = path.join(roleDir, `${screen.id}${outside ? "_denied" : ""}.png`);
      await shot(page, file);
      manifest.push({
        role: role.dwan,
        persona: role.name,
        email: role.email,
        screen: screen.id,
        note: screen.note,
        path: screen.path,
        file,
        access: outside ? "denied" : "ok",
        navError: resp instanceof Error ? String(resp.message) : null,
      });
      console.log(`${role.label}/${screen.id} -> ${outside ? "denied" : "ok"}`);
    }
  }

  const manifestPath = path.join(OUT, "manifest.json");
  await writeFile(manifestPath, JSON.stringify({ base: BASE, roles: ROLES, screens: SCREENS, shots: manifest }, null, 2));
  console.log("Wrote", manifestPath, "shots:", manifest.length);
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
