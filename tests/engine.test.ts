import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { generate } from "selfsigned";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ExcelJS from "exceljs";
import { defaults } from "../shared/defaults";
import { normalizeUrl, summarize, isInternal } from "../src/main/utilities/url";
import {
  classify,
  shouldRetry,
  performanceClass,
  networkError,
} from "../src/main/services/classification";
import { HttpProbeService } from "../src/main/services/HttpProbeService";
import { DatabaseService } from "../src/main/database/DatabaseService";
import { ScanService } from "../src/main/services/ScanService";
import { ExportService } from "../src/main/services/ExportService";
import { importPaths } from "../src/main/services/ImportService";
import { discoverLinks } from "../src/main/services/CrawlerService";
import type { Settings } from "../shared/types";

let base: string,
  temp: string,
  active = 0,
  maxActive = 0,
  attempts = 0;
const hits = new Map<string, number>();
const server = http.createServer((req, res) => {
  const url = req.url ?? "/";
  hits.set(url, (hits.get(url) ?? 0) + 1);
  if (url === "/robots-redirect") {
    res.writeHead(302, { Location: "/private" });
    res.end();
    return;
  }
  if (url === "/robots.txt") {
    res.setHeader("Content-Type", "text/plain");
    res.end("User-agent: *\nDisallow: /private");
    return;
  }
  if (url === "/robotsfail/robots.txt") {
    res.writeHead(503);
    res.end();
    return;
  }
  if (url === "/redirect") {
    res.writeHead(301, { Location: "/ok" });
    res.end();
    return;
  }
  if (url === "/redirect-two") {
    res.writeHead(302, { Location: "/redirect" });
    res.end();
    return;
  }
  if (url === "/loop") {
    res.writeHead(302, { Location: "/loop" });
    res.end();
    return;
  }
  if (url === "/unsafe") {
    res.writeHead(302, { Location: "file:///secret" });
    res.end();
    return;
  }
  if (url === "/not-found") {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  if (url === "/blocked") {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  if (url === "/error") {
    res.writeHead(500);
    res.end("error");
    return;
  }
  if (url === "/retry") {
    attempts++;
    res.writeHead(attempts < 3 ? 503 : 200);
    res.end("retry");
    return;
  }
  if (url.startsWith("/slow")) {
    active++;
    maxActive = Math.max(maxActive, active);
    let done = false;
    res.on("close", () => {
      if (!done) {
        done = true;
        active--;
      }
    });
    setTimeout(() => res.end("slow"), 150);
    return;
  }
  if (url === "/" || url === "/about") {
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<a href="/not-found#one">Missing</a><a href="/not-found#two">Also missing</a><a href="/about">About</a><a href="/private">Private</a><img src="/missing.png"><script src="/app.js"></script><link href="/style.css"><iframe src="/frame"></iframe>',
    );
    return;
  }
  if (url === "/missing.png") {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("ok");
});
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  temp = await mkdtemp(path.join(os.tmpdir(), "url-checker-test-"));
});
after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(temp, { recursive: true, force: true });
});
const settings: Settings = {
  ...defaults,
  hostDelay: 0,
  retryDelay: 1,
  retries: 0,
  concurrency: 4,
  perHostConcurrency: 2,
};
const probe = new HttpProbeService();
const check = (route: string, s = settings) =>
  probe.probe(base + route, "scan", s, new AbortController().signal);
const wait = async (condition: () => boolean): Promise<void> => {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Test timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};

