import { expect, test, type Page } from "@playwright/test";

const PERSONAS = [
  { name: "ciso", id: "c1500001-a090-41a0-8ecc-000000000001" },
  { name: "cxo", id: "c1500001-a090-41a0-8ecc-000000000002" },
  { name: "board", id: "c1500001-a090-41a0-8ecc-000000000006" },
] as const;

const LOGIN_EMAIL: Record<string, string> = {
  "c1500001-a090-41a0-8ecc-000000000001": "layla@ciso.com",
  "c1500001-a090-41a0-8ecc-000000000002": "mariam@cxo.com",
  "c1500001-a090-41a0-8ecc-000000000005": "mariam@cxo.com",
  "c1500001-a090-41a0-8ecc-000000000006": "hessa@board.com",
  "c1500001-a090-41a0-8ecc-000000000007": "yusuf@domainanalyst.com",
};
const LOGIN_PASSWORD = "role-login-test-password";

async function signIn(page: Page, userId: string) {
  const email = LOGIN_EMAIL[userId];
  if (!email) throw new Error(`No role login for ${userId}`);
  await page.context().clearCookies();
  const emailInput = page.locator('input[type="email"]');
  const blocked = page.getByRole("heading", { name: "Could not load Command Center" });
  for (let attempt = 0; attempt < 8; attempt++) {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const which = await Promise.race([
      emailInput.waitFor({ state: "visible", timeout: 20_000 }).then(() => "login" as const),
      blocked.waitFor({ state: "visible", timeout: 20_000 }).then(() => "limited" as const),
    ]).catch(() => "missing" as const);
    if (which === "login") break;
    await page.waitForTimeout(20_000);
  }
  await emailInput.fill(email);
  await page.locator('input[type="password"]').fill(LOGIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.locator("aside.sidebar nav a").first().waitFor();
}

async function openApp(page: Page, path = "/register") {
  const limited = page.getByRole("alert").filter({ hasText: "Too Many Requests" });
  for (let attempt = 0; attempt < 8; attempt++) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    const shell = page.locator("aside.sidebar nav a").first();
    const which = await Promise.race([
      shell.waitFor({ state: "visible", timeout: 20_000 }).then(() => "shell" as const),
      limited.waitFor({ state: "visible", timeout: 20_000 }).then(() => "limited" as const),
    ]).catch(() => "missing" as const);
    // The sidebar stays mounted across client navigations, so a 429 can sit under a visible shell.
    if (which === "shell" && !(await limited.isVisible().catch(() => false))) return;
    await page.waitForTimeout(20_000);
  }
  await page.locator("aside.sidebar nav a").first().waitFor();
}

/** Page bodies keep a 429 on screen until the next load. Wait out the one-minute window, then reload. */
async function waitForMain(page: Page) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const main = document.querySelector("main");
      if (!main) return "missing";
      const text = main.textContent ?? "";
      if (/Too Many Requests/.test(text)) return "limited";
      if (/\bLoading\b|Could not load/.test(text)) return "loading";
      if (main.querySelector(".skeleton-stack")) return "loading";
      if (text.trim().length > 40) return "ready";
      return "loading";
    });
    if (state === "ready") return;
    if (state === "limited") {
      await page.waitForTimeout(20_000);
      await page.reload({ waitUntil: "domcontentloaded" });
      continue;
    }
    await page.waitForTimeout(200);
  }
  throw new Error("main content did not finish loading");
}

