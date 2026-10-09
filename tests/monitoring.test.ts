import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import ExcelJS from "exceljs";
import { DatabaseService } from "../src/main/database/DatabaseService";
import { migrations } from "../src/main/database/migrations";
import { MonitorStore } from "../src/main/services/MonitorStore";
import { MonitorService } from "../src/main/services/MonitorService";
import { ScanService } from "../src/main/services/ScanService";
import { createResult } from "../src/main/utilities/result";
import { summarize } from "../src/main/utilities/url";
import { importPaths } from "../src/main/services/ImportService";
import { ExportService } from "../src/main/services/ExportService";
import { defaults } from "../shared/defaults";

async function wait(check: () => boolean, timeout = 9000): Promise<void> {
  const end = Date.now() + timeout;
  while (!check() && Date.now() < end)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(check(), "Expected monitoring condition before timeout");
}
test("named URLs survive duplicate parsing, scan storage, searches and report/import round trips", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "named-urls-"));
  const server = http.createServer((_req, res) => res.end("ok"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/a?x=1&x=2`;
  const summary = summarize([
    `Main website | ${url}`,
    `Duplicate | ${url}#fragment`,
  ]);
  assert.equal(summary.names?.[url], "Main website");
  assert.equal(summary.duplicates, 1);
  const db = new DatabaseService(path.join(temp, "data.db"));
  const scanner = new ScanService(
    db,
    () => {},
    (error) => {
      throw error;
    },
  );
  try {
    const scan = scanner.start("Named", "quick", `Main website | ${url}`, {
      ...defaults,
      retries: 0,
      hostDelay: 0,
    });
    await wait(() => scan.status === "completed");
    assert.equal(db.allResults(scan.id)[0].name, "Main website");
    assert.equal(db.allResults(scan.id)[0].originalUrl, url);
    assert.equal(
      db.results({
        scanId: scan.id,
        page: 0,
        search: "Main website",
        filter: "all",
        scope: "both",
        sort: "url",
        direction: "asc",
      }).total,
      1,
    );
    const exporter = new ExportService(db);
    for (const format of ["csv", "xlsx", "json", "html"] as const) {
      const file = path.join(temp, `report.${format}`);
      await exporter.write(scan.id, format, file);
      if (format === "csv" || format === "xlsx")
        assert.equal((await importPaths([file])).names?.[url], "Main website");
      else assert.match(await readFile(file, "utf8"), /Main website/);
    }
    const csv = path.join(temp, "named.csv");
    await writeFile(
      csv,
      `Name,URL\n"My site, primary",${url}\nOther,https://other.example/path`,
    );
    assert.equal((await importPaths([csv])).names?.[url], "My site, primary");
    const workbook = new ExcelJS.Workbook(),
      sheet = workbook.addWorksheet("Links");
    sheet.addRow(["Name", "URL"]);
    sheet.addRow(["Spreadsheet link", url]);
    const xlsx = path.join(temp, "named.xlsx");
    await workbook.xlsx.writeFile(xlsx);
    assert.equal((await importPaths([xlsx])).names?.[url], "Spreadsheet link");
  } finally {
    await scanner.shutdown();
    db.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(temp, { recursive: true, force: true });
  }
});

