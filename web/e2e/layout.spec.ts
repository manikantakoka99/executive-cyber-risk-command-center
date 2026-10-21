import { expect, test, type Page } from "@playwright/test";

const ORG = "2accc7de-f693-4b19-8fe8-6db501be05e2";
const PERSONAS = [
  { name: "ciso", id: "c1500001-a090-41a0-8ecc-000000000001" },
  { name: "cxo", id: "c1500001-a090-41a0-8ecc-000000000002" },
  { name: "board", id: "c1500001-a090-41a0-8ecc-000000000006" },
] as const;

async function signIn(page: Page, userId: string) {
  await page.addInitScript(
    ({ org, user }) => {
      localStorage.setItem("ecc.orgId", org);
      localStorage.setItem("ecc.userId", user);
      localStorage.setItem("ecc.sidebar", "open");
    },
    { org: ORG, user: userId },
  );
}

async function openApp(page: Page, path = "/register") {
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    const shell = page.locator("aside.sidebar nav a").first();
    const limited = page.getByText("Too Many Requests");
    const which = await Promise.race([
      shell.waitFor({ state: "visible", timeout: 20_000 }).then(() => "shell" as const),
      limited.waitFor({ state: "visible", timeout: 20_000 }).then(() => "limited" as const),
    ]).catch(() => "missing" as const);
    if (which === "shell") return;
    await page.waitForTimeout(20_000);
  }
  await page.locator("aside.sidebar nav a").first().waitFor();
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
          await page.waitForFunction(() => {
            const main = document.querySelector("main");
            if (!main) return false;
            const text = main.textContent ?? "";
            if (/\bLoading\b|Too Many Requests|Could not load/.test(text)) return false;
            if (main.querySelector(".skeleton-stack")) return false;
            return text.trim().length > 40;
          });
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
        ".workspace-bar .search-trigger, .workspace-bar .org-select, .workspace-bar .role-chip, .workspace-bar .icon-btn, .workspace-bar .sign-out, .workspace-bar .avatar",
      ),
    ] as HTMLElement[];
    return nodes.map((el) => {
      const rect = el.getBoundingClientRect();
      return {
        cls: el.className.toString(),
        top: rect.top,
        width: rect.width,
        height: rect.height,
        label: el.getAttribute("aria-label"),
        title: el.getAttribute("title"),
      };
    });
  });
  expect(metrics.length).toBeGreaterThanOrEqual(6);
  const tops = metrics.map((item) => item.top);
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(2);
  for (const item of metrics) {
    const isControl =
      item.cls.includes("search-trigger") ||
      item.cls.includes("org-select") ||
      item.cls.includes("icon-btn") ||
      item.cls.includes("sign-out");
    if (!isControl) continue;
    expect(item.width).toBeGreaterThanOrEqual(32);
    expect(item.height).toBeGreaterThanOrEqual(32);
  }
  const signOut = metrics.find((item) => item.cls.includes("sign-out"));
  expect(signOut?.label).toBe("Sign out");
  expect(signOut?.title).toBe("Sign out");
  const labelHidden = await page.locator(".sign-out-label").evaluate((el) => getComputedStyle(el).display === "none");
  expect(labelHidden).toBe(true);
  const searchTextHidden = await page
    .locator(".search-trigger span")
    .evaluate((el) => getComputedStyle(el).display === "none");
  expect(searchTextHidden).toBe(true);
});