test.describe("sidebar", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, PERSONAS[0].id);
  });

  test("spans the viewport when a long page is scrolled to the bottom", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openApp(page, "/register");
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const side = await page.locator("aside.sidebar").boundingBox();
    const button = await page.getByRole("button", { name: "Collapse sidebar" }).boundingBox();
    expect(side).toBeTruthy();
    expect(button).toBeTruthy();
    expect(Math.abs(side!.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(side!.y + side!.height - 800)).toBeLessThanOrEqual(1);
    expect(button!.y).toBeGreaterThanOrEqual(side!.y - 1);
    expect(button!.y + button!.height).toBeLessThanOrEqual(side!.y + side!.height + 1);
    expect(button!.x).toBeGreaterThanOrEqual(side!.x - 1);
    expect(button!.x + button!.width).toBeLessThanOrEqual(side!.x + side!.width + 1);
  });

  for (const height of [600, 727, 800, 900]) {
    for (const collapsed of [false, true]) {
      test(`pinned at ${height}px ${collapsed ? "collapsed" : "open"}`, async ({ page }) => {
        await page.setViewportSize({ width: 1280, height });
        await openApp(page, "/c/posture");
        if (collapsed) {
          await page.getByRole("button", { name: "Collapse sidebar" }).click();
        }
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        const side = await page.locator("aside.sidebar").boundingBox();
        expect(side).toBeTruthy();
        expect(Math.abs(side!.y)).toBeLessThanOrEqual(1);
        expect(Math.abs(side!.y + side!.height - height)).toBeLessThanOrEqual(1);
        const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
        const button = await page.getByRole("button", { name: label }).boundingBox();
        expect(button).toBeTruthy();
        expect(button!.y).toBeGreaterThanOrEqual(side!.y - 1);
        expect(button!.y + button!.height).toBeLessThanOrEqual(side!.y + side!.height + 1);
      });
    }
  }

  for (const path of ["/policy", "/audit"]) {
    for (const height of [600, 727, 800, 900]) {
      for (const collapsed of [false, true]) {
        test(`active link above fade at ${height}px ${path} ${collapsed ? "collapsed" : "open"}`, async ({ page }) => {
          await page.setViewportSize({ width: 1280, height });
          if (collapsed) {
            await page.addInitScript(() => localStorage.setItem("ecc.sidebar", "collapsed"));
          }
          await openApp(page, path);
          await page.locator('aside.sidebar nav a[aria-current="page"]').waitFor();
          await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
          const metrics = await page.evaluate(() => {
            const nav = document.querySelector("aside.sidebar nav");
            const link = nav?.querySelector("a[aria-current='page']");
            if (!(nav instanceof HTMLElement) || !(link instanceof HTMLElement)) return null;
            const navRect = nav.getBoundingClientRect();
            const linkRect = link.getBoundingClientRect();
            return {
              scrollY: window.scrollY,
              docTop: document.documentElement.scrollTop,
              linkTop: linkRect.top,
              linkBottom: linkRect.bottom,
              navTop: navRect.top,
              navBottom: navRect.bottom,
              fadeTop: navRect.bottom - 24,
              scrollPaddingBottom: getComputedStyle(nav).scrollPaddingBottom,
            };
          });
          expect(metrics).toBeTruthy();
          expect(metrics!.scrollPaddingBottom).toBe("32px");
          expect(metrics!.scrollY).toBe(0);
          expect(metrics!.docTop).toBe(0);
          expect(metrics!.linkTop).toBeGreaterThanOrEqual(metrics!.navTop - 1);
          expect(metrics!.linkBottom).toBeLessThanOrEqual(metrics!.fadeTop + 1);
        });
      }
    }
  }
});

