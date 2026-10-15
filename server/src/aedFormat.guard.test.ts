import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Only server/src/lib/money.ts and web/src/lib/format.ts may construct AED
 * amounts (template interpolation or string concatenation).
 */
const ALLOWED = new Set([
  path.normalize("server/src/lib/money.ts"),
  path.normalize("web/src/lib/format.ts"),
]);

/** Build patterns without embedding the forbidden source forms in this file. */
const CUR = ["A", "E", "D"].join("");
const BUILD_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "template amount", re: new RegExp(String.raw`\`[^\`]*${CUR}\s*\$\{`) },
  { name: "leading concat", re: new RegExp(String.raw`["']${CUR}\s*["']\s*\+`) },
  { name: "trailing concat", re: new RegExp(String.raw`\+\s*["']${CUR}`) },
  { name: "kpi prefix", re: new RegExp(String.raw`prefix\s*=\s*["']${CUR}\s*["']`) },
];

function walkTsFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === "dist" || ent.name === "build") continue;
      walkTsFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(ent.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("AED amount construction guard", () => {
  it("forbids hand-built AED amounts outside money/format helpers", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const files = [
      ...walkTsFiles(path.join(root, "server", "src")),
      ...walkTsFiles(path.join(root, "web", "src")),
    ];
    assert.ok(files.length > 20, "expected to scan server + web sources");

    const violations: string[] = [];
    for (const abs of files) {
      const rel = path.normalize(path.relative(root, abs));
      if (ALLOWED.has(rel)) continue;
      const text = fs.readFileSync(abs, "utf8");
      const code = text
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const { name, re } of BUILD_PATTERNS) {
        if (re.test(code)) {
          violations.push(`${rel} (${name})`);
        }
      }
    }

    assert.deepEqual(violations, [], `hand-built AED amounts:\n${violations.join("\n")}`);
  });
});
