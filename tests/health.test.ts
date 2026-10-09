import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { generate } from "selfsigned";
import { gzipSync } from "node:zlib";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { migrations } from "../src/main/database/migrations";
import { HealthCheckService } from "../src/main/services/HealthCheckService";
import { MonitorStore } from "../src/main/services/MonitorStore";
import { DatabaseService } from "../src/main/database/DatabaseService";
import { monitorDefaults } from "../shared/monitorDefaults";
import { defaults } from "../shared/defaults";
import {
  permittedAddress,
  privateAddress,
} from "../src/main/services/TargetPolicy";
import { publicConfig, redactTree } from "../src/main/utilities/redaction";
import { createResult } from "../src/main/utilities/result";
import { endpointSchema } from "../src/main/utilities/monitorValidation";
import type { EndpointConfig } from "../shared/types";

const service = new HealthCheckService();
const config = (): EndpointConfig => ({
  ...monitorDefaults(),
  retries: 0,
  connectTimeout: 500,
  responseTimeout: 500,
  privateHosts: ["127.0.0.1", "localhost"],
});
const check = (url: string, options: Partial<EndpointConfig> = {}) =>
  service.check(
    url,
    "test",
    defaults,
    { ...config(), ...options },
    new AbortController().signal,
  );
const listen = (server: http.Server | https.Server): Promise<string> =>
  new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve(
        `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      ),
    ),
  );
const close = async (server: http.Server | https.Server): Promise<void> => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
};

test("health checks preserve GET/HEAD/POST/custom methods and exact duplicate/empty query parameters, and evaluate status/text/JSON/time expectations", async () => {
  const received: {
    method: string;
    url: string;
    body: string;
    auth: string | undefined;
  }[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += String(chunk)));
    req.on("end", () => {
      received.push({
        method: req.method!,
        url: req.url!,
        body,
        auth: req.headers.authorization,
      });
      if (req.url?.startsWith("/json")) {
        res.writeHead(200, {
          "content-type": "application/json",
          "content-encoding": "gzip",
        });
        res.end(
          gzipSync(
            JSON.stringify({ health: { ok: true }, token: "do-not-preview" }),
          ),
        );
        return;
      }
      res.writeHead(req.url === "/500" ? 500 : 200, {
        "content-type": "text/plain",
      });
      res.end("103.217.111.97");
    });
  });
  const base = await listen(server);
  try {
    for (const method of [
      "GET",
      "HEAD",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ] as const) {
      const result = await check(
        `${base}/ok?x=1&x=2&=empty&=again&empty=&bare&&encoded=%2f`,
        {
          method,
          body: method === "POST" ? '{"command":"test"}' : "",
          headers: { Authorization: "Bearer api-secret" },
        },
      );
      assert.equal(result.state, "Healthy");
      assert.equal(result.network, "reachable");
      assert.equal(result.tls, "not applicable");
      assert.equal(received.at(-1)?.method, method);
      assert.equal(
        received.at(-1)?.url,
        "/ok?x=1&x=2&=empty&=again&empty=&bare&&encoded=%2f",
      );
      assert.equal(received.at(-1)?.auth, "Bearer api-secret");
      assert.doesNotMatch(
        JSON.stringify(result),
        /api-secret|command|103\.217\.111\.97/,
      );
    }
    assert.equal(
      (await check(`${base}/ok`, { expectedText: "103.217.111.97" })).state,
      "Healthy",
    );
    assert.equal(
      (await check(`${base}/ok`, { expectedText: "not present" })).state,
      "Unexpected Response",
    );
    assert.equal(
      (await check(`${base}/json`, { method: "HEAD" })).state,
      "Healthy",
    );
    const httpError = await check(`${base}/500`);
    assert.equal(httpError.state, "HTTP Error");
    assert.equal(httpError.code, 500);
    assert.equal(httpError.network, "reachable");
    assert.equal(httpError.application, "failed");
    assert.equal(
      (await check(`${base}/500`, { expectedStatuses: [500] })).state,
      "Healthy",
    );
    assert.equal(
      (
        await check(`${base}/json`, {
          jsonPath: "health.ok",
          jsonExpected: "true",
        })
      ).state,
      "Healthy",
    );
    assert.equal(
      (
        await check(`${base}/json`, {
          jsonPath: "health.ok",
          jsonExpected: "false",
        })
      ).state,
      "Unexpected Response",
    );
    assert.equal(
      (
        await check(`${base}/ok`, {
          jsonPath: "health.ok",
          jsonExpected: "true",
        })
      ).state,
      "Unexpected Response",
    );
    assert.equal(
      (await check(`${base}/ok`, { expectedStatuses: [201] })).state,
      "Unexpected Response",
    );
  } finally {
    await close(server);
  }
});

test("refused connections, DNS failures, response timeouts and response thresholds have distinct diagnostics; abort interrupts checks", async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/partial") {
      res.writeHead(200);
      res.write("start");
      return;
    }
    if (req.url === "/reset") {
      req.socket.destroy();
      return;
    }
    setTimeout(() => res.end("ok"), 160);
  });
  const base = await listen(server);
  try {
    const timed = await check(`${base}/slow`, { responseTimeout: 100 });
    assert.equal(timed.state, "Timeout");
    assert.equal(timed.code, null);
    assert.equal(timed.transportErrorCode, "ETIMEDOUT");
    const partial = await check(`${base}/partial`, { responseTimeout: 100 });
    assert.equal(partial.state, "Timeout");
    assert.equal(partial.code, 200);
    assert.equal(partial.network, "reachable");
    assert.equal(partial.application, "failed");
    const reset = await check(`${base}/reset`);
    assert.equal(reset.state, "Network Error");
    assert.equal(reset.network, "reachable");
    assert.equal(reset.application, "failed");
    assert.notEqual(partial.state, "Healthy");
    const slow = await check(`${base}/slow`, { maxResponseMs: 50 });
    assert.equal(slow.state, "Unexpected Response");
    assert.ok(slow.responseMs >= 100);
    const abort = new AbortController();
    const pending = service.check(
      `${base}/partial`,
      "test",
      defaults,
      config(),
      abort.signal,
    );
    setTimeout(() => abort.abort(), 30);
    await assert.rejects(pending);
  } finally {
    await close(server);
  }
  const refused = await check(base);
  assert.equal(refused.state, "Connection Refused");
  assert.equal(refused.network, "unreachable");
  const dns = await check("http://not-a-real-host.urlchecker.invalid", {
    connectTimeout: 3000,
  });
  assert.equal(dns.state, "DNS Error");
  assert.equal(dns.network, "unreachable");
  const hangingTls = net.createServer((socket) => socket.on("data", () => {}));
  await new Promise<void>((resolve) =>
    hangingTls.listen(0, "127.0.0.1", resolve),
  );
  try {
    const result = await check(
      `https://127.0.0.1:${(hangingTls.address() as { port: number }).port}`,
      { connectTimeout: 100, responseTimeout: 2000 },
    );
    assert.equal(result.state, "Timeout");
    assert.ok(result.responseMs < 1000);
  } finally {
    await new Promise<void>((resolve) => hangingTls.close(() => resolve()));
  }
});