test.describe("stat rows, borders, width, overflow", () => {
  for (const persona of PERSONAS) {
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 1024, height: 585 },
    ]) {
      test(`${persona.name} ${viewport.width}x${viewport.height}`, async ({ page }) => {
        test.setTimeout(300_000);
        await page.setViewportSize(viewport);
        await signIn(page, persona.id);
        await openApp(page, "/");
        const hrefs = await page.locator("aside.sidebar nav a").evaluateAll((nodes) =>
          nodes.map((node) => (node as HTMLAnchorElement).getAttribute("href")).filter(Boolean),
        );
        expect(hrefs.length).toBeGreaterThan(0);
        for (const href of hrefs) {
          await openApp(page, href!);
          await waitForMain(page);
          if (href === "/c/changed") await page.locator("main .kv-pair").first().waitFor();
          const report = await page.evaluate(() => {
            const doc = document.documentElement;
            const scrollWidth = Math.max(doc.scrollWidth, document.body.scrollWidth);
            const content = document.querySelector("main .cc, main .page") as HTMLElement | null;
            const cs = content ? getComputedStyle(content) : null;
            const cards = [...document.querySelectorAll(".kpi-row > .card, .kpi-row > .kpi, .card-grid > .card, .grid > .card")].map(
              (card) => {
                const rect = card.getBoundingClientRect();
                const style = getComputedStyle(card);
                return {
                  top: rect.top,
                  height: rect.height,
                  border: `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}`,
                  parent: card.parentElement,
                };
              },
            );
            const groups = new Map<Element, typeof cards>();
            for (const card of cards) {
              if (!card.parent || card.height < 1) continue;
              const list = groups.get(card.parent) ?? [];
              list.push(card);
              groups.set(card.parent, list);
            }
            const rows = [...groups.values()].map((list) => {
              const sorted = [...list].sort((a, b) => a.top - b.top);
              const clusters: { top: number; height: number; border: string }[][] = [];
              for (const card of sorted) {
                const plain = { top: card.top, height: card.height, border: card.border };
                const cluster = clusters.at(-1);
                if (!cluster || card.top - cluster[0]!.top > 40) clusters.push([plain]);
                else cluster.push(plain);
              }
              return clusters;
            });
            const pairs = [...document.querySelectorAll(".kv-pair")].map((pair) => {
              const dt = pair.querySelector("dt")?.getBoundingClientRect();
              const dd = pair.querySelector("dd")?.getBoundingClientRect();
              const box = pair.getBoundingClientRect();
              return dt && dd
                ? {
                    overlap: dt.top < dd.bottom - 1 && dd.top < dt.bottom - 1,
                    ddRight: dd.right,
                    pairRight: box.right,
                  }
                : null;
            });
            const posture = document.querySelector(".view-ciso .tw");
            const hero = document.querySelector(".hero-scenario-card");
            return {
              scrollWidth,
              innerWidth: window.innerWidth,
              maxWidth: cs?.maxWidth ?? null,
              marginLeft: cs?.marginLeft ?? null,
              marginRight: cs?.marginRight ?? null,
              paddingLeft: cs?.paddingLeft ?? null,
              paddingRight: cs?.paddingRight ?? null,
              rows,
              pairs,
              postureScrolls: posture ? posture.scrollHeight > posture.clientHeight + 2 : false,
              hero: Boolean(hero),
            };
          });
          expect(report.scrollWidth, href!).toBeLessThanOrEqual(report.innerWidth);
          expect(report.maxWidth, href!).toBe("none");
          expect(report.marginLeft, href!).toBe("0px");
          expect(report.marginRight, href!).toBe("0px");
          expect(report.paddingLeft, href!).toBe("30px");
          expect(report.paddingRight, href!).toBe("30px");
          for (const group of report.rows) {
            for (const row of group) {
              if (row.length < 2) continue;
              const top = row[0]!.top;
              const height = row[0]!.height;
              const border = row[0]!.border;
              for (const card of row) {
                expect(Math.abs(card.top - top), href!).toBeLessThanOrEqual(1);
                expect(Math.abs(card.height - height), href!).toBeLessThanOrEqual(1);
                expect(card.border, href!).toBe(border);
              }
            }
          }
          if (href === "/c/changed") {
            expect(report.pairs.length).toBeGreaterThan(0);
            for (const pair of report.pairs) {
              expect(pair).toBeTruthy();
              expect(pair!.overlap).toBe(true);
              expect(Math.abs(pair!.ddRight - pair!.pairRight)).toBeLessThanOrEqual(2);
            }
          }
          if (href === "/c/posture") expect(report.postureScrolls).toBe(false);
          if (href === "/scenarios") expect(report.hero).toBe(false);
        }
      });
    }
  }
});

test("top bar stays one row at 1024x585", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 585 });
  await signIn(page, PERSONAS[0].id);
  await openApp(page, "/register");
  const metrics = await page.evaluate(() => {
    const nodes = [
      ...document.querySelectorAll(
        ".workspace-bar .search-trigger, .workspace-bar .icon-btn, .workspace-bar .account-chip",
      ),
    ] as HTMLElement[];
    return nodes.map((el) => {
      const rect = el.getBoundingClientRect();
      return {
        cls: el.className.toString(),
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };
    });
  });
  expect(metrics.length).toBe(3);
  const tops = metrics.map((item) => item.top);
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(2);
  for (const item of metrics) {
    expect(item.width, item.cls).toBeGreaterThanOrEqual(32);
    expect(item.height, item.cls).toBeGreaterThanOrEqual(32);
  }
  const searchTextHidden = await page
    .locator(".search-trigger span")
    .evaluate((el) => getComputedStyle(el).display === "none");
  expect(searchTextHidden).toBe(true);
  await page.locator(".workspace-bar .account-chip").click();
  await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
});