test("normalization preserves meaningful scheme, host, path and query distinctions", () => {
  assert.equal(
    normalizeUrl("HTTPS://EXAMPLE.COM:443/a#section"),
    "https://example.com/a",
  );
  assert.equal(
    normalizeUrl("/a?x=1#frag", "https://example.com/path"),
    "https://example.com/a?x=1",
  );
  assert.equal(normalizeUrl("example.com"), "https://example.com/");
  assert.notEqual(
    normalizeUrl("http://example.com"),
    normalizeUrl("https://example.com"),
  );
  assert.notEqual(
    normalizeUrl("https://www.example.com"),
    normalizeUrl("https://example.com"),
  );
  assert.notEqual(
    normalizeUrl("https://example.com/a/"),
    normalizeUrl("https://example.com/a"),
  );
  assert.equal(
    normalizeUrl("https://example.com/a%20b?q=%2F"),
    "https://example.com/a%20b?q=%2F",
  );
});
test("validation rejects protocols, credentials and malformed URLs; summary deduplicates fragments", () => {
  for (const value of [
    "file:///a",
    "javascript:alert(1)",
    "data:foo",
    "https://u:p@example.com",
    "https://",
    "a b",
  ])
    assert.throws(() => normalizeUrl(value));
  assert.deepEqual(
    summarize([
      "https://example.com/#a",
      "https://example.com/#b",
      "data:foo",
      "",
    ]),
    {
      urls: ["https://example.com/"],
      invalid: ["data:foo"],
      duplicates: 1,
      imported: 3,
    },
  );
});
test("status classes, network failures and retry rules retain actual causes", () => {
  for (const code of [200, 201, 204])
    assert.equal(classify(code).category, "online");
  assert.equal(classify(403).category, "blocked");
  assert.equal(classify(404).category, "broken");
  assert.equal(classify(429).category, "rate-limited");
  assert.equal(shouldRetry({ code: 404, errorCode: "HTTP_404" }), false);
  assert.equal(shouldRetry({ code: 503, errorCode: "HTTP_503" }), true);
  assert.equal(
    networkError({ code: "ENOTFOUND", message: "host" }).code,
    "DNS_NOT_FOUND",
  );
  assert.equal(
    networkError({ code: "CERT_HAS_EXPIRED", message: "cert" }).category,
    "ssl",
  );
  assert.equal(performanceClass(500, defaults), "normal");
  assert.equal(performanceClass(3000, defaults), "slow");
});
test("internal classification and crawler preserve all distinct source references", () => {
  assert.equal(
    isInternal("https://example.com/a", "http://example.com/"),
    true,
  );
  assert.equal(isInternal("https://other.com/a", "http://example.com/"), false);
  const links = discoverLinks(
    '<a href="/a#1">One</a><a href="/a#2">Two</a><a href="/a#1">One</a><img src="/x"><a href="javascript:x">No</a>',
    base,
    base,
    true,
  );
  assert.equal(links.length, 3);
  assert.equal(new Set(links.map((l) => l.normalizedTarget)).size, 2);
  assert.equal(links[0].anchor, "One");
});
test("local HTTP probe measures success, errors, redirects, loops and timeout", async () => {
  const ok = await check("/ok");
  assert.equal(ok.result.code, 200);
  assert.ok(ok.result.timings.total >= 0);
  assert.equal(ok.result.timings.tls, null);
  assert.equal(ok.result.timings.dns, null);
  assert.equal((await check("/not-found")).result.errorCode, "HTTP_404");
  assert.equal((await check("/blocked")).result.category, "blocked");
  assert.equal((await check("/error")).result.code, 500);
  const redirected = (await check("/redirect-two")).result;
  assert.equal(redirected.redirects.length, 2);
  assert.equal(redirected.finalUrl, base + "/ok");
  assert.equal(redirected.code, 200);
  assert.equal((await check("/loop")).result.errorCode, "REDIRECT_LOOP");
  assert.equal(
    (await check("/redirect-two", { ...settings, maxRedirects: 1 })).result
      .errorCode,
    "TOO_MANY_REDIRECTS",
  );
  assert.equal((await check("/unsafe")).result.errorCode, "INVALID_URL");
  assert.equal(
    (await check("/slow", { ...settings, timeout: 30 })).result.errorCode,
    "REQUEST_TIMEOUT",
  );
  assert.equal(
    (
      await probe.probe(
        "file:///a",
        "scan",
        settings,
        new AbortController().signal,
      )
    ).result.errorCode,
    "INVALID_URL",
  );
  const refused = await probe.probe(
    "http://127.0.0.1:1",
    "scan",
    settings,
    new AbortController().signal,
  );
  assert.equal(refused.result.errorCode, "CONNECTION_REFUSED");
});
test("retry selected transient responses and stop retrying permanent responses", async () => {
  attempts = 0;
  const output = await probe.withRetries(
    base + "/retry",
    "scan",
    { ...settings, retries: 2 },
    new AbortController().signal,
  );
  assert.equal(output.result.attempts, 3);
  assert.equal(output.result.code, 200);
  const missing = await probe.withRetries(
    base + "/not-found",
    "scan",
    { ...settings, retries: 2 },
    new AbortController().signal,
  );
  assert.equal(missing.result.attempts, 1);
});
test("scan concurrency, pause/resume, persistence, history and cancellation", async () => {
  const file = path.join(temp, "queue.db");
  const db = new DatabaseService(file);
  const scans = new ScanService(
    db,
    () => undefined,
    (error) => {
      throw error;
    },
  );
  maxActive = 0;
  const scan = scans.start(
    "Queue test",
    "quick",
    Array.from({ length: 8 }, (_, i) => `${base}/slow?i=${i}`).join("\n"),
    settings,
  );
  await wait(() => maxActive >= 2);
  await scans.control("pause");
  await new Promise((r) => setTimeout(r, 180));
  const checked = scan.checked;
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(scan.checked, checked);
  await scans.control("resume");
  await wait(() => scan.status === "completed");
  assert.equal(scan.checked, 8);
  assert.ok(maxActive <= 2);
  assert.ok(maxActive > 1);
  const rows = db.results({
    scanId: scan.id,
    page: 0,
    search: "",
    filter: "all",
    scope: "both",
    sort: "url",
    direction: "asc",
  });
  assert.equal(rows.total, 8);
  const cancelled = scans.start(
    "Cancel",
    "quick",
    `${base}/slow?cancel=1\n${base}/slow?cancel=2`,
    settings,
  );
  await scans.control("stop");
  assert.equal(cancelled.status, "cancelled");
  db.close();
  const reopened = new DatabaseService(file);
  assert.equal(reopened.history().length, 2);
  assert.equal(reopened.allResults(scan.id).length, 8);
  reopened.close();
});
test("crawl deduplicates requests, obeys robots/depth/URL limits, records multiple sources", async () => {
  const db = new DatabaseService(path.join(temp, "crawl.db"));
  const scanner = new ScanService(
    db,
    () => undefined,
    (error) => {
      throw error;
    },
  );
  hits.clear();
  const scan = scanner.start("Crawl", "crawl", base + "/", {
    ...settings,
    crawlDepth: 2,
    maxPages: 20,
  });
  await wait(() => scan.status === "completed");
  assert.equal(hits.get("/private"), undefined);
  assert.equal(hits.get("/not-found"), 1);
  const missing = db
    .allResults(scan.id)
    .find((r) => r.url === base + "/not-found")!;
  const detail = db.detail(missing.id);
  assert.equal(detail.sources.length, 4);
  assert.equal(db.dashboard(scan.id).brokenInternal, 2);
  assert.equal(
    db.allResults(scan.id).find((r) => r.url === base + "/private")!.category,
    "skipped",
  );
  const depthZero = scanner.start("Depth zero", "crawl", base + "/", {
    ...settings,
    crawlDepth: 0,
  });
  await wait(() => depthZero.status === "completed");
  assert.equal(depthZero.checked, 1);
  const limited = scanner.start("Limited", "crawl", base + "/", {
    ...settings,
    maxPages: 3,
  });
  await wait(() => limited.status === "completed");
  assert.equal(limited.checked, 3);
  db.close();
});
test("CSV/XLSX import and all export formats roundtrip through real files", async () => {
  const db = new DatabaseService(path.join(temp, "export.db"));
  const scan = db.createScan("Export", "quick", null, 2);
  const output = await check("/ok");
  output.result.scanId = scan.id;
  db.saveResult(output.result);
  const exporter = new ExportService(db);
  for (const format of ["csv", "xlsx", "json", "html"] as const) {
    const file = path.join(temp, `report.${format}`);
    await exporter.write(scan.id, format, file);
    assert.ok((await readFile(file)).length > 0);
    if (format === "csv" || format === "xlsx")
      assert.equal((await importPaths([file])).urls[0], base + "/ok");
  }
  await writeFile(
    path.join(temp, "single.csv"),
    `URL\n${base}/ok\n${base}/ok#fragment\nfile:///bad`,
  );
  const summary = await importPaths([path.join(temp, "single.csv")]);
  assert.equal(summary.duplicates, 1);
  assert.equal(summary.invalid.length, 1);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path.join(temp, "report.xlsx"));
  assert.ok(workbook.getWorksheet("Source Pages"));
  db.close();
});
test("interrupted scans recover on reopen and deletion cascades", () => {
  const file = path.join(temp, "recovery.db");
  let db = new DatabaseService(file);
  const scan = db.createScan("Interrupted", "quick", null, 1);
  db.close();
  db = new DatabaseService(file);
  assert.equal(db.history()[0].status, "interrupted");
  db.deleteScan(scan.id);
  assert.equal(db.history().length, 0);
  db.close();
});

