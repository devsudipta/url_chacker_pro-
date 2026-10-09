import robotsParser from "robots-parser";
import type {
  Progress,
  Scan,
  ScanMode,
  Settings,
  UrlResult,
} from "../../../shared/types";
import { DatabaseService } from "../database/DatabaseService";
import { HttpProbeService, abortableDelay } from "./HttpProbeService";
import { QueueService } from "./QueueService";
import { discoverLinks } from "./CrawlerService";
import { summarize, normalizeUrl, parseNamedUrl } from "../utilities/url";
import { createResult } from "../utilities/result";
import { protocolUrls } from "../utilities/protocol";

interface Job {
  url: string;
  depth: number;
  expand: boolean;
}
export class ScanService {
  current: Scan | null = null;
  private controller: AbortController | null = null;
  private queue: QueueService | null = null;
  private probe = new HttpProbeService();
  private timer: ReturnType<typeof setInterval> | null = null;
  private active = 0;
  private stopping: Promise<void> | null = null;
  constructor(
    private db: DatabaseService,
    private publish: (progress: Progress) => void,
    private log: (error: unknown) => void,
  ) {}
  start(name: string, mode: ScanMode, text: string, settings: Settings): Scan {
    if (this.current && ["running", "paused"].includes(this.current.status))
      throw new Error("Stop or finish the active scan first");
    const summary = summarize(text.split(/\r?\n/));
    if (!summary.urls.length && !summary.invalid.length)
      throw new Error("Enter at least one URL");
    if (
      mode === "crawl" &&
      (summary.urls.length !== 1 || summary.invalid.length)
    )
      throw new Error("Website Crawl needs one valid starting URL");
    const originals = new Map<string, string>();
    for (const raw of text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)) {
      try {
        const entered = parseNamedUrl(raw).url;
        const normalized = normalizeUrl(entered);
        if (!originals.has(normalized)) originals.set(normalized, entered);
      } catch {
        /* Invalid entries remain diagnostic results. */
      }
    }
    const inputUrls = [
      ...summary.urls.map((url) =>
        mode === "quick" ? (originals.get(url) ?? url) : url,
      ),
      ...new Set(summary.invalid),
    ];
    const urls = [
      ...new Set(
        inputUrls.flatMap((raw) => protocolUrls(raw, settings.protocol)),
      ),
    ];
    const names = new Map<string, string>();
    for (const [url, name] of Object.entries(summary.names ?? {})) {
      for (const target of protocolUrls(url, settings.protocol))
        names.set(normalizeUrl(target), name);
    }
    const base = mode === "crawl" ? normalizeUrl(urls[0]) : null;
    const scan = this.db.createScan(
      name ||
        `${mode === "crawl" ? "Website crawl" : "Quick scan"} · ${new Date().toLocaleString()}`,
      mode,
      base,
      urls.length,
    );
    this.current = scan;
    this.active = 0;
    this.controller = new AbortController();
    this.queue = new QueueService(settings, this.controller.signal);
    this.timer = setInterval(() => this.emit(), 300);
    this.stopping = this.run(
      scan,
      urls,
      settings,
      this.controller.signal,
      names,
    )
      .catch((error) => {
        this.log(error);
        scan.status = "interrupted";
      })
      .finally(() => {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        scan.completedAt = new Date().toISOString();
        this.db.updateScan(scan);
        this.emit();
      });
    this.emit();
    return scan;
  }
  async control(action: "pause" | "resume" | "stop"): Promise<void> {
    if (!this.current || !this.queue) return;
    if (action === "stop") {
      this.current.status = "cancelled";
      this.controller?.abort(new Error("Scan cancelled"));
      await this.stopping;
    } else if (["running", "paused"].includes(this.current.status)) {
      this.queue.paused = action === "pause";
      this.current.status = action === "pause" ? "paused" : "running";
      this.db.updateScan(this.current);
      this.emit();
    }
  }
  async shutdown(): Promise<void> {
    if (this.current && ["running", "paused"].includes(this.current.status))
      await this.control("stop");
  }
  private emit(): void {
    if (!this.current) return;
    const elapsed =
      (Date.parse(this.current.completedAt ?? new Date().toISOString()) -
        Date.parse(this.current.startedAt)) /
      1000;
    this.publish({
      scan: { ...this.current, counts: { ...this.current.counts } },
      active: this.active,
      elapsed,
      rate: elapsed > 0 ? this.current.checked / elapsed : 0,
    });
  }
  private async run(
    scan: Scan,
    urls: string[],
    settings: Settings,
    signal: AbortSignal,
    names: Map<string, string> = new Map(),
  ): Promise<void> {
    const jobs: Job[] = urls.map((url) => ({
      url,
      depth: 0,
      expand: scan.mode === "crawl",
    }));
    const seen = new Map(jobs.map((j) => [j.url, j]));
    let cursor = 0;
    const robotCache = new Map<
      string,
      Promise<ReturnType<typeof robotsParser> | null>
    >();
    const robotsAllowed = async (url: string): Promise<boolean | null> => {
      if (!settings.respectRobots || scan.mode !== "crawl") return true;
      const origin = new URL(url).origin;
      let pending = robotCache.get(origin);
      if (!pending) {
        pending = (async () => {
          const output = await this.probe.withRetries(
            `${origin}/robots.txt`,
            scan.id,
            settings,
            signal,
            0,
            (u) => this.queue!.acquire(u),
          );
          if (output.result.code === 404 || output.result.code === 410)
            return robotsParser(`${origin}/robots.txt`, "");
          if (
            output.result.code &&
            output.result.code >= 200 &&
            output.result.code < 300 &&
            !output.result.errorCode
          )
            return robotsParser(`${origin}/robots.txt`, output.body);
          return null;
        })();
        robotCache.set(origin, pending);
      }
      const robots = await pending;
      return robots
        ? robots.isAllowed(url, settings.userAgent) !== false
        : null;
    };
    const worker = async (): Promise<void> => {
      while (!signal.aborted) {
        await this.queue!.ready();
        const job = jobs[cursor];
        if (!job) {
          if (!this.active) return;
          await abortableDelay(25, signal);
          continue;
        }
        cursor++;
        this.active++;
        try {
          let output;
          let normalized = true;
          try {
            normalizeUrl(job.url);
          } catch {
            normalized = false;
          }
          const allowed = normalized ? await robotsAllowed(job.url) : true;
          if (allowed !== true) {
            output = {
              result: createResult(job.url, scan.id, job.depth),
              body: "",
              retryAfter: 0,
              response: null,
            };
            output.result.attempts = 0;
            output.result.category = "skipped";
            output.result.errorCode =
              allowed === false ? "ROBOTS_DISALLOWED" : "ROBOTS_UNAVAILABLE";
            output.result.label =
              allowed === false
                ? "Skipped by robots.txt"
                : "Robots policy unavailable; skipped";
            output.result.errorMessage = output.result.label;
            output.result.technicalError = null;
          } else
            output = normalized
              ? await this.probe.withRetries(
                  job.url,
                  scan.id,
                  settings,
                  signal,
                  job.depth,
                  async (u) => {
                    const policy = await robotsAllowed(u);
                    if (policy !== true)
                      throw Object.assign(
                        new Error(
                          "Redirect destination is excluded by robots policy",
                        ),
                        {
                          code:
                            policy === false
                              ? "ROBOTS_DISALLOWED"
                              : "ROBOTS_UNAVAILABLE",
                        },
                      );
                    return this.queue!.acquire(u);
                  },
                )
              : await this.probe.probe(
                  job.url,
                  scan.id,
                  settings,
                  signal,
                  job.depth,
                );
          if (
            !signal.aborted &&
            normalized &&
            (settings.protocol ?? "auto") === "auto" &&
            new URL(normalizeUrl(job.url)).protocol === "https:" &&
            output.result.code === null &&
            output.result.errorCode
          ) {
            const alternative = new URL(normalizeUrl(job.url));
            alternative.protocol = "http:";
            const original = job.url;
            output = await this.probe.withRetries(
              alternative.href,
              scan.id,
              settings,
              signal,
              job.depth,
              async (u) => {
                const policy = await robotsAllowed(u);
                if (policy !== true)
                  throw Object.assign(
                    new Error("HTTP fallback excluded by robots policy"),
                    { code: "ROBOTS_DISALLOWED" },
                  );
                return this.queue!.acquire(u);
              },
            );
            output.result.originalUrl = original;
            output.result.label += " (HTTP fallback)";
          }
          if (signal.aborted) return;
          const result = output.result;
          result.name = normalized
            ? (names.get(normalizeUrl(job.url)) ?? "")
            : "";
          this.db.saveResult(result);
          scan.checked++;
          scan.counts[result.category] =
            (scan.counts[result.category] ?? 0) + 1;
          if (["slow", "very slow"].includes(result.performance))
            scan.counts.slow = (scan.counts.slow ?? 0) + 1;
          if (
            job.expand &&
            result.code &&
            result.code >= 200 &&
            result.code < 300 &&
            /html/i.test(result.contentType ?? "") &&
            (settings.crawlDepth < 0 || job.depth < settings.crawlDepth) &&
            scan.baseUrl &&
            new URL(result.finalUrl).hostname === new URL(scan.baseUrl).hostname
          ) {
            const links = discoverLinks(
              output.body,
              result.finalUrl,
              scan.baseUrl,
              settings.checkAssets,
            );
            this.db.saveSources(scan.id, links);
            for (const link of links) {
              for (const target of protocolUrls(
                link.normalizedTarget,
                settings.protocol,
              )) {
                const existing = seen.get(target);
                if (existing) {
                  if (link.scope === "internal" && !link.asset)
                    existing.expand = true;
                  continue;
                }
                if (seen.size >= settings.maxPages) continue;
                const next = {
                  url: target,
                  depth: job.depth + 1,
                  expand: link.scope === "internal" && !link.asset,
                };
                seen.set(next.url, next);
                jobs.push(next);
              }
            }
            scan.total = jobs.length;
          }
          this.db.updateScan(scan);
        } finally {
          this.active--;
        }
      }
    };
    const outcomes = await Promise.allSettled(
      Array.from(
        {
          length:
            scan.mode === "crawl"
              ? Math.min(settings.concurrency, settings.maxPages)
              : settings.concurrency,
        },
        () => worker(),
      ),
    );
    if (!signal.aborted) {
      const failure = outcomes.find((o) => o.status === "rejected");
      if (failure?.status === "rejected") {
        scan.status = "interrupted";
        this.log(failure.reason);
      } else scan.status = "completed";
    }
  }
}
export function broken(result: UrlResult): boolean {
  return (
    [
      "broken",
      "timeout",
      "dns",
      "connection",
      "ssl",
      "invalid",
      "error",
    ].includes(result.category) ||
    ["REDIRECT_LOOP", "TOO_MANY_REDIRECTS"].includes(result.errorCode ?? "")
  );
}
