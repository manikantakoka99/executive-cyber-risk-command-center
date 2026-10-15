import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const BASE = process.env.PREVIEW_URL || "http://127.0.0.1:5173";
const OUT = process.env.ARTIFACT_DIR || "/opt/cursor/artifacts/sandstone";
const ORG = "2accc7de-f693-4b19-8fe8-6db501be05e2";

const ROLES = [
  {
    label: "ciso",
    userId: "c1500001-a090-41a0-8ecc-000000000001",
    home: "/c/posture",
    also: ["/c/headline", "/c/trust"],
  },
  {
    label: "cxo",
    userId: "c1500001-a090-41a0-8ecc-000000000002",
    home: "/c/headline",
    also: ["/c/queue", "/c/whatif"],
  },
  {
    label: "board",
    userId: "c1500001-a090-41a0-8ecc-000000000006",
    home: "/c/headline",
    also: ["/c/posture", "/c/pack"],
  },
];

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  for (const role of ROLES) {
    await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 60000 });
    await page.evaluate(
      ({ orgId, userId }) => {
        localStorage.setItem("ecc.orgId", orgId);
        localStorage.setItem("ecc.userId", userId);
        localStorage.setItem("ecc.theme", "light");
      },
      { orgId: ORG, userId: role.userId },
    );
    await page.goto(BASE + role.home, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(900);
    const homeFile = path.join(OUT, `after_${role.label}_home.png`);
    await page.screenshot({ path: homeFile, fullPage: true });
    console.log("wrote", homeFile);

    for (const route of role.also) {
      const id = route.replace("/c/", "").replace(/\//g, "_");
      await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 60000 });
      await page.waitForTimeout(700);
      const file = path.join(OUT, `after_${role.label}_${id}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log("wrote", file);
    }
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
