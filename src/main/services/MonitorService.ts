import type { MonitorSession, Settings } from "../../../shared/types";
import { DatabaseService } from "../database/DatabaseService";
import { MonitorStore } from "./MonitorStore";
import { abortableDelay } from "./HttpProbeService";
import { HealthCheckService } from "./HealthCheckService";
import { createResult } from "../utilities/result";
import { QueueService } from "./QueueService";
import { normalizeUrl } from "../utilities/url";

export const monitorIntervals = [5, 10, 20, 30, 60, 120, 300, 600];
export class MonitorService {
  current: MonitorSession | null = null;
  private controller: AbortController | null = null;
  private pending: Promise<void> | null = null;
  private probe = new HealthCheckService();
  private commands: Promise<void> = Promise.resolve();
  private waitController: AbortController | null = null;
  constructor(
    private db: DatabaseService,
    readonly store: MonitorStore,
    private log: (error: unknown) => void,
  ) {}
  async start(
    scanId: string,
    interval: number,
    settings: Settings,
  ): Promise<void> {
    return this.enqueue(() => this.startInternal(scanId, interval, settings));
  }
  private enqueue(action: () => Promise<void>): Promise<void> {
    const next = this.commands.then(action);
    this.commands = next.catch(() => {});
    return next;
  }
  private async startInternal(
    scanId: string,
    interval: number,
    settings: Settings,
  ): Promise<void> {
    if (!monitorIntervals.includes(interval))
      throw new Error("Choose a supported monitoring interval");
    const scan = this.db.history().find((row) => row.id === scanId);
    if (!scan || ["running", "paused"].includes(scan.status))
      throw new Error("Finish the scan before starting monitoring");
    if (this.current?.scanId === scanId) {
      this.store.setInterval(this.current.id, interval);
      this.current.interval = interval;
      this.waitController?.abort();
      return;
    }
    const seen = new Set<string>();
    const entries = this.db.allResults(scanId).flatMap((result) => {
      try {
        if (result.category === "invalid" || result.category === "skipped")
          return [];
        return [result.url].flatMap((raw) => {
          const url = normalizeUrl(raw);
          if (seen.has(url)) return [];
          seen.add(url);
          return [{ name: result.name ?? "", url }];
        });
      } catch {
        return [];
      }
    });
    if (!entries.length)
      throw new Error("This scan has no valid URLs to monitor");
    await this.stopInternal();
    this.current = this.store.start(scanId, interval, entries);
    this.controller = new AbortController();
    const session = this.current,
      signal = this.controller.signal;
    this.pending = this.loop(session, settings, signal)
      .catch((error) => {
        if (!signal.aborted) this.log(error);
      })
      .finally(() => {
        this.store.stop(session.id);
        if (this.current?.id === session.id) {
          this.current = null;
          this.controller = null;
        }
      });
  }
  private async loop(
    session: MonitorSession,
    settings: Settings,
    signal: AbortSignal,
  ): Promise<void> {
    const queue = new QueueService(settings, signal);
    while (!signal.aborted) {
      const targets = this.store.targets(session.id);
      let cursor = 0;
      const outcomes = await Promise.allSettled(
        Array.from(
          { length: Math.min(settings.concurrency, targets.length) },
          async () => {
            while (!signal.aborted) {
              const target = targets[cursor++];
              if (!target) return;
              const config = this.store.config(target.url, settings);
              const diagnostic = await this.probe.check(
                target.url,
                session.scanId,
                settings,
                config,
                signal,
                (u) => queue.acquire(u),
              );
              if (signal.aborted) return;
              diagnostic.checkedAt = new Date().toISOString();
              const result = createResult(target.url, session.scanId, 0);
              result.code = diagnostic.code;
              result.timings.total = diagnostic.responseMs;
              result.checkedAt = diagnostic.checkedAt;
              result.errorCode = diagnostic.errorType;
              this.store.record(target, result, diagnostic);
            }
          },
        ),
      );
      const failure = outcomes.find((outcome) => outcome.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
      this.waitController = new AbortController();
      const abortWait = (): void => {
        this.waitController?.abort();
      };
      signal.addEventListener("abort", abortWait, { once: true });
      if (signal.aborted) abortWait();
      try {
        await abortableDelay(
          session.interval * 1000,
          this.waitController.signal,
        );
      } catch (error) {
        if (!signal.aborted && !this.waitController.signal.aborted) throw error;
      } finally {
        signal.removeEventListener("abort", abortWait);
        this.waitController = null;
      }
    }
  }
  async stop(): Promise<void> {
    return this.enqueue(() => this.stopInternal());
  }
  private async stopInternal(): Promise<void> {
    this.controller?.abort(new Error("Monitoring stopped"));
    await this.pending;
    this.pending = null;
  }
  async shutdown(): Promise<void> {
    await this.stop();
    this.store.close();
  }
}
