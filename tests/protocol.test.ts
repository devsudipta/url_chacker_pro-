import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { defaults } from "../shared/defaults";
import { protocolUrls } from "../src/main/utilities/protocol";
import { DatabaseService } from "../src/main/database/DatabaseService";
import { ScanService } from "../src/main/services/ScanService";

test("protocol selection preserves paths, query values and explicit ports", () => {
  const raw = "https://127.0.0.1:54321/a?x=1&x=2&empty=";
  assert.deepEqual(protocolUrls(raw, "auto"), [raw]);
  assert.deepEqual(protocolUrls(raw, "http"), [raw.replace("https:", "http:")]);
  assert.deepEqual(protocolUrls(raw, "both"), [
    raw,
    raw.replace("https:", "http:"),
  ]);
  assert.deepEqual(protocolUrls("example.test/path", "https"), [
    "https://example.test/path",
  ]);
  assert.deepEqual(protocolUrls("file:///bad", "both"), ["file:///bad"]);
});

test("HTTP-only server keeps automatic scheme, supports explicit schemes and both", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(req.url === "/missing" ? 404 : 200, {
      "Content-Type": "text/html",
    });
    res.end('<a href="/child">Child</a>');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `https://127.0.0.1:${(server.address() as { port: number }).port}`;
  const db = new DatabaseService(":memory:");
  const errors: unknown[] = [];
  const service = new ScanService(
    db,
    () => {},
    (error) => errors.push(error),
  );
  const run = async (
    protocol: "auto" | "https" | "http" | "both",
    url = base + "/ok",
    crawl = false,
  ) => {
    const scan = service.start(
      "Protocol test",
      crawl ? "crawl" : "quick",
      url,
      {
        ...defaults,
        allowedPrivateHosts: ["127.0.0.1", "localhost", "::1"],
        protocol,
        retries: 0,
        timeout: 500,
        hostDelay: 0,
        respectRobots: false,
        crawlDepth: 1,
      },
    );
    const end = Date.now() + 8000;
    while (!scan.completedAt && Date.now() < end)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(scan.status, "completed");
    return db.allResults(scan.id);
  };
  try {
    const auto = await run("auto");
    assert.equal(auto.length, 1);
    assert.equal(auto[0].code, null);
    assert.equal(auto[0].originalUrl, base + "/ok");
    assert.equal(auto[0].finalUrl, base + "/ok");
    assert.doesNotMatch(auto[0].label, /fallback/);
    assert.equal((await run("https"))[0].code, null);
    assert.equal((await run("http"))[0].code, 200);
    const both = await run("both");
    assert.equal(both.length, 2);
    assert.equal(both.filter((row) => row.code === 200).length, 1);
    assert.equal(
      (await run("auto", base.replace("https:", "http:") + "/missing"))[0].code,
      404,
    );
    const crawl = await run("http", base + "/ok", true);
    assert.ok(crawl.length > 1);
    assert.ok(crawl.every((row) => row.url.startsWith("http:")));
    assert.deepEqual(errors, []);
  } finally {
    await service.shutdown();
    db.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