test("TLS validates trusted certificates, rejects untrusted/expired/mismatched certificates", async () => {
  const authorities = getCACertificates("default");
  const valid = await generate([{ name: "commonName", value: "localhost" }], {
    notAfterDate: new Date(Date.now() + 7 * 86400000),
    extensions: [
      { name: "basicConstraints", cA: true },
      {
        name: "subjectAltName",
        altNames: [
          { type: 7, ip: "127.0.0.1" },
          { type: 2, value: "localhost" },
        ],
      },
    ],
  });
  const mismatch = await generate(
    [{ name: "commonName", value: "different.test" }],
    {
      extensions: [
        { name: "basicConstraints", cA: true },
        {
          name: "subjectAltName",
          altNames: [{ type: 2, value: "different.test" }],
        },
      ],
    },
  );
  const expired = await generate([{ name: "commonName", value: "localhost" }], {
    notBeforeDate: new Date(Date.now() - 7 * 86400000),
    notAfterDate: new Date(Date.now() - 86400000),
    extensions: [
      { name: "basicConstraints", cA: true },
      { name: "subjectAltName", altNames: [{ type: 7, ip: "127.0.0.1" }] },
    ],
  });
  const servers: https.Server[] = [];
  async function serve(certificate: {
    private: string;
    cert: string;
  }): Promise<string> {
    const local = https.createServer(
      { key: certificate.private, cert: certificate.cert },
      (_req, res) => res.end("secure"),
    );
    servers.push(local);
    await new Promise<void>((resolve) => local.listen(0, "127.0.0.1", resolve));
    return `https://127.0.0.1:${(local.address() as { port: number }).port}`;
  }
  try {
    const url = await serve(valid);
    assert.equal(
      (await probe.probe(url, "scan", settings, new AbortController().signal))
        .result.category,
      "ssl",
    );
    setDefaultCACertificates([
      ...authorities,
      valid.cert,
      mismatch.cert,
      expired.cert,
    ]);
    const success = (
      await probe.probe(url, "scan", settings, new AbortController().signal)
    ).result;
    assert.equal(success.code, 200);
    assert.equal(success.ssl?.valid, true);
    assert.equal(success.ssl?.hostnameValid, true);
    assert.ok(success.timings.tls !== null);
    assert.ok((success.ssl?.daysRemaining ?? 0) > 0);
    const mismatchResult = (
      await probe.probe(
        await serve(mismatch),
        "scan",
        settings,
        new AbortController().signal,
      )
    ).result;
    assert.equal(mismatchResult.errorCode, "SSL_HOSTNAME_MISMATCH");
    const expiredResult = (
      await probe.probe(
        await serve(expired),
        "scan",
        settings,
        new AbortController().signal,
      )
    ).result;
    assert.equal(expiredResult.errorCode, "SSL_EXPIRED");
  } finally {
    setDefaultCACertificates(authorities);
    for (const local of servers) {
      local.closeAllConnections();
      await new Promise<void>((resolve) => local.close(() => resolve()));
    }
  }
});

