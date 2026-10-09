import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type {
  Comparison,
  Dashboard,
  ResultQuery,
  ResultsPage,
  Scan,
  Settings,
  SourceLink,
  UrlResult,
} from "../../../shared/types";
import { defaults } from "../../../shared/defaults";
import { migrations } from "./migrations";
import { settingsSchema } from "../utilities/validation";

interface StoredResult {
  data: string;
}
interface StoredScan {
  id: string;
  name: string;
  mode: Scan["mode"];
  base_url: string | null;
  status: Scan["status"];
  started_at: string;
  completed_at: string | null;
  total: number;
  checked: number;
  counts: string;
}
const readResult = (row: StoredResult): UrlResult =>
  JSON.parse(row.data) as UrlResult;
const readScan = (r: StoredScan): Scan => ({
  id: r.id,
  name: r.name,
  mode: r.mode,
  baseUrl: r.base_url,
  status: r.status,
  startedAt: r.started_at,
  completedAt: r.completed_at,
  total: r.total,
  checked: r.checked,
  counts: JSON.parse(r.counts) as Record<string, number>,
});
export class DatabaseService {
  private db: DatabaseSync;
  constructor(readonly location: string) {
    this.db = new DatabaseSync(location);
    this.db.exec(
      "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
    );
    const version = (
      this.db.prepare("PRAGMA user_version").get() as { user_version: number }
    ).user_version;
    migrations.slice(version).forEach((migration, i) =>
      this.transaction(() => {
        this.db.exec(migration);
        this.db.exec(`PRAGMA user_version = ${version + i + 1}`);
      }),
    );
    this.db
      .prepare(
        "UPDATE scans SET status='interrupted', completed_at=? WHERE status IN ('running','paused')",
      )
      .run(new Date().toISOString());
  }
  settings(): Settings {
    const row = this.db
      .prepare("SELECT value FROM settings WHERE key='preferences'")
      .get() as { value: string } | undefined;
    if (!row) return { ...defaults };
    const parsed = settingsSchema.safeParse(JSON.parse(row.value));
    return parsed.success ? parsed.data : { ...defaults };
  }
  saveSettings(settings: Settings): Settings {
    this.db
      .prepare(
        "INSERT INTO settings VALUES('preferences',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(JSON.stringify(settings));
    return settings;
  }
  createScan(
    name: string,
    mode: Scan["mode"],
    baseUrl: string | null,
    total: number,
  ): Scan {
    const scan: Scan = {
      id: randomUUID(),
      name,
      mode,
      baseUrl,
      status: "running",
      startedAt: new Date().toISOString(),
      completedAt: null,
      total,
      checked: 0,
      counts: {},
    };
    const projectKey = baseUrl ? new URL(baseUrl).origin : "quick";
    let project = this.db
      .prepare("SELECT id FROM projects WHERE base_url=?")
      .get(projectKey) as { id: string } | undefined;
    if (!project) {
      project = { id: randomUUID() };
      this.db
        .prepare("INSERT INTO projects VALUES(?,?,?,?,?)")
        .run(
          project.id,
          projectKey,
          projectKey,
          scan.startedAt,
          scan.startedAt,
        );
    }
    this.db
      .prepare(
        "INSERT INTO scans(id,project_id,name,mode,base_url,status,started_at,total) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        scan.id,
        project.id,
        name,
        mode,
        baseUrl,
        scan.status,
        scan.startedAt,
        total,
      );
    return scan;
  }
  updateScan(scan: Scan): void {
    this.db
      .prepare(
        "UPDATE scans SET status=?,completed_at=?,total=?,checked=?,counts=? WHERE id=?",
      )
      .run(
        scan.status,
        scan.completedAt,
        scan.total,
        scan.checked,
        JSON.stringify(scan.counts),
        scan.id,
      );
  }
  saveResult(result: UrlResult): void {
    this.transaction(() => {
      this.db
        .prepare("INSERT INTO url_results VALUES(?,?,?,?,?,?,?,?,?,?,?)")
        .run(
          result.id,
          result.scanId,
          result.originalUrl,
          result.url,
          result.finalUrl,
          result.code,
          result.category,
          result.errorCode,
          result.timings.total,
          result.checkedAt,
          JSON.stringify(result),
        );
      const insert = this.db.prepare(
        "INSERT INTO redirects(url_result_id,sequence,source_url,destination_url,status_code) VALUES(?,?,?,?,?)",
      );
      result.redirects.forEach((r, i) =>
        insert.run(result.id, i, r.source, r.destination, r.code),
      );
      if (result.ssl) {
        const s = result.ssl;
        this.db
          .prepare("INSERT INTO ssl_results VALUES(?,?,?,?,?,?,?,?,?)")
          .run(
            result.id,
            Number(s.valid),
            s.issuer,
            s.subject,
            s.validFrom,
            s.validTo,
            s.daysRemaining,
            Number(s.hostnameValid),
            s.error,
          );
      }
    });
  }
  saveSources(scanId: string, sources: SourceLink[]): void {
    const statement = this.db.prepare(
      "INSERT OR IGNORE INTO discovered_links(scan_id,source_url,target_url,normalized_target_url,element_type,anchor_text,internal_external,asset) VALUES(?,?,?,?,?,?,?,?)",
    );
    this.transaction(() =>
      sources.forEach((l) =>
        statement.run(
          scanId,
          l.source,
          l.target,
          l.normalizedTarget,
          l.element,
          l.anchor,
          l.scope,
          Number(l.asset),
        ),
      ),
    );
  }
  history(): Scan[] {
    return (
      this.db
        .prepare("SELECT * FROM scans ORDER BY started_at DESC")
        .all() as unknown as StoredScan[]
    ).map(readScan);
  }
  results(query: ResultQuery): ResultsPage {
    let where = "r.scan_id=?";
    const args: (string | number)[] = [query.scanId];
    if (query.search) {
      where +=
        " AND (r.normalized_url LIKE ? OR r.error_code LIKE ? OR json_extract(r.data,'$.name') LIKE ?)";
      args.push(`%${query.search}%`, `%${query.search}%`, `%${query.search}%`);
    }
    const filters: Record<string, string> = {
      online: "r.status_category='online'",
      broken:
        "(r.status_category IN ('broken','dns','connection','ssl','timeout','error','invalid') OR r.error_code IN ('REDIRECT_LOOP','TOO_MANY_REDIRECTS'))",
      redirect:
        "(EXISTS(SELECT 1 FROM redirects d WHERE d.url_result_id=r.id) OR r.status_category='redirect')",
      timeout: "r.status_category='timeout'",
      slow: "json_extract(r.data,'$.performance') IN ('slow','very slow')",
      ssl: "(r.status_category='ssl' OR EXISTS(SELECT 1 FROM ssl_results s WHERE s.url_result_id=r.id AND (s.valid=0 OR s.days_remaining<30)))",
      "4xx": "r.status_code BETWEEN 400 AND 499",
      "5xx": "r.status_code BETWEEN 500 AND 599",
      asset:
        "EXISTS(SELECT 1 FROM discovered_links l WHERE l.scan_id=r.scan_id AND l.normalized_target_url=r.normalized_url AND l.asset=1)",
    };
    if (filters[query.filter]) where += ` AND ${filters[query.filter]}`;
    if (query.scope !== "both") {
      where +=
        " AND EXISTS(SELECT 1 FROM discovered_links l WHERE l.scan_id=r.scan_id AND l.normalized_target_url=r.normalized_url AND l.internal_external=?)";
      args.push(query.scope);
    }
    const sort = {
      url: "normalized_url",
      code: "status_code",
      time: "response_time",
      checkedAt: "checked_at",
    }[query.sort];
    const total = (
      this.db
        .prepare(`SELECT COUNT(*) AS count FROM url_results r WHERE ${where}`)
        .get(...args) as { count: number }
    ).count;
    const rows = (
      this.db
        .prepare(
          `SELECT r.data FROM url_results r WHERE ${where} ORDER BY r.${sort} ${query.direction === "asc" ? "ASC" : "DESC"},r.id LIMIT 100 OFFSET ?`,
        )
        .all(...args, query.page * 100) as unknown as StoredResult[]
    ).map(readResult);
    return { rows, total };
  }
  allResults(scanId: string): UrlResult[] {
    return (
      this.db
        .prepare(
          "SELECT data FROM url_results WHERE scan_id=? ORDER BY normalized_url",
        )
        .all(scanId) as unknown as StoredResult[]
    ).map(readResult);
  }
  detail(id: string): { result: UrlResult; sources: SourceLink[] } {
    const row = this.db
      .prepare("SELECT data FROM url_results WHERE id=?")
      .get(id) as StoredResult | undefined;
    if (!row) throw new Error("Result not found");
    const result = readResult(row);
    return { result, sources: this.sources(result.scanId, result.url) };
  }
  sources(scanId: string, url?: string): SourceLink[] {
    return this.db
      .prepare(
        `SELECT source_url AS source,target_url AS target,normalized_target_url AS normalizedTarget,element_type AS element,anchor_text AS anchor,internal_external AS scope,asset FROM discovered_links WHERE scan_id=? ${url ? "AND normalized_target_url=?" : ""}`,
      )
      .all(...(url ? [scanId, url] : [scanId])) as unknown as SourceLink[];
  }
  dashboard(scanId: string): Dashboard {
    const counts: Record<string, number> = {};
    for (const row of this.db
      .prepare(
        "SELECT status_category AS category,COUNT(*) AS count FROM url_results WHERE scan_id=? GROUP BY status_category",
      )
      .all(scanId) as { category: string; count: number }[])
      counts[row.category] = row.count;
    for (const filter of ["broken", "redirect", "slow", "ssl", "asset"])
      counts[filter] = this.results({
        scanId,
        page: 0,
        search: "",
        scope: "both",
        filter,
        sort: "url",
        direction: "asc",
      }).total;
    counts.total = (
      this.db
        .prepare("SELECT COUNT(*) AS n FROM url_results WHERE scan_id=?")
        .get(scanId) as { n: number }
    ).n;
    const average = (
      this.db
        .prepare(
          "SELECT AVG(response_time) AS value FROM url_results WHERE scan_id=? AND status_code IS NOT NULL",
        )
        .get(scanId) as { value: number | null }
    ).value;
    const slowest = (
      this.db
        .prepare(
          "SELECT data FROM url_results WHERE scan_id=? AND status_code IS NOT NULL ORDER BY response_time DESC LIMIT 5",
        )
        .all(scanId) as unknown as StoredResult[]
    ).map(readResult);
    const errors = this.db
      .prepare(
        "SELECT error_code AS code,COUNT(*) AS count FROM url_results WHERE scan_id=? AND error_code IS NOT NULL GROUP BY error_code ORDER BY count DESC LIMIT 6",
      )
      .all(scanId) as Dashboard["errors"];
    const scopeCount = (scope: string, broken: boolean): number =>
      (
        this.db
          .prepare(
            `SELECT COUNT(DISTINCT l.normalized_target_url) AS n FROM discovered_links l LEFT JOIN url_results r ON r.scan_id=l.scan_id AND r.normalized_url=l.normalized_target_url WHERE l.scan_id=? AND l.internal_external=? ${broken ? "AND (r.status_category IN ('broken','dns','connection','ssl','timeout','error','invalid') OR r.error_code IN ('REDIRECT_LOOP','TOO_MANY_REDIRECTS'))" : ""}`,
          )
          .get(scanId, scope) as { n: number }
      ).n;
    return {
      counts,
      average,
      slowest,
      errors,
      internal: scopeCount("internal", false),
      external: scopeCount("external", false),
      brokenInternal: scopeCount("internal", true),
      brokenExternal: scopeCount("external", true),
    };
  }
  deleteScan(id: string): void {
    this.db.prepare("DELETE FROM scans WHERE id=?").run(id);
  }
  compare(first: string, second: string): Comparison[] {
    const scans = this.db
      .prepare("SELECT id,project_id FROM scans WHERE id IN (?,?)")
      .all(first, second) as { id: string; project_id: string }[];
    if (scans.length !== 2 || scans[0].project_id !== scans[1].project_id)
      throw new Error("Select two different scans of the same project");
    const before = new Map(this.allResults(first).map((r) => [r.url, r]));
    const changes: Comparison[] = [];
    const bad = (r: UrlResult): boolean =>
      !!r.errorCode || (r.code ?? 0) >= 400;
    for (const result of this.allResults(second)) {
      const previous = before.get(result.url);
      let change = "";
      if (!previous) change = bad(result) ? "New problem" : "New URL";
      else if (bad(previous) && !bad(result)) change = "Fixed";
      else if (!bad(previous) && bad(result)) change = "New problem";
      else if (
        previous.code !== result.code ||
        previous.errorCode !== result.errorCode
      )
        change = "Status changed";
      else if (
        previous.redirects.length !== result.redirects.length ||
        previous.finalUrl !== result.finalUrl
      )
        change = "Redirect changed";
      else if (
        previous.ssl?.valid !== result.ssl?.valid ||
        previous.ssl?.validTo !== result.ssl?.validTo
      )
        change = "SSL changed";
      else if (
        result.timings.total > previous.timings.total * 1.5 &&
        result.timings.total - previous.timings.total > 500
      )
        change = "Performance regression";
      if (change)
        changes.push({
          url: result.url,
          before: previous?.code ?? null,
          after: result.code,
          change,
          delta: result.timings.total - (previous?.timings.total ?? 0),
        });
      before.delete(result.url);
    }
    for (const r of before.values())
      changes.push({
        url: r.url,
        before: r.code,
        after: null,
        change: "No longer scanned",
        delta: 0,
      });
    return changes;
  }
  private transaction(action: () => void): void {
    this.db.exec("SAVEPOINT database_operation");
    try {
      action();
      this.db.exec("RELEASE database_operation");
    } catch (error) {
      this.db.exec(
        "ROLLBACK TO database_operation; RELEASE database_operation",
      );
      throw error;
    }
  }
  close(): void {
    this.db.close();
  }
}
