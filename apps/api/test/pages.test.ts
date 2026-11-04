import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "./helpers.ts";

let ctx: TestContext | undefined;
let dist: string | undefined;
afterEach(async () => {
  await ctx?.close();
  if (dist) rmSync(dist, { recursive: true, force: true });
});

describe("web pages", () => {
  it("serves the console, the live page and the public privacy notice and terms", async () => {
    dist = mkdtempSync(join(tmpdir(), "warden-console-"));
    for (const page of ["index", "live", "privacy", "terms"]) {
      writeFileSync(join(dist, `${page}.html`), `<p>${page} page</p>`);
    }
    ctx = await createTestContext({ consoleDist: dist });
    const body = async (url: string) => (await ctx?.app.inject({ method: "GET", url }))?.body;
    expect(await body("/privacy")).toContain("privacy page");
    expect(await body("/terms/")).toContain("terms page");
    expect(await body("/live")).toContain("live page");
    expect(await body("/queue")).toContain("index page");
    expect(await body("/privacy-notice")).toContain("index page");
    expect((await ctx.app.inject({ method: "GET", url: "/v1/nothing" })).statusCode).toBe(404);
  });
});