test("redirect destinations obey robots policy", async () => {
  const db = new DatabaseService(path.join(temp, "robots-redirect.db"));
  const scanner = new ScanService(
    db,
    () => undefined,
    (error) => {
      throw error;
    },
  );
  hits.clear();
  const scan = scanner.start(
    "Robots redirect",
    "crawl",
    base + "/robots-redirect",
    settings,
  );
  await wait(() => scan.status === "completed");
  assert.equal(hits.get("/private"), undefined);
  assert.equal(db.allResults(scan.id)[0].errorCode, "ROBOTS_DISALLOWED");
  db.close();
});

test("comparison identifies fixed links, regressions and new redirects", async () => {
  const db = new DatabaseService(path.join(temp, "comparison.db"));
  const first = db.createScan("Before", "quick", null, 2),
    second = db.createScan("After", "quick", null, 2);
  const oldMissing = (await check("/not-found")).result;
  oldMissing.scanId = first.id;
  db.saveResult(oldMissing);
  const fixed = (await check("/ok")).result;
  fixed.scanId = second.id;
  fixed.url = oldMissing.url;
  db.saveResult(fixed);
  const previous = (await check("/ok")).result;
  previous.scanId = first.id;
  db.saveResult(previous);
  const redirected = (await check("/redirect")).result;
  redirected.scanId = second.id;
  redirected.url = previous.url;
  db.saveResult(redirected);
  const changes = db.compare(first.id, second.id);
  assert.equal(changes.find((c) => c.url === oldMissing.url)?.change, "Fixed");
  assert.equal(
    changes.find((c) => c.url === previous.url)?.change,
    "Redirect changed",
  );
  const other = db.createScan("Other project", "crawl", base + "/", 1);
  assert.throws(() => db.compare(first.id, other.id));
  db.close();
});

test("response timing excludes the queue wait and retains original input", async () => {
  const start = Date.now();
  const output = await probe.probe(
    base + "/ok#original",
    "scan",
    settings,
    new AbortController().signal,
    0,
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return () => undefined;
    },
  );
  assert.ok(Date.now() - start - output.result.timings.total >= 250);
  assert.equal(output.result.originalUrl, base + "/ok#original");
  assert.equal(output.result.url, base + "/ok");
  const db = new DatabaseService(path.join(temp, "original.db"));
  const scanner = new ScanService(
    db,
    () => undefined,
    (error) => {
      throw error;
    },
  );
  const scan = scanner.start(
    "Original",
    "quick",
    base + "/ok#original\n" + base + "/ok#duplicate",
    settings,
  );
  await wait(() => scan.status === "completed");
  assert.equal(scan.checked, 1);
  assert.equal(db.allResults(scan.id)[0].originalUrl, base + "/ok#original");
  db.close();
});
