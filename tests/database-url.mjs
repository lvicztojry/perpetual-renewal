import assert from "node:assert/strict";
import { test } from "node:test";
import { migrationDatabaseUrl } from "../scripts/database-url.mjs";

test("Neon migration URL uses the same compute directly without changing app configuration", () => {
  const env = { DATABASE_URL: "postgresql://user:password@ep-test-pooler.eu.neon.tech/app?sslmode=require&schema=test" };
  const original = env.DATABASE_URL;
  const url = new URL(migrationDatabaseUrl(env));
  assert.equal(url.hostname, "ep-test.eu.neon.tech");
  assert.equal(url.pathname, "/app");
  assert.equal(url.searchParams.get("schema"), "test");
  assert.equal(url.searchParams.get("sslmode"), "require");
  assert.equal(url.searchParams.get("connect_timeout"), "30");
  assert.equal(env.DATABASE_URL, original);
});

test("explicit migration URL and timeout take precedence", () => {
  const url = new URL(migrationDatabaseUrl({
    DATABASE_URL: "postgresql://user:password@other.invalid/app",
    DATABASE_URL_UNPOOLED: "postgresql://user:password@ep-test.eu.neon.tech/target?connect_timeout=45"
  }));
  assert.equal(url.pathname, "/target");
  assert.equal(url.searchParams.get("connect_timeout"), "45");
});

test("other providers keep their connection semantics and missing config remains missing", () => {
  const source = "postgresql://user:password@db-pooler.example.invalid:6432/app?sslmode=require";
  assert.equal(migrationDatabaseUrl({ DATABASE_URL: source }), source);
  assert.equal(migrationDatabaseUrl({}), undefined);
  assert.throws(() => migrationDatabaseUrl({ DATABASE_URL: "invalid-private-config" }), {
    message: "Invalid database migration URL."
  });
  assert.throws(() => migrationDatabaseUrl({ DATABASE_URL: "https://private.invalid" }), {
    message: "Invalid database migration URL."
  });
});
