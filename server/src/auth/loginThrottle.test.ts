import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import {
  clearEmailLoginFailures,
  loginBlocked,
  loginClientIp,
  recordLoginFailure,
  resetLoginThrottle,
  trustProxyHops,
} from "./loginThrottle.js";
import { sessionCookie } from "./service.js";

const NOW = 1_700_000_000_000;

function fail(ip: string, email: string, now: number) {
  assert.equal(loginBlocked(ip, email, now).ok, true);
  recordLoginFailure(ip, email, now);
}

describe("login throttle", () => {
  const previousEmail = process.env.LOGIN_THROTTLE_EMAIL;
  const previousIp = process.env.LOGIN_THROTTLE_IP;
  const previousProxy = process.env.TRUST_PROXY;

  after(() => {
    resetLoginThrottle();
    if (previousEmail === undefined) delete process.env.LOGIN_THROTTLE_EMAIL;
    else process.env.LOGIN_THROTTLE_EMAIL = previousEmail;
    if (previousIp === undefined) delete process.env.LOGIN_THROTTLE_IP;
    else process.env.LOGIN_THROTTLE_IP = previousIp;
    if (previousProxy === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = previousProxy;
  });

  it("counts failures only and a success clears that email", () => {
    process.env.LOGIN_THROTTLE_EMAIL = "8";
    process.env.LOGIN_THROTTLE_IP = "30";
    resetLoginThrottle();
    for (let i = 0; i < 7; i += 1) fail("203.0.113.4", "a@ecc.test", NOW + i);
    clearEmailLoginFailures("a@ecc.test");
    for (let i = 0; i < 8; i += 1) fail("203.0.113.4", "a@ecc.test", NOW + 20 + i);
    const blocked = loginBlocked("203.0.113.4", "A@ecc.test", NOW + 40);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.ok(blocked.retryAfterSec > 0);
    assert.equal(loginBlocked("203.0.113.4", "b@ecc.test", NOW + 41).ok, true);
  });

  it("keeps an open block until the window ends", () => {
    process.env.LOGIN_THROTTLE_EMAIL = "2";
    process.env.LOGIN_THROTTLE_IP = "10";
    resetLoginThrottle();
    fail("203.0.113.4", "a@ecc.test", NOW);
    fail("203.0.113.4", "a@ecc.test", NOW + 1);
    assert.equal(loginBlocked("203.0.113.4", "a@ecc.test", NOW + 2).ok, false);
    const later = NOW + 15 * 60 * 1000;
    assert.equal(loginBlocked("203.0.113.4", "a@ecc.test", later).ok, true);
  });

  it("does not lock other emails before the per-IP failure limit", () => {
    process.env.LOGIN_THROTTLE_EMAIL = "8";
    process.env.LOGIN_THROTTLE_IP = "30";
    resetLoginThrottle();
    for (let i = 0; i < 8; i += 1) fail("198.51.100.8", "one@ecc.test", NOW + i);
    assert.equal(loginBlocked("198.51.100.8", "one@ecc.test", NOW + 9).ok, false);
    assert.equal(loginBlocked("198.51.100.8", "two@ecc.test", NOW + 9).ok, true);
  });

  it("throttles an IP across emails and opens the window again", () => {
    process.env.LOGIN_THROTTLE_EMAIL = "10";
    process.env.LOGIN_THROTTLE_IP = "2";
    resetLoginThrottle();
    fail("198.51.100.8", "one@ecc.test", NOW);
    fail("198.51.100.8", "two@ecc.test", NOW);
    assert.equal(loginBlocked("198.51.100.8", "three@ecc.test", NOW).ok, false);
    const later = NOW + 15 * 60 * 1000;
    assert.equal(loginBlocked("198.51.100.8", "three@ecc.test", later).ok, true);
  });

  it("counts TRUST_PROXY hops from the right and ignores a spoofed leftmost address", () => {
    for (const off of [undefined, "", "0", "false", "off", "no", "FALSE", "true", "yes", "on"]) {
      if (off === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = off;
      assert.equal(trustProxyHops(), 0);
      assert.equal(loginClientIp("10.0.0.8", "203.0.113.9, 10.0.0.2"), "10.0.0.8");
    }
    process.env.TRUST_PROXY = "1";
    assert.equal(trustProxyHops(), 1);
    assert.equal(loginClientIp("10.0.0.8", "203.0.113.9, 198.51.100.7"), "198.51.100.7");
    assert.equal(loginClientIp("10.0.0.8", "198.51.100.7"), "198.51.100.7");
    assert.equal(loginClientIp("10.0.0.8", ["203.0.113.9", "198.51.100.7"]), "198.51.100.7");
    assert.equal(loginClientIp(undefined, undefined), "unknown");
    process.env.TRUST_PROXY = "2";
    assert.equal(trustProxyHops(), 2);
    assert.equal(
      loginClientIp("10.0.0.8", "203.0.113.9, 198.51.100.7, 10.0.0.2"),
      "198.51.100.7",
    );
    assert.equal(
      loginClientIp("10.0.0.8", "9.9.9.9, 198.51.100.7, 10.0.0.2"),
      "198.51.100.7",
    );
  });
});

describe("session cookie", () => {
  it("is HttpOnly and SameSite=Lax, and Secure in production", () => {
    const dev = sessionCookie("token");
    assert.match(dev, /HttpOnly/);
    assert.match(dev, /SameSite=Lax/);
    assert.equal(dev.includes("Secure"), false);
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      assert.match(sessionCookie("token"), /Secure/);
      assert.match(sessionCookie("", true), /Secure/);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });
});