test.describe("ingestion tiles", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, PERSONAS[0].id);
  });

  for (const width of [1280, 1440, 1920]) {
    test(`source filename stays inside its tile at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 727 });
      await openApp(page, "/ingestion");
      await page.locator(".ingest-summary .exec-body").first().waitFor();
      const title = await page.locator(".ingest-summary .exec-body").first().getAttribute("title");
      expect(title).toBe("CyberCommandCenter_Tool_To_Risk_Domain_Solution.xlsx");
      const overlap = await page.evaluate(() => {
        const tiles = [...document.querySelectorAll(".ingest-summary .exec-grid > div")] as HTMLElement[];
        const boxes = tiles.map((tile) => tile.getBoundingClientRect());
        const hits: string[] = [];
        for (let i = 0; i < tiles.length; i++) {
          const value = tiles[i]!.querySelector(".exec-body, .risk-number") as HTMLElement | null;
          if (value && value.scrollWidth > tiles[i]!.clientWidth) {
            hits.push(`value ${value.scrollWidth} > tile ${tiles[i]!.clientWidth}`);
          }
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i]!;
            const b = boxes[j]!;
            const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (x > 1 && y > 1) hits.push(`tiles ${i} and ${j} intersect`);
          }
        }
        return hits;
      });
      expect(overlap).toEqual([]);
    });
  }
});

test("NIST CSF 2.0 card follows compliance permission", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, PERSONAS[0].id);
  await openApp(page, "/compliance");
  await page.getByRole("button", { name: "NIST CSF 2.0" }).waitFor();
  await page.getByRole("button", { name: "NIST CSF 2.0" }).click();
  await expect(page.getByText("Govern")).toBeVisible();
  await expect(page.getByText(/gap RS\.CO/)).toBeVisible();
  await expect(page.getByText(/gap RC\.CO/)).toBeVisible();
  await expect(page.getByText(/certified/i)).toHaveCount(0);

  await signIn(page, "c1500001-a090-41a0-8ecc-000000000007");
  await openApp(page, "/compliance");
  await expect(page.getByText("Outside this role")).toBeVisible();
  await expect(page.getByRole("button", { name: "NIST CSF 2.0" })).toHaveCount(0);
});

for (const width of [1280, 1440, 1920]) {
  test(`NIST row matches its siblings at ${width}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 900 });
    await signIn(page, PERSONAS[0].id);
    await openApp(page, "/compliance");
    await page.locator(".comp-row", { hasText: "NIST CSF 2.0" }).waitFor();
    const compliance = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".comp-row")] as HTMLElement[];
      const nist = rows.find((row) => row.innerText.includes("NIST CSF 2.0"));
      const other = rows.find((row) => !row.innerText.includes("NIST CSF 2.0"));
      const button = nist?.querySelector("button.nist-label");
      const style = button ? getComputedStyle(button) : null;
      return {
        nist: nist?.getBoundingClientRect().height ?? null,
        other: other?.getBoundingClientRect().height ?? null,
        background: style?.backgroundColor ?? "",
        borderTop: style?.borderTopWidth ?? "",
      };
    });
    expect(compliance.nist).toBeCloseTo(52.4, 0);
    expect(compliance.other).toBeCloseTo(52.4, 0);
    expect(Math.abs((compliance.nist ?? 0) - (compliance.other ?? 0))).toBeLessThanOrEqual(0.5);
    expect(compliance.borderTop).toBe("0px");
    expect(compliance.background === "rgba(0, 0, 0, 0)" || compliance.background === "transparent").toBe(true);

    await openApp(page, "/c/headline");
    await page.locator(".frameworks li", { hasText: "NIST CSF 2.0" }).waitFor();
    const headline = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".frameworks li")] as HTMLElement[];
      const nist = rows.find((row) => row.innerText.includes("NIST CSF 2.0"));
      const other = rows.find((row) => !row.innerText.includes("NIST CSF 2.0"));
      return {
        nist: nist?.getBoundingClientRect().height ?? null,
        other: other?.getBoundingClientRect().height ?? null,
      };
    });
    expect(headline.nist).toBeCloseTo(21, 0);
    expect(headline.other).toBeCloseTo(21, 0);
    expect(Math.abs((headline.nist ?? 0) - (headline.other ?? 0))).toBeLessThanOrEqual(0.5);
  });
}
