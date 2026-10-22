import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { DEFAULT_CORS_ORIGIN, resolveCorsOrigins } from "./corsOrigin.js";

describe("CORS origins fail closed", () => {
  it("defaults to localhost:5173 when CORS_ORIGIN is unset or empty", () => {
    assert.deepEqual(resolveCorsOrigins({}), [DEFAULT_CORS_ORIGIN]);
    assert.deepEqual(resolveCorsOrigins({ CORS_ORIGIN: "" }), [DEFAULT_CORS_ORIGIN]);
    assert.deepEqual(resolveCorsOrigins({ CORS_ORIGIN: "   " }), [DEFAULT_CORS_ORIGIN]);
    assert.deepEqual(resolveCorsOrigins({ CORS_ORIGIN: "http://localhost:5173" }), [
      "http://localhost:5173",
    ]);
    assert.deepEqual(
      resolveCorsOrigins({ CORS_ORIGIN: "http://localhost:5173, http://127.0.0.1:5173" }),
      ["http://localhost:5173", "http://127.0.0.1:5173"],
    );
  });

  it("with CORS_ORIGIN unset, allows localhost:5173 and rejects evil.example (no ACAO)", async () => {
    const prev = process.env.CORS_ORIGIN;
    delete process.env.CORS_ORIGIN;
    const app = Fastify({ logger: false });
    try {
      await app.register(cors, { origin: resolveCorsOrigins() });
      app.get("/health", async () => ({ ok: true }));
      await app.ready();

      const evil = await app.inject({
        method: "GET",
        url: "/health",
        headers: { origin: "http://evil.example" },
      });
      const allowed = await app.inject({
        method: "GET",
        url: "/health",
        headers: { origin: "http://localhost:5173" },
      });

      assert.equal(evil.headers["access-control-allow-origin"], undefined);
      assert.equal(allowed.headers["access-control-allow-origin"], "http://localhost:5173");
    } finally {
      await app.close();
      if (prev === undefined) delete process.env.CORS_ORIGIN;
      else process.env.CORS_ORIGIN = prev;
    }
  });
});
