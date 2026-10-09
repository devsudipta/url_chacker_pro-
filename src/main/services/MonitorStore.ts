import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type {
  MonitorSession,
  MonitorSnapshot,
  MonitorTarget,
  Outage,
  UrlResult,
  EndpointConfig,
  HealthResult,
  Settings,
} from "../../../shared/types";
import { monitorDefaults } from "../../../shared/monitorDefaults";
import {
  publicConfig,
  redactTree,
  redactUrl,
  secretMarker,
} from "../utilities/redaction";
export interface SecretCodec {
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
}

export class MonitorStore {
  private db: DatabaseSync;
  constructor(
    location: string,
    private codec?: SecretCodec,
  ) {
    this.db = new DatabaseSync(location);
    this.db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    const now = new Date().toISOString();
    this.db
      .prepare(
        "UPDATE outages SET ended_at=? WHERE ended_at IS NULL AND target_id IN (SELECT t.id FROM monitor_targets t JOIN monitor_sessions s ON s.id=t.session_id WHERE s.status='running')",
      )
      .run(now);
    this.db
      .prepare(
        "UPDATE monitor_sessions SET status='interrupted',stopped_at=? WHERE status='running'",
      )
      .run(now);
  }
  start(
    scanId: string,
    interval: number,
    entries: { name: string; url: string }[],
  ): MonitorSession {
    const session: MonitorSession = {
      id: randomUUID(),
      scanId,
      interval,
      status: "running",
      startedAt: new Date().toISOString(),
      stoppedAt: null,
    };
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare("INSERT INTO monitor_sessions VALUES(?,?,?,?,?,?)")
        .run(
          session.id,
          scanId,
          interval,
          session.status,
          session.startedAt,
          null,
        );
      const insert = this.db.prepare(
        "INSERT INTO monitor_targets(id,session_id,name,url) VALUES(?,?,?,?)",
      );
      for (const entry of entries)
        insert.run(randomUUID(), session.id, entry.name, entry.url);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return session;
  }
  targets(sessionId: string): MonitorTarget[] {
    return this.db
      .prepare(
        "SELECT id,session_id AS sessionId,name,url,status,checked_at AS checkedAt,code,response_ms AS responseMs,error,diagnostic FROM monitor_targets WHERE session_id=? ORDER BY name,url",
      )
      .all(sessionId)
      .map((row) => ({
        ...row,
        diagnostic: row.diagnostic ? JSON.parse(String(row.diagnostic)) : null,
      })) as unknown as MonitorTarget[];
  }
  config(url: string, settings?: Settings): EndpointConfig {
    const row = this.db
      .prepare("SELECT configuration,secret FROM endpoint_configs WHERE url=?")
      .get(url) as
      { configuration: string; secret: Uint8Array | null } | undefined;
    if (!row) {
      const config = monitorDefaults(settings);
      if (settings)
        this.db
          .prepare(
            "INSERT INTO endpoint_configs(url,configuration,secret) VALUES(?,?,NULL)",
          )
          .run(url, JSON.stringify(config));
      return config;
    }
    if (row.secret) {
      if (!this.codec)
        throw new Error("Encrypted endpoint settings are unavailable");
      return JSON.parse(this.codec.decrypt(Buffer.from(row.secret)));
    }
    return JSON.parse(row.configuration);
  }
  private targetUrl(id: string): string {
    const row = this.db
      .prepare("SELECT url FROM monitor_targets WHERE id=?")
      .get(id) as { url: string } | undefined;
    if (!row) throw new Error("Unknown monitoring endpoint");
    return row.url;
  }
  publicConfiguration(id: string): EndpointConfig {
    return publicConfig(this.config(this.targetUrl(id)));
  }
  saveConfiguration(id: string, input: EndpointConfig): void {
    const url = this.targetUrl(id),
      old = this.config(url);
    const config = { ...input, headers: { ...input.headers } };
    for (const [key, value] of Object.entries(config.headers))
      if (value === secretMarker) config.headers[key] = old.headers[key] ?? "";
    for (const key of ["body", "expectedText", "jsonExpected"] as const)
      if (config[key] === secretMarker) config[key] = old[key];
    const hasSecrets =
      Object.keys(config.headers).length ||
      config.body ||
      config.expectedText ||
      config.jsonExpected;
    if (hasSecrets && !this.codec)
      throw new Error(
        "Secure credential storage is unavailable; configuration was not saved",
      );
    const secret = hasSecrets
      ? this.codec!.encrypt(JSON.stringify(config))
      : null;
    this.db
      .prepare(
        "INSERT INTO endpoint_configs(url,configuration,secret) VALUES(?,?,?) ON CONFLICT(url) DO UPDATE SET configuration=excluded.configuration,secret=excluded.secret",
      )
      .run(url, JSON.stringify(publicConfig(config)), secret);
  }
  setInterval(id: string, interval: number): void {
    this.db
      .prepare(
        "UPDATE monitor_sessions SET interval_seconds=? WHERE id=? AND status='running'",
      )
      .run(interval, id);
  }
  record(
    target: MonitorTarget,
    result: UrlResult,
    diagnostic?: HealthResult,
  ): void {
    const status = diagnostic
      ? diagnostic.application === "unknown"
        ? "unknown"
        : diagnostic.state === "Healthy"
          ? "online"
          : "offline"
      : result.category === "ssl"
        ? "unknown"
        : result.code !== null &&
            result.code >= 200 &&
            result.code < 400 &&
            !result.errorCode
          ? "online"
          : "offline";
    const now = result.checkedAt;
    this.db.exec("BEGIN");
    try {
      const open = this.db
        .prepare(
          "SELECT id,offline_at FROM outages WHERE target_id=? AND ended_at IS NULL",
        )
        .get(target.id) as { id: string; offline_at: string } | undefined;
      if (status === "offline" && !open)
        this.db
          .prepare("INSERT INTO outages(id,target_id,offline_at) VALUES(?,?,?)")
          .run(randomUUID(), target.id, now);
      if (status === "online" && open)
        this.db
          .prepare(
            "UPDATE outages SET online_at=?,ended_at=?,duration_ms=? WHERE id=?",
          )
          .run(
            now,
            now,
            Math.max(0, Date.parse(now) - Date.parse(open.offline_at)),
            open.id,
          );
      this.db
        .prepare(
          "INSERT INTO monitor_checks(target_id,checked_at,status,code,response_ms,error,diagnostic) VALUES(?,?,?,?,?,?,?)",
        )
        .run(
          target.id,
          now,
          status,
          result.code,
          result.timings.total,
          result.errorCode,
          diagnostic ? JSON.stringify(diagnostic) : null,
        );
      this.db
        .prepare(
          "UPDATE monitor_targets SET status=?,checked_at=?,code=?,response_ms=?,error=?,diagnostic=? WHERE id=?",
        )
        .run(
          status,
          now,
          result.code,
          result.timings.total,
          result.errorCode,
          diagnostic ? JSON.stringify(diagnostic) : null,
          target.id,
        );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  stop(id: string): void {
    const now = new Date().toISOString();
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          "UPDATE outages SET ended_at=? WHERE ended_at IS NULL AND target_id IN (SELECT id FROM monitor_targets WHERE session_id=?)",
        )
        .run(now, id);
      this.db
        .prepare(
          "UPDATE monitor_sessions SET status='stopped',stopped_at=? WHERE id=?",
        )
        .run(now, id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  snapshot(scanId: string, active: MonitorSession | null): MonitorSnapshot {
    const sessions = this.db
      .prepare(
        "SELECT id,scan_id AS scanId,interval_seconds AS interval,status,started_at AS startedAt,stopped_at AS stoppedAt FROM monitor_sessions WHERE scan_id=? ORDER BY started_at DESC,id DESC",
      )
      .all(scanId) as unknown as MonitorSession[];
    const latest = active?.scanId === scanId ? active : sessions[0];
    const outages = this.db
      .prepare(
        "SELECT o.id,o.target_id AS targetId,t.name,t.url,o.offline_at AS offlineAt,o.online_at AS onlineAt,o.ended_at AS endedAt,o.duration_ms AS durationMs FROM outages o JOIN monitor_targets t ON t.id=o.target_id JOIN monitor_sessions s ON s.id=t.session_id WHERE s.scan_id=? ORDER BY o.offline_at DESC,o.id DESC LIMIT 1000",
      )
      .all(scanId) as unknown as Outage[];
    const count = this.db
      .prepare(
        "SELECT COUNT(*) AS total FROM monitor_checks c JOIN monitor_targets t ON t.id=c.target_id JOIN monitor_sessions s ON s.id=t.session_id WHERE s.scan_id=?",
      )
      .get(scanId) as { total: number };
    return {
      active,
      sessions,
      targets: latest
        ? this.targets(latest.id).map((target) => ({
            ...target,
            url: redactUrl(target.url),
          }))
        : [],
      outages: outages.map((outage) => ({
        ...outage,
        url: redactUrl(outage.url),
      })),
      checkCount: count.total,
    };
  }
  export(scanId: string): unknown {
    return redactTree({
      ...this.snapshot(scanId, null),
      outages: this.db
        .prepare(
          "SELECT o.*,t.name,t.url FROM outages o JOIN monitor_targets t ON t.id=o.target_id JOIN monitor_sessions s ON s.id=t.session_id WHERE s.scan_id=? ORDER BY o.offline_at",
        )
        .all(scanId),
      checks: this.db
        .prepare(
          "SELECT c.*,t.name,t.url,t.session_id FROM monitor_checks c JOIN monitor_targets t ON t.id=c.target_id JOIN monitor_sessions s ON s.id=t.session_id WHERE s.scan_id=? ORDER BY c.id",
        )
        .all(scanId),
    });
  }
  close(): void {
    this.db.close();
  }
}