test("upgrading a populated 1.2.0 database preserves endpoints, scans, preferences, checks and exact outage durations", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "upgrade-125-")),
    file = path.join(temp, "data.db");
  const legacy = new DatabaseSync(file),
    scanId = randomUUID(),
    sessionId = randomUUID(),
    targetId = randomUUID(),
    outageId = randomUUID();
  const url = "http://example.com/a?x=1&x=2&=empty",
    when = "2026-10-09T00:00:00.000Z",
    recovered = "2026-10-09T00:00:05.000Z";
  legacy.exec(migrations[0]);
  legacy.exec(migrations[1]);
  legacy.exec("PRAGMA user_version=2");
  legacy
    .prepare(
      "INSERT INTO scans(id,name,mode,status,started_at,completed_at,total,checked,counts) VALUES(?,?,?,?,?,?,?,?,?)",
    )
    .run(
      scanId,
      "Old scan",
      "quick",
      "completed",
      when,
      recovered,
      1,
      1,
      '{"online":1}',
    );
  const original = createResult(url, scanId, 0);
  original.name = "Old endpoint";
  original.code = 200;
  original.category = "online";
  legacy
    .prepare(
      "INSERT INTO url_results(id,scan_id,original_url,normalized_url,final_url,status_code,status_category,response_time,checked_at,data) VALUES(?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      original.id,
      scanId,
      url,
      url,
      url,
      200,
      "online",
      12,
      when,
      JSON.stringify(original),
    );
  legacy
    .prepare("INSERT INTO settings VALUES('preferences',?)")
    .run(JSON.stringify({ ...defaults, theme: "light" }));
  legacy
    .prepare("INSERT INTO monitor_sessions VALUES(?,?,?,?,?,?)")
    .run(sessionId, scanId, 5, "stopped", when, recovered);
  legacy
    .prepare(
      "INSERT INTO monitor_targets(id,session_id,name,url,status,checked_at,code,response_ms,error) VALUES(?,?,?,?,?,?,?,?,?)",
    )
    .run(
      targetId,
      sessionId,
      "Old endpoint",
      url,
      "online",
      recovered,
      200,
      12,
      null,
    );
  legacy
    .prepare(
      "INSERT INTO monitor_checks(target_id,checked_at,status,code,response_ms,error) VALUES(?,?,?,?,?,?)",
    )
    .run(targetId, when, "offline", 500, 12, "HTTP_500");
  legacy
    .prepare("INSERT INTO outages VALUES(?,?,?,?,?,?)")
    .run(outageId, targetId, when, recovered, recovered, 5000);
  legacy.close();
  const db = new DatabaseService(file),
    store = new MonitorStore(file);
  try {
    assert.equal(db.history()[0].name, "Old scan");
    assert.equal(db.allResults(scanId)[0].name, "Old endpoint");
    assert.equal(db.allResults(scanId)[0].originalUrl, url);
    assert.equal(db.settings().theme, "light");
    const state = store.snapshot(scanId, null);
    assert.equal(state.targets[0].id, targetId);
    assert.equal(state.targets[0].diagnostic, null);
    assert.equal(state.checkCount, 1);
    assert.equal(state.outages[0].durationMs, 5000);
    assert.equal(state.outages[0].onlineAt, recovered);
  } finally {
    store.close();
    db.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test("TLS verification stays enabled; opted-in separate diagnostics retain the certificate failure and never send secrets or follow redirects", async () => {
  const cert = await generate([{ name: "commonName", value: "localhost" }], {
    keySize: 2048,
    extensions: [
      {
        name: "subjectAltName",
        altNames: [
          { type: 2, value: "localhost" },
          { type: 7, ip: "127.0.0.1" },
        ],
      },
    ],
  });
  const hits: { method: string; url: string; auth: string | undefined }[] = [];
  const server = https.createServer(
    { key: cert.private, cert: cert.cert },
    (req, res) => {
      hits.push({
        method: req.method!,
        url: req.url!,
        auth: req.headers.authorization,
      });
      res.end("sensitive body");
    },
  );
  const base = (await listen(server)).replace("http:", "https:");
  try {
    const verified = await check(`${base}/api?token=secret`);
    assert.equal(verified.state, "TLS Certificate Error");
    assert.equal(verified.application, "unknown");
    assert.equal(verified.network, "reachable");
    assert.equal(verified.tls, "certificate error");
    assert.equal(verified.diagnostic, null);
    assert.equal(hits.length, 0);
    const diagnostic = await check(`${base}/api?token=secret`, {
      insecureDiagnostic: true,
      method: "POST",
      body: "secret body",
      headers: { Authorization: "Bearer secret" },
    });
    assert.equal(diagnostic.state, "TLS Certificate Error");
    assert.equal(diagnostic.code, null);
    assert.equal(diagnostic.diagnostic?.code, 200);
    assert.equal(diagnostic.diagnostic?.verified, false);
    assert.deepEqual(hits, [{ method: "HEAD", url: "/api", auth: undefined }]);
    assert.ok(
      diagnostic.warnings.some((warning) =>
        warning.includes("SECURITY WARNING"),
      ),
    );
    assert.doesNotMatch(
      JSON.stringify(diagnostic),
      /Bearer secret|secret body|sensitive body/,
    );
    const again = await check(base);
    assert.equal(again.state, "TLS Certificate Error");
    assert.equal(hits.length, 1);
    const redirect = http.createServer((_req, res) => {
      res.writeHead(302, { Location: base + "/api?token=secret" });
      res.end();
    });
    const redirectBase = await listen(redirect);
    try {
      const redirected = await check(redirectBase, {
        followRedirects: true,
        redirectOrigins: [base],
        insecureDiagnostic: true,
      });
      assert.equal(redirected.state, "TLS Certificate Error");
      assert.equal(redirected.tls, "certificate error");
      assert.equal(redirected.diagnostic?.url, base + "/api");
      assert.equal(redirected.diagnostic?.code, 200);
      assert.equal(hits.at(-1)?.url, "/api");
      assert.equal(hits.at(-1)?.method, "HEAD");
    } finally {
      await close(redirect);
    }
    const roots = getCACertificates("default");
    try {
      setDefaultCACertificates([...roots, cert.cert]);
      const trusted = await check(base);
      assert.equal(trusted.state, "Healthy");
      assert.equal(trusted.tls, "verified");
      assert.equal(trusted.application, "healthy");
      assert.equal(trusted.diagnostic, null);
    } finally {
      setDefaultCACertificates(roots);
    }
  } finally {
    await close(server);
  }
});

test("retry backoff counts attempts, skips unsafe method replays by default, and never silently rewrites methods or follows unauthorized redirects", async () => {
  let hits = 0;
  const methods: string[] = [];
  const server = http.createServer((req, res) => {
    methods.push(req.method!);
    if (req.url === "/redirect") {
      res.writeHead(303, { Location: "/ok" });
      res.end();
      return;
    }
    if (req.url === "/private") {
      res.writeHead(302, {
        Location: "http://169.254.169.254/latest/meta-data",
      });
      res.end();
      return;
    }
    if (req.url === "/cross") {
      res.writeHead(302, { Location: "http://localhost:12345/secrets" });
      res.end();
      return;
    }
    hits++;
    res.writeHead(hits < 3 ? 503 : 200);
    res.end("ok");
  });
  const base = await listen(server);
  try {
    const started = Date.now();
    const retry = await check(`${base}/retry`, { retries: 2, retryDelay: 100 });
    assert.equal(retry.state, "Healthy");
    assert.equal(retry.attempts, 3);
    assert.ok(Date.now() - started >= 290);
    hits = 0;
    const post = await check(`${base}/retry`, {
      method: "POST",
      retries: 2,
      retryDelay: 100,
    });
    assert.equal(post.attempts, 1);
    assert.equal(hits, 1);
    assert.equal(post.state, "HTTP Error");
    hits = 0;
    assert.equal(
      (
        await check(`${base}/retry`, {
          method: "POST",
          retries: 2,
          retryDelay: 100,
          retryUnsafeMethods: true,
        })
      ).attempts,
      3,
    );
    methods.length = 0;
    const redirect = await check(`${base}/redirect`, {
      method: "POST",
      followRedirects: true,
    });
    assert.equal(redirect.errorType, "METHOD_REDIRECT_BLOCKED");
    assert.deepEqual(methods, ["POST"]);
    assert.equal(
      (await check(`${base}/cross`, { followRedirects: true })).errorType,
      "UNSAFE_REDIRECT",
    );
    assert.equal(
      (
        await check(`${base}/private`, {
          followRedirects: true,
          redirectOrigins: ["http://169.254.169.254"],
        })
      ).errorType,
      "TARGET_BLOCKED",
    );
    const blocked = await check(`${base}/ok`, { privateHosts: [] });
    assert.equal(blocked.errorType, "TARGET_BLOCKED");
    assert.equal(blocked.application, "unknown");
    assert.equal(blocked.network, "unknown");
    const dnsBlocked = await check(base.replace("127.0.0.1", "localhost"), {
      privateHosts: [],
    });
    assert.equal(dnsBlocked.errorType, "TARGET_BLOCKED");
  } finally {
    await close(server);
  }
});

test("private address policy covers alternate IP representations, mapped IPv6 and metadata even with explicit grants", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
  ])
    assert.ok(privateAddress(address), address);
  for (const address of [
    "169.254.169.254",
    "::ffff:169.254.169.254",
    "100.100.100.200",
    "fe80::1",
  ])
    assert.equal(permittedAddress(address, address, [address]), false, address);
  assert.equal(
    permittedAddress("my-lan-host", "192.168.1.2", ["my-lan-host"]),
    true,
  );
  assert.equal(
    permittedAddress("other-host", "192.168.1.2", ["my-lan-host"]),
    false,
  );
  assert.equal(permittedAddress("example.com", "93.184.215.14", []), true);
  assert.equal(
    endpointSchema.safeParse({ ...config(), headers: { Host: "localhost" } })
      .success,
    false,
  );
  assert.equal(
    endpointSchema.safeParse({
      ...config(),
      jsonPath: "__proto__.token",
      jsonExpected: '"secret"',
    }).success,
    false,
  );
});

