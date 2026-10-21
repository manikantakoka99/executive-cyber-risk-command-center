import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { consumeLoginAttempt, resetLoginThrottle } from "./loginThrottle.js";
import { sessionCookie } from "./service.js";

describe("login throttle", () => {
  const previousEmail = process.env.LOGIN_THROTTLE_EMAIL;
  const previousIp = process.env.LOGIN_THROTTLE_IP;

  after(() => {
    resetLoginThrottle();
    if (previousEmail === undefined) delete process.env.LOGIN_THROTTLE_EMAIL;
    else process.env.LOGIN_THROTTLE_EMAIL = previousEmail;
    if (previousIp === undefined) delete process.env.LOGIN_THROTTLE_IP;
    else process.env.LOGIN_THROTTLE_IP = previousIp;
  });

  it("throttles one email without blocking a different email on the same IP", () => {
    process.env.LOGIN_THROTTLE_EMAIL = "2";
    process.env.LOGIN_THROTTLE_IP = "10";
    resetLoginThrottle();
    const now = 1_700_000_000_000;
    assert.equal(consumeLoginAttempt("203.0.113.4", "a@ecc.test", now).ok, true);
    assert.equal(consumeLoginAttempt("203.0.113.4", "a@ecc.test", now + 1).ok, true);
    const blocked = consumeLoginAttempt("203.0.113.4", "A@ecc.test", now + 2);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.ok(blocked.retryAfterSec > 0);
    assert.equal(consumeLoginAttempt("203.0.113.4", "b@ecc.test", now + 3).ok, true);
  });

  it("throttles an IP across emails and opens the window again", () => {
    process.env.LOGIN_THROTTLE_EMAIL = "10";
    process.env.LOGIN_THROTTLE_IP = "2";
    resetLoginThrottle();
    const now = 1_700_000_000_000;
    assert.equal(consumeLoginAttempt("198.51.100.8", "one@ecc.test", now).ok, true);
    assert.equal(consumeLoginAttempt("198.51.100.8", "two@ecc.test", now).ok, true);
    assert.equal(consumeLoginAttempt("198.51.100.8", "three@ecc.test", now).ok, false);
    const later = now + 15 * 60 * 1000;
    assert.equal(consumeLoginAttempt("198.51.100.8", "three@ecc.test", later).ok, true);
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