test("schema migration preserves old scans; outage transitions persist exact durations and repeated failures do not duplicate", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "outage-store-")),
    file = path.join(temp, "data.db");
  const legacy = new DatabaseSync(file);
  legacy.exec(migrations[0]);
  legacy.exec("PRAGMA user_version=1;");
  legacy.close();
  const db = new DatabaseService(file),
    scan = db.createScan("Historical", "quick", null, 1);
  let store = new MonitorStore(file);
  try {
    const session = store.start(scan.id, 5, [
      { name: "Site", url: "https://example.test" },
    ]);
    const target = store.targets(session.id)[0];
    const result = createResult(target.url, scan.id, 0);
    result.code = 200;
    result.errorCode = null;
    result.checkedAt = "2026-10-09T10:00:00.000Z";
    store.record(target, result);
    result.code = 503;
    result.errorCode = "HTTP_503";
    result.checkedAt = "2026-10-09T10:00:05.000Z";
    store.record(target, result);
    result.checkedAt = "2026-10-09T10:00:10.000Z";
    store.record(target, result);
    assert.equal(store.snapshot(scan.id, session).outages.length, 1);
    result.code = 200;
    result.errorCode = null;
    result.checkedAt = "2026-10-09T10:00:20.000Z";
    store.record(target, result);
    const outage = store.snapshot(scan.id, session).outages[0];
    assert.equal(outage.durationMs, 15000);
    assert.equal(outage.onlineAt, result.checkedAt);
    result.code = null;
    result.errorCode = "ECONNREFUSED";
    result.checkedAt = "2026-10-09T10:00:25.000Z";
    store.record(target, result);
    store.setInterval(session.id, 10);
    assert.equal(store.snapshot(scan.id, session).outages.length, 2);
    store.close();
    store = new MonitorStore(file);
    const recovered = store.snapshot(scan.id, null);
    assert.equal(recovered.sessions[0].status, "interrupted");
    assert.equal(
      recovered.outages.find((row) => row.onlineAt)?.durationMs,
      15000,
    );
    assert.equal(
      recovered.outages.find((row) => !row.onlineAt)?.durationMs,
      null,
    );
    assert.ok(recovered.outages.find((row) => !row.onlineAt)?.endedAt);
    assert.equal(recovered.checkCount, 5);
    assert.equal(db.history()[0].name, "Historical");
    db.deleteScan(scan.id);
    assert.equal(store.snapshot(scan.id, null).checkCount, 0);
  } finally {
    store.close();
    db.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test("real monitor rechecks, records offline and recovery, changes interval without losing outages and stops cancellation cleanly", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "monitor-live-"));
  let code = 200,
    slow = false,
    requests = 0;
  const server = http.createServer((_req, res) => {
    requests++;
    if (slow) return;
    res.writeHead(code);
    res.end("response");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const db = new DatabaseService(path.join(temp, "data.db")),
    store = new MonitorStore(db.location),
    errors: unknown[] = [];
  const service = new MonitorService(db, store, (error) => errors.push(error));
  const scan = db.createScan("Live", "quick", null, 1),
    result = createResult(url, scan.id, 0);
  result.name = "Main";
  result.code = 200;
  db.saveResult(result);
  scan.status = "completed";
  db.updateScan(scan);
  const settings = { ...defaults, retries: 0, timeout: 1000, hostDelay: 0 };
  try {
    await assert.rejects(service.start(scan.id, 1, settings), /supported/);
    await service.start(scan.id, 5, settings);
    await wait(() => store.snapshot(scan.id, service.current).checkCount === 1);
    code = 503;
    await wait(
      () => store.snapshot(scan.id, service.current).outages.length === 1,
    );
    const sessionId = service.current!.id;
    await service.start(scan.id, 10, settings);
    assert.equal(service.current!.id, sessionId);
    await wait(() => store.snapshot(scan.id, service.current).checkCount >= 3);
    code = 200;
    await service.start(scan.id, 5, settings);
    await wait(
      () => !!store.snapshot(scan.id, service.current).outages[0].onlineAt,
    );
    const outage = store.snapshot(scan.id, service.current).outages[0];
    assert.ok(outage.durationMs! >= 0);
    assert.equal(store.snapshot(scan.id, service.current).outages.length, 1);
    await service.stop();
    const count = store.snapshot(scan.id, null).checkCount;
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(store.snapshot(scan.id, null).checkCount, count);
    slow = true;
    await service.start(scan.id, 5, settings);
    const previous = requests;
    await wait(() => requests > previous);
    await service.stop();
    assert.equal(store.snapshot(scan.id, null).checkCount, count);
    assert.equal(service.current, null);
    assert.deepEqual(errors, []);
  } finally {
    await service.shutdown();
    db.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(temp, { recursive: true, force: true });
  }
});