test("configuration, precise diagnostics and history persist without plaintext API secrets; TLS failures do not fabricate outages/recovery", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "health-store-"));
  const file = path.join(temp, "data.db");
  const key = randomBytes(32);
  const codec = {
    encrypt(value: string): Buffer {
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", key, iv);
      const bytes = Buffer.concat([
        cipher.update(value, "utf8"),
        cipher.final(),
      ]);
      return Buffer.concat([iv, cipher.getAuthTag(), bytes]);
    },
    decrypt(value: Buffer): string {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        value.subarray(0, 12),
      );
      decipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([
        decipher.update(value.subarray(28)),
        decipher.final(),
      ]).toString();
    },
  };
  const db = new DatabaseService(file);
  let store = new MonitorStore(file, codec);
  try {
    const scan = db.createScan("Existing history", "quick", null, 1),
      session = store.start(scan.id, 5, [
        {
          name: "API",
          url: "https://example.com?token=secret-query&=secret-empty",
        },
      ]),
      target = store.targets(session.id)[0];
    const saved = {
      ...config(),
      headers: { Authorization: "Bearer secret-token" },
      body: "secret-body",
      expectedText: "secret-response",
    };
    store.saveConfiguration(target.id, saved);
    assert.deepEqual(store.config(target.url), saved);
    assert.equal(
      store.publicConfiguration(target.id).headers.Authorization,
      "[REDACTED]",
    );
    store.saveConfiguration(target.id, {
      ...publicConfig(saved),
      responseTimeout: 2000,
    });
    assert.equal(
      store.config(target.url).headers.Authorization,
      "Bearer secret-token",
    );
    const server = http.createServer((_req, res) => {
      res.writeHead(500);
      res.end("sensitive response body");
    });
    const base = await listen(server);
    try {
      const diagnostic = await check(base, saved),
        recorded = createResult(target.url, scan.id, 0);
      recorded.code = diagnostic.code;
      recorded.checkedAt = diagnostic.checkedAt;
      recorded.errorCode = diagnostic.errorType;
      recorded.timings.total = diagnostic.responseMs;
      store.record(target, recorded, diagnostic);
      const stored = store.snapshot(scan.id, session).targets[0].diagnostic!;
      assert.equal(stored.state, "HTTP Error");
      assert.equal(stored.code, 500);
      assert.equal(stored.configuration.headers.Authorization, "[REDACTED]");
      assert.equal(stored.errorMessage, diagnostic.errorMessage);
      assert.equal(stored.checkedAt, diagnostic.checkedAt);
    } finally {
      await close(server);
    }
    const result = createResult(target.url, scan.id, 0);
    result.code = 500;
    result.errorCode = "HTTP_500";
    result.checkedAt = "2026-10-09T00:00:00.000Z";
    store.record(target, result);
    result.category = "ssl";
    result.code = null;
    result.errorCode = "SSL_ERROR";
    result.checkedAt = "2026-10-09T00:00:05.000Z";
    store.record(target, result);
    assert.equal(store.snapshot(scan.id, session).targets[0].status, "unknown");
    assert.equal(store.snapshot(scan.id, session).outages.length, 1);
    assert.equal(store.snapshot(scan.id, session).outages[0].onlineAt, null);
    assert.doesNotMatch(
      JSON.stringify(store.export(scan.id)),
      /secret-token|secret-body|secret-response|secret-query|secret-empty/,
    );
    assert.doesNotMatch(
      JSON.stringify(redactTree({ url: target.url })),
      /secret-query|secret-empty/,
    );
    store.close();
    store = new MonitorStore(file, codec);
    assert.equal(
      store.config(target.url).headers.Authorization,
      "Bearer secret-token",
    );
    assert.equal(db.history()[0].name, "Existing history");
  } finally {
    store.close();
    db.close();
  }
  const disk = await readFile(file);
  for (const secret of ["secret-token", "secret-body", "secret-response"])
    assert.equal(disk.includes(Buffer.from(secret)), false);
  await rm(temp, { recursive: true, force: true });
});
