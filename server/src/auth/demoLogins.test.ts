import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ROLE_CODES, homeFor } from "../command/rbac.js";
import { ROLE_LOGIN_DOMAIN, roleLoginEmail, roleLogins } from "../command/personas.js";
import { passwordsForDemoLogins } from "./demoLogins.js";
import { deliverMail } from "./outboundMail.js";
import { verifySecondFactor } from "./service.js";

describe("demo role logins", () => {
  it("has one firstname@role-domain login for each schema role", () => {
    const logins = roleLogins();
    assert.equal(logins.length, ROLE_CODES.length);
    assert.deepEqual(
      logins.map((login) => login.role).sort(),
      [...ROLE_CODES].sort(),
    );
    assert.deepEqual(
      logins.map((login) => login.email).sort(),
      [
        "hessa@board.com",
        "james@auditor.com",
        "layla@ciso.com",
        "mariam@cxo.com",
        "nadia@admin.com",
        "rashid@risklead.com",
        "sara@programoffice.com",
        "yusuf@domainanalyst.com",
      ],
    );
    for (const login of logins) {
      assert.equal(login.email, roleLoginEmail(login.firstName, login.role));
      assert.equal(login.email.endsWith(`@${ROLE_LOGIN_DOMAIN[login.role]}`), true);
      assert.equal(login.orgId, "2accc7de-f693-4b19-8fe8-6db501be05e2");
    }
    assert.equal(homeFor("ciso"), "/c/posture");
    assert.equal(homeFor("cxo"), "/c/headline");
    assert.equal(homeFor("board_member"), "/c/headline");
    assert.equal(homeFor("risk_lead"), "/c/closure");
    assert.equal(homeFor("domain_analyst"), "/c/trust");
    assert.equal(homeFor("program_office"), "/c/pack");
    assert.equal(homeFor("auditor"), "/c/changed");
    assert.equal(homeFor("admin"), "/admin");
  });

  it("requires a file entry for every login and falls back to one password when the file is absent", () => {
    const emails = ["layla@ciso.com", "hessa@board.com"];
    assert.throws(
      () => passwordsForDemoLogins({ emails, fileText: "layla@ciso.com,local-password-1\n", fallbackPassword: null }),
      /No password entry for hessa@board.com/,
    );
    assert.throws(
      () => passwordsForDemoLogins({ emails, fileText: null, fallbackPassword: "password" }),
      /ECC_DEMO_LOGINS_FILE/,
    );
    const fallback = passwordsForDemoLogins({
      emails,
      fileText: null,
      fallbackPassword: "local-password-1",
    });
    assert.equal(fallback.get("layla@ciso.com"), "local-password-1");
    assert.equal(fallback.get("hessa@board.com"), "local-password-1");
    const fromFile = passwordsForDemoLogins({
      emails,
      fileText: "layla@ciso.com,local-password-1\nhessa@board.com,local-password-2\n",
      fallbackPassword: "local-password-9",
    });
    assert.equal(fromFile.get("hessa@board.com"), "local-password-2");
  });

  it("withholds mail to the public role domains", () => {
    for (const domain of Object.values(ROLE_LOGIN_DOMAIN)) {
      const result = deliverMail({ to: `person@${domain}`, subject: "Invite" });
      assert.equal(result.sent, false);
      assert.equal(result.mode, "log");
      assert.match(result.reason, /log-only/);
    }
    assert.equal(deliverMail({ to: "person@example.com", subject: "Invite" }).sent, false);
  });

  it("leaves the second factor as a no-op", async () => {
    assert.equal(await verifySecondFactor({ email: "layla@ciso.com", accountId: "account" }), true);
  });
});
