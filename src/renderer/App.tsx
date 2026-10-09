import { useCallback, useEffect, useState } from "react";
import type {
  Comparison,
  Dashboard,
  ImportSummary,
  Progress,
  ResultsPage,
  Scan,
  Settings,
  SourceLink,
  UrlResult,
} from "../../shared/types";
import { defaults } from "../../shared/defaults";
import { Monitoring } from "./features/Monitoring";
const api = window.desktop;
const pages = [
  "Dashboard",
  "Quick Scan",
  "Website Crawl",
  "URL Results",
  "Broken Links",
  "Redirects",
  "Slow URLs",
  "SSL",
  "Reports",
  "Scan History",
  "Settings",
];
const icons = ["◫", "↗", "◎", "☷", "⚑", "⇢", "◷", "◇", "▤", "↶", "⚙"];
const pageFilters: Record<string, string> = {
  "Broken Links": "broken",
  Redirects: "redirect",
  "Slow URLs": "slow",
  SSL: "ssl",
};
const ms = (n: number | null | undefined): string =>
  n == null ? "—" : `${Math.round(n).toLocaleString()} ms`;
const clock = (seconds: number): string =>
  `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
export function App(): React.JSX.Element {
  const [page, setPage] = useState("Dashboard"),
    [settings, setSettings] = useState<Settings>({ ...defaults }),
    [location, setLocation] = useState("");
  const [history, setHistory] = useState<Scan[]>([]),
    [selected, setSelected] = useState(""),
    [progress, setProgress] = useState<Progress | null>(null);
  const [text, setText] = useState(""),
    [name, setName] = useState(""),
    [summary, setSummary] = useState<ImportSummary | null>(null);
  const [entryName, setEntryName] = useState(""),
    [entryUrl, setEntryUrl] = useState("");
  const [data, setData] = useState<ResultsPage>({ rows: [], total: 0 }),
    [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [scope, setScope] = useState("both"),
    [tablePage, setTablePage] = useState(0);
  const [sort, setSort] = useState<"url" | "code" | "time" | "checkedAt">(
      "url",
    ),
    [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [detail, setDetail] = useState<{
      result: UrlResult;
      sources: SourceLink[];
    } | null>(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [compareId, setCompareId] = useState(""),
    [comparison, setComparison] = useState<Comparison[] | null>(null);
  const run = useCallback(async (action: () => Promise<unknown>) => {
    try {
      setBusy(true);
      await action();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, []);
  const loadHistory = useCallback(async () => {
    const rows = await api.history();
    setHistory(rows);
    setSelected((current) => current || rows[0]?.id || "");
  }, []);
  useEffect(() => {
    void run(async () => {
      const result = await api.settings();
      setSettings(result.settings);
      setLocation(result.location);
      await loadHistory();
    });
    return api.onProgress((p) => {
      setProgress(p);
      if (!["running", "paused"].includes(p.scan.status)) void loadHistory();
    });
  }, [run, loadHistory]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = (): void => {
      document.documentElement.dataset.theme =
        settings.theme === "system"
          ? media.matches
            ? "dark"
            : "light"
          : settings.theme;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [settings.theme]);
  useEffect(() => {
    setFilter(pageFilters[page] ?? "all");
    setTablePage(0);
    setSearch("");
    setScope("both");
  }, [page]);
  useEffect(() => {
    if (!selected) return;
    let alive = true;
    const timer = setTimeout(() => {
      void Promise.all([
        api.results({
          scanId: selected,
          page: tablePage,
          search,
          filter,
          scope,
          sort,
          direction,
        }),
        api.dashboard(selected),
      ])
        .then(([rows, stats]) => {
          if (alive) {
            setData(rows);
            setDashboard(stats);
          }
        })
        .catch((error) => {
          if (alive) setNotice(String(error));
        });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [
    selected,
    tablePage,
    search,
    filter,
    scope,
    sort,
    direction,
    progress?.scan.checked,
    progress?.scan.status,
  ]);
  useEffect(() => {
    if (!text) {
      setSummary(null);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      void api
        .preview(text)
        .then((value) => {
          if (alive) setSummary(value);
        })
        .catch((error) => setNotice(String(error)));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [text]);
  const active =
    progress && ["running", "paused"].includes(progress.scan.status)
      ? progress
      : null;
  const current =
    history.find((s) => s.id === selected) ??
    (progress?.scan.id === selected ? progress.scan : null);
  const counts = dashboard?.counts ?? {};
  const navigate = (next: string): void => {
    setPage(next);
    setComparison(null);
  };
  const start = (): void => {
    void run(async () => {
      const scan = await api.start({
        name,
        mode: page === "Website Crawl" ? "crawl" : "quick",
        text,
        settings,
      });
      setSelected(scan.id);
      await loadHistory();
      setPage("URL Results");
    });
  };
  const imported = (value: ImportSummary | null): void => {
    if (value) {
      setText(
        [
          ...value.urls.map((url) =>
            value.names?.[url] ? `${value.names[url]} | ${url}` : url,
          ),
          ...value.invalid,
        ].join("\n"),
      );
      setSummary(value);
      setNotice(
        `${value.imported.toLocaleString()} imported · ${value.duplicates} duplicates removed · ${value.invalid.length} invalid · ${value.urls.length} ready`,
      );
    }
  };
  const exportFile = (format: "csv" | "xlsx" | "json" | "html"): void => {
    void run(async () => {
      if (!selected) throw new Error("Select a scan first");
      const file = await api.exportScan(selected, format);
      if (file) setNotice(`Export saved: ${file}`);
    });
  };
  const sortBy = (key: typeof sort): void => {
    setSort(key);
    setDirection(sort === key && direction === "asc" ? "desc" : "asc");
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">↗</span>
          <div>
            URL Checker<span>PRO / LOCAL WORKSPACE</span>
          </div>
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav>
          {pages.map((item, i) => (
            <button
              key={item}
              aria-label={item}
              className={page === item ? "nav-item selected" : "nav-item"}
              onClick={() => navigate(item)}
            >
              <span>{icons[i]}</span>
              {item}
              {item === "Broken Links" && !!counts.broken && (
                <b>{counts.broken}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <i className="online-dot" /> All data stored locally
          <span>Version 1.2.5 · Windows x64</span>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <span className="eyebrow">WORKSPACE / {page.toUpperCase()}</span>
            <h1>{page}</h1>
          </div>
          <div className="top-actions">
            <select
              aria-label="Selected scan"
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                setTablePage(0);
              }}
            >
              <option value="">Select a scan</option>
              {history.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button className="primary" onClick={() => navigate("Quick Scan")}>
              ＋ New scan
            </button>
          </div>
        </header>
        <div className="workspace">
          {notice && (
            <div role="status" className="notice">
              <span>{notice}</span>
              <button
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                ×
              </button>
            </div>
          )}
          {active && (
            <section className="live-panel">
              <div>
                <span className="live-label">
                  <i className="online-dot" />
                  {active.scan.status === "paused" ? "Paused" : "Scanning"}
                </span>
                <strong>
                  {active.scan.checked.toLocaleString()}{" "}
                  <small>/ {active.scan.total.toLocaleString()} URLs</small>
                </strong>
                <div className="progress-track">
                  <div
                    style={{
                      width: `${active.scan.total ? (active.scan.checked / active.scan.total) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
              <div className="live-metrics">
                <span>
                  {active.active} / {settings.concurrency}
                  <small>Workers</small>
                </span>
                <span>
                  {active.rate.toFixed(1)}
                  <small>URLs / sec</small>
                </span>
                <span>
                  {clock(active.elapsed)}
                  <small>Elapsed</small>
                </span>
              </div>
              <button
                onClick={() =>
                  void run(() =>
                    api.control(
                      active.scan.status === "paused" ? "resume" : "pause",
                    ),
                  )
                }
              >
                {active.scan.status === "paused" ? "Resume" : "Pause"}
              </button>
              <button
                className="danger"
                onClick={() => void run(() => api.control("stop"))}
              >
                Stop
              </button>
            </section>
          )}
          {page === "Dashboard" && (
            <>
              <div className="section-heading">
                <div>
                  <h2>Your scan, at a glance</h2>
                  <p>
                    {current
                      ? `${current.name} · ${current.status}`
                      : "Start a scan to see real diagnostics for your URLs."}
                  </p>
                </div>
                <span className="chip">LOCAL ENGINE</span>
              </div>
              <div className="stat-grid">
                {[
                  ["Total URLs", "total"],
                  ["Online", "online"],
                  ["Broken", "broken"],
                  ["Redirects", "redirect"],
                  ["Slow", "slow"],
                  ["Timeouts", "timeout"],
                  ["SSL issues", "ssl"],
                ].map(([label, key]) => (
                  <button
                    className={`stat-card ${key}`}
                    key={key}
                    onClick={() => {
                      if (key === "total") navigate("URL Results");
                      else if (key === "broken") navigate("Broken Links");
                      else if (key === "redirect") navigate("Redirects");
                      else if (key === "slow") navigate("Slow URLs");
                      else if (key === "ssl") navigate("SSL");
                      else {
                        navigate("URL Results");
                        setTimeout(() => setFilter(key), 0);
                      }
                    }}
                  >
                    <span>
                      {label}
                      <i>↗</i>
                    </span>
                    <strong>{(counts[key] ?? 0).toLocaleString()}</strong>
                    <small>
                      {key === "total"
                        ? "Checked resources"
                        : key === "online"
                          ? "Successful responses"
                          : key === "broken"
                            ? "Needs your attention"
                            : key === "ssl"
                              ? "Errors or expires within 30 days"
                              : "Across selected scan"}
                    </small>
                  </button>
                ))}
              </div>
              <div className="dashboard-grid">
                <section className="panel">
                  <div className="panel-title">
                    <h3>Status distribution</h3>
                    <span>{counts.total ?? 0} checked</span>
                  </div>
                  {(counts.total ?? 0) > 0 ? (
                    <>
                      <div className="distribution">
                        {Object.entries(counts)
                          .filter(
                            ([k]) =>
                              [
                                "online",
                                "redirect",
                                "broken",
                                "timeout",
                                "dns",
                                "connection",
                                "ssl",
                                "blocked",
                                "rate-limited",
                                "invalid",
                                "skipped",
                                "error",
                              ].includes(k) && k !== "broken",
                          )
                          .map(([key, count]) => (
                            <div
                              key={key}
                              className={key}
                              style={{ flex: count }}
                              title={`${key}: ${count}`}
                            />
                          ))}
                        <div
                          className="broken"
                          style={{
                            flex: Math.max(
                              0,
                              (counts.total ?? 0) -
                                Object.entries(counts)
                                  .filter(([k]) =>
                                    [
                                      "online",
                                      "redirect",
                                      "timeout",
                                      "dns",
                                      "connection",
                                      "ssl",
                                      "blocked",
                                      "rate-limited",
                                      "invalid",
                                      "skipped",
                                      "error",
                                    ].includes(k),
                                  )
                                  .reduce((n, [, v]) => n + v, 0),
                            ),
                          }}
                        />
                      </div>
                      <div className="legend">
                        {[
                          ["Online", "online"],
                          ["Broken", "broken"],
                          ["Redirects", "redirect"],
                          ["Timeouts", "timeout"],
                          ["Blocked", "blocked"],
                          ["Skipped", "skipped"],
                        ].map(([label, key]) => (
                          <span key={key}>
                            <i className={key} />
                            {label}
                            <b>{counts[key] ?? 0}</b>
                          </span>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="empty-small">No scan data yet</div>
                  )}
                  <div className="average">
                    <span>Average response time</span>
                    <strong>{ms(dashboard?.average)}</strong>
                  </div>
                </section>
                <section className="panel">
                  <div className="panel-title">
                    <h3>Common errors</h3>
                    <span>By frequency</span>
                  </div>
                  {dashboard?.errors.length ? (
                    dashboard.errors.map((e) => (
                      <div className="metric-row" key={e.code}>
                        <code>{e.code}</code>
                        <b>{e.count}</b>
                      </div>
                    ))
                  ) : (
                    <div className="empty-small">No errors recorded</div>
                  )}
                  <div className="scope-stats">
                    <span>
                      Internal <b>{dashboard?.internal ?? 0}</b>
                      <small>{dashboard?.brokenInternal ?? 0} broken</small>
                    </span>
                    <span>
                      External <b>{dashboard?.external ?? 0}</b>
                      <small>{dashboard?.brokenExternal ?? 0} broken</small>
                    </span>
                  </div>
                </section>
                <section className="panel">
                  <div className="panel-title">
                    <h3>Slowest URLs</h3>
                    <span>Response time</span>
                  </div>
                  {dashboard?.slowest.length ? (
                    dashboard.slowest.map((r) => (
                      <button
                        className="metric-row url-row"
                        key={r.id}
                        onClick={() =>
                          void run(async () =>
                            setDetail(await api.detail(r.id)),
                          )
                        }
                      >
                        <span title={r.url}>{r.url}</span>
                        <b>{ms(r.timings.total)}</b>
                      </button>
                    ))
                  ) : (
                    <div className="empty-small">
                      Run a scan to measure response times
                    </div>
                  )}
                </section>
                <section className="panel">
                  <div className="panel-title">
                    <h3>Recent scans</h3>
                    <button onClick={() => navigate("Scan History")}>
                      View all ↗
                    </button>
                  </div>
                  {history.slice(0, 4).map((s) => (
                    <button
                      className="recent-row"
                      key={s.id}
                      onClick={() => {
                        setSelected(s.id);
                        navigate("URL Results");
                      }}
                    >
                      <span className="scan-icon">
                        {s.mode === "crawl" ? "◎" : "↗"}
                      </span>
                      <span>
                        {s.name}
                        <small>
                          {new Date(s.startedAt).toLocaleString()} · {s.mode}
                        </small>
                      </span>
                      <b>
                        {s.checked}
                        <small>{s.status}</small>
                      </b>
                    </button>
                  ))}
                  {!history.length && (
                    <div className="empty-small">
                      Your scan history will appear here
                    </div>
                  )}
                </section>
              </div>
            </>
          )}
          {(page === "Quick Scan" || page === "Website Crawl") && (
            <>
              <div className="section-heading">
                <div>
                  <h2>
                    {page === "Quick Scan"
                      ? "Check every URL. Know every cause."
                      : "Find broken links, right at their source."}
                  </h2>
                  <p>
                    {page === "Quick Scan"
                      ? "Paste or import a list. The local engine handles the diagnostics."
                      : "Crawl internal pages and check discovered links and resources."}
                  </p>
                </div>
                <span className="chip">
                  {page === "Quick Scan"
                    ? "BULK DIAGNOSTICS"
                    : "SITE DISCOVERY"}
                </span>
              </div>
              <div className="scan-form-grid">
                <section className="panel input-panel">
                  <label>
                    Scan name{" "}
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Optional name for this scan"
                      maxLength={200}
                    />
                  </label>
                  <div className="panel-title">
                    <h3>
                      {page === "Quick Scan"
                        ? "URLs to check"
                        : "Starting website"}
                    </h3>
                    {page === "Quick Scan" && (
                      <button
                        onClick={() =>
                          void run(async () =>
                            imported(await api.importFiles()),
                          )
                        }
                      >
                        ↑ Import file
                      </button>
                    )}
                  </div>
                  <div className="named-url-entry">
                    <label>
                      Name
                      <input
                        aria-label="URL name"
                        value={entryName}
                        maxLength={200}
                        placeholder="e.g. Main website"
                        onChange={(e) => setEntryName(e.target.value)}
                      />
                    </label>
                    <label>
                      URL
                      <input
                        aria-label="Named URL"
                        value={entryUrl}
                        placeholder="https://example.com"
                        onChange={(e) => setEntryUrl(e.target.value)}
                      />
                    </label>
                    <button
                      disabled={
                        !entryUrl.trim() ||
                        /[\r\n]/.test(entryUrl + entryName) ||
                        entryName.includes(" | ")
                      }
                      onClick={() => {
                        setText((previous) =>
                          [
                            previous.trim(),
                            entryName.trim()
                              ? `${entryName.trim()} | ${entryUrl.trim()}`
                              : entryUrl.trim(),
                          ]
                            .filter(Boolean)
                            .join("\n"),
                        );
                        setEntryName("");
                        setEntryUrl("");
                      }}
                    >
                      Add URL
                    </button>
                  </div>
                  <p>
                    Name appears before the URL. Paste one URL per line, or use:
                    Main website | https://example.com
                  </p>
                  <textarea
                    aria-label="URLs to check"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={
                      page === "Quick Scan"
                        ? "https://example.com\nhttps://example.com/about\n\nOne URL per line, or drop a TXT, CSV or XLSX file here."
                        : "https://example.com"
                    }
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const files = Array.from(e.dataTransfer.files);
                      void run(async () =>
                        imported(await api.importDrop(files)),
                      );
                    }}
                  />
                  {summary && (
                    <div className="import-summary">
                      <span>{summary.imported} entered</span>
                      <span>{summary.duplicates} duplicates</span>
                      <span>{summary.invalid.length} invalid</span>
                      <strong>{summary.urls.length} ready</strong>
                    </div>
                  )}
                  <div className="form-bottom">
                    <span>HTTP and HTTPS only · fragments deduplicated</span>
                    <button
                      className="primary"
                      disabled={busy || !!active || !text.trim()}
                      onClick={start}
                    >
                      ▶ Start {page === "Website Crawl" ? "crawl" : "scan"}
                    </button>
                  </div>
                </section>
                <section className="panel scan-options">
                  <h3>Scan configuration</h3>
                  <label>
                    URL protocol
                    <select
                      value={settings.protocol ?? "auto"}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          protocol: e.target.value as Settings["protocol"],
                        })
                      }
                    >
                      <option value="auto">
                        Automatic (preserve entered scheme)
                      </option>
                      <option value="https">HTTPS only</option>
                      <option value="http">HTTP only</option>
                      <option value="both">Both HTTPS and HTTP</option>
                    </select>
                  </label>
                  <p>
                    Automatic preserves the entered scheme; no fallback occurs.
                    HTTPS only and HTTP only explicitly change the scheme. Both
                    checks each scheme separately.
                  </p>
                  <label>
                    Concurrent workers
                    <select
                      value={settings.concurrency}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          concurrency: Number(e.target.value),
                        })
                      }
                    >
                      {[5, 10, 20, 50, 100].map((n) => (
                        <option key={n}>{n}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Request timeout (ms)
                    <input
                      type="number"
                      min={100}
                      max={120000}
                      value={settings.timeout}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          timeout: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    Retries
                    <input
                      type="number"
                      min={0}
                      max={5}
                      value={settings.retries}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          retries: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  {page === "Website Crawl" && (
                    <>
                      <label>
                        Crawl depth
                        <select
                          value={settings.crawlDepth}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              crawlDepth: Number(e.target.value),
                            })
                          }
                        >
                          {[0, 1, 2, 3, 5, 10, -1].map((n) => (
                            <option key={n} value={n}>
                              {n < 0 ? "Full site" : `Depth ${n}`}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Maximum URLs
                        <input
                          type="number"
                          value={settings.maxPages}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              maxPages: Number(e.target.value),
                            })
                          }
                        />
                      </label>
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={settings.respectRobots}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              respectRobots: e.target.checked,
                            })
                          }
                        />
                        Respect robots.txt
                      </label>
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={settings.checkAssets}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              checkAssets: e.target.checked,
                            })
                          }
                        />
                        Check assets
                      </label>
                      <p className="hint">
                        Robots-disallowed paths appear as skipped. External
                        links are checked once and are never expanded. Pages at
                        the depth limit are checked without discovering more
                        URLs.
                      </p>
                    </>
                  )}
                  <div className="engine-note">
                    <i className="online-dot" />
                    <span>
                      Local scanning engine
                      <strong>No cloud service required</strong>
                    </span>
                  </div>
                </section>
              </div>
            </>
          )}
          {[
            "URL Results",
            "Broken Links",
            "Redirects",
            "Slow URLs",
            "SSL",
          ].includes(page) && (
            <>
              <div className="section-heading">
                <div>
                  <h2>
                    {page === "Broken Links"
                      ? "Every issue, with its source."
                      : page === "SSL"
                        ? "Certificate health & expiry"
                        : "Inspect your results"}
                  </h2>
                  <p>
                    {current
                      ? `${current.name} · ${current.checked.toLocaleString()} checked · ${current.status}`
                      : "Select a previous scan or start a new one."}
                  </p>
                </div>
                <div className="button-group">
                  <button
                    disabled={!selected || busy}
                    onClick={() => exportFile("csv")}
                  >
                    ↓ CSV
                  </button>
                  <button
                    disabled={!selected || busy}
                    onClick={() => exportFile("xlsx")}
                  >
                    ↓ XLSX
                  </button>
                </div>
              </div>
              <Monitoring scanId={selected} settings={settings} />
              <p>
                Original scan snapshot below. Current URL status and outage
                records appear in the live monitoring table above.
              </p>
              <section className="panel results-panel">
                <div className="table-toolbar">
                  <input
                    aria-label="Search results"
                    placeholder="Search URLs or error codes…"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setTablePage(0);
                    }}
                  />
                  <select
                    aria-label="Status filter"
                    value={filter}
                    onChange={(e) => {
                      setFilter(e.target.value);
                      setTablePage(0);
                    }}
                  >
                    {[
                      "all",
                      "online",
                      "broken",
                      "redirect",
                      "timeout",
                      "slow",
                      "ssl",
                      "4xx",
                      "5xx",
                      "asset",
                    ].map((f) => (
                      <option key={f} value={f}>
                        {f === "all"
                          ? "All statuses"
                          : f === "asset"
                            ? "Assets"
                            : f.toUpperCase()}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Link scope"
                    value={scope}
                    onChange={(e) => {
                      setScope(e.target.value);
                      setTablePage(0);
                    }}
                  >
                    <option value="both">Internal + external</option>
                    <option value="internal">Internal only</option>
                    <option value="external">External only</option>
                  </select>
                  <span>{data.total.toLocaleString()} results</span>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th onClick={() => sortBy("url")}>URL ↕</th>
                        <th>Status</th>
                        <th onClick={() => sortBy("code")}>HTTP ↕</th>
                        <th onClick={() => sortBy("time")}>Response ↕</th>
                        <th>Final URL</th>
                        <th>Redirects</th>
                        <th>SSL</th>
                        <th>Error</th>
                        <th onClick={() => sortBy("checkedAt")}>Checked ↕</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((r) => (
                        <tr
                          key={r.id}
                          onClick={() =>
                            void run(async () =>
                              setDetail(await api.detail(r.id)),
                            )
                          }
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter")
                              void run(async () =>
                                setDetail(await api.detail(r.id)),
                              );
                          }}
                        >
                          <td>{r.name || "—"}</td>
                          <td className="url-cell" title={r.originalUrl}>
                            {r.url}
                          </td>
                          <td>
                            <span className={`status ${r.category}`}>
                              {r.label}
                            </span>
                          </td>
                          <td className="mono">{r.code ?? "—"}</td>
                          <td
                            className={`mono ${r.performance.includes("slow") ? "slow-text" : ""}`}
                          >
                            {ms(r.timings.total)}
                          </td>
                          <td className="url-cell" title={r.finalUrl}>
                            {r.finalUrl}
                          </td>
                          <td className="mono">{r.redirects.length || "—"}</td>
                          <td>
                            {r.ssl
                              ? r.ssl.valid
                                ? `${r.ssl.daysRemaining}d`
                                : "Invalid"
                              : r.category === "ssl"
                                ? "Error"
                                : r.url.startsWith("https:")
                                  ? "—"
                                  : "HTTP"}
                          </td>
                          <td>
                            <code>{r.errorCode ?? "—"}</code>
                          </td>
                          <td>{new Date(r.checkedAt).toLocaleTimeString()}</td>
                          <td>
                            <button
                              title="Copy URL"
                              onClick={(e) => {
                                e.stopPropagation();
                                void run(async () => {
                                  await navigator.clipboard.writeText(r.url);
                                  setNotice("URL copied");
                                });
                              }}
                            >
                              ⧉
                            </button>
                            <button
                              title="Open in default browser"
                              onClick={(e) => {
                                e.stopPropagation();
                                void run(() => api.openUrl(r.url));
                              }}
                            >
                              ↗
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!data.rows.length && (
                    <div className="empty-table">
                      <span>◎</span>
                      <h3>
                        {selected
                          ? "No matching results"
                          : "Ready when you are"}
                      </h3>
                      <p>
                        {selected
                          ? "Try another filter or wait for the scan to finish."
                          : "Start a scan to inspect live URL diagnostics."}
                      </p>
                    </div>
                  )}
                </div>
                <div className="pagination">
                  <span>
                    Showing {data.total ? tablePage * 100 + 1 : 0}–
                    {Math.min((tablePage + 1) * 100, data.total)} of{" "}
                    {data.total} · 100 rows per page
                  </span>
                  <div>
                    <button
                      disabled={tablePage === 0}
                      onClick={() => setTablePage((n) => n - 1)}
                    >
                      ← Previous
                    </button>
                    <button
                      disabled={(tablePage + 1) * 100 >= data.total}
                      onClick={() => setTablePage((n) => n + 1)}
                    >
                      Next →
                    </button>
                  </div>
                </div>
              </section>
            </>
          )}
          {page === "Scan History" && (
            <>
              <div className="section-heading">
                <div>
                  <h2>A record of every run</h2>
                  <p>
                    Completed, cancelled and interrupted scans stay available
                    locally.
                  </p>
                </div>
              </div>
              <section className="panel history-panel">
                <table>
                  <thead>
                    <tr>
                      <th>Scan</th>
                      <th>Type</th>
                      <th>Date</th>
                      <th>Duration</th>
                      <th>Status</th>
                      <th>Checked / discovered</th>
                      <th>Online</th>
                      <th>Broken</th>
                      <th>Redirects</th>
                      <th>Slow</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <button
                            onClick={() => {
                              setSelected(s.id);
                              navigate("URL Results");
                            }}
                          >
                            {s.name} ↗
                          </button>
                        </td>
                        <td>{s.mode}</td>
                        <td>{new Date(s.startedAt).toLocaleString()}</td>
                        <td>
                          {s.completedAt
                            ? clock(
                                (Date.parse(s.completedAt) -
                                  Date.parse(s.startedAt)) /
                                  1000,
                              )
                            : "Active"}
                        </td>
                        <td>{s.status}</td>
                        <td>
                          {s.checked} / {s.total}
                        </td>
                        <td>{s.counts.online ?? 0}</td>
                        <td>
                          {(s.counts.broken ?? 0) +
                            (s.counts.dns ?? 0) +
                            (s.counts.connection ?? 0) +
                            (s.counts.ssl ?? 0) +
                            (s.counts.timeout ?? 0) +
                            (s.counts.error ?? 0)}
                        </td>
                        <td>{s.counts.redirect ?? 0}</td>
                        <td>{s.counts.slow ?? 0}</td>
                        <td>
                          <button
                            className="danger"
                            onClick={() => {
                              if (
                                confirm(`Delete “${s.name}” and its results?`)
                              )
                                void run(async () => {
                                  await api.deleteScan(s.id);
                                  if (selected === s.id) {
                                    setSelected("");
                                    setData({ rows: [], total: 0 });
                                    setDashboard(null);
                                  }
                                  await loadHistory();
                                });
                            }}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!history.length && (
                  <div className="empty-small">No saved scans yet</div>
                )}
              </section>
            </>
          )}
          {page === "Reports" && (
            <>
              <div className="section-heading">
                <div>
                  <h2>Take your findings with you</h2>
                  <p>
                    Export the selected scan or compare two runs of the same
                    project.
                  </p>
                </div>
              </div>
              <div className="report-grid">
                {(["csv", "xlsx", "json", "html"] as const).map((f) => (
                  <section className="panel export-card" key={f}>
                    <span className="format-icon">{f.toUpperCase()}</span>
                    <h3>
                      {f === "xlsx"
                        ? "Excel workbook"
                        : f === "html"
                          ? "Shareable HTML report"
                          : f === "json"
                            ? "Full diagnostic data"
                            : "Spreadsheet-ready CSV"}
                    </h3>
                    <p>
                      {f === "xlsx"
                        ? "Summary, all URLs, issues, redirects, slow URLs, SSL and source pages."
                        : f === "json"
                          ? "Results, timing, certificates, redirect chains and all discovered source links."
                          : f === "html"
                            ? "A standalone report with status, response times and broken-link sources."
                            : "Every checked URL with response status, timing and errors."}
                    </p>
                    <button
                      disabled={!selected || busy}
                      onClick={() => exportFile(f)}
                    >
                      ↓ Export {f.toUpperCase()}
                    </button>
                  </section>
                ))}
              </div>
              <section className="panel comparison-panel">
                <h3>Compare scans</h3>
                <p>
                  Selected scan is the baseline. Choose a newer run from the
                  same project.
                </p>
                <div className="button-group">
                  <select
                    value={compareId}
                    onChange={(e) => setCompareId(e.target.value)}
                  >
                    <option value="">Choose comparison scan</option>
                    {history
                      .filter((s) => s.id !== selected)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                  <button
                    disabled={!selected || !compareId || busy}
                    onClick={() =>
                      void run(async () =>
                        setComparison(await api.compare(selected, compareId)),
                      )
                    }
                  >
                    Compare
                  </button>
                </div>
                {comparison && (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>URL</th>
                          <th>Before</th>
                          <th>After</th>
                          <th>Change</th>
                          <th>Time difference</th>
                        </tr>
                      </thead>
                      <tbody>
                        {comparison.slice(0, 1000).map((c) => (
                          <tr key={c.url}>
                            <td>{c.url}</td>
                            <td>{c.before ?? "—"}</td>
                            <td>{c.after ?? "—"}</td>
                            <td>{c.change}</td>
                            <td>
                              {c.delta > 0 ? "+" : ""}
                              {c.delta} ms
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p>
                      {comparison.length} changes
                      {comparison.length > 1000
                        ? " · first 1,000 displayed"
                        : ""}
                    </p>
                  </div>
                )}
              </section>
            </>
          )}
          {page === "Settings" && (
            <>
              <div className="section-heading">
                <div>
                  <h2>Make the engine yours</h2>
                  <p>
                    Preferences apply to new scans. Save to remember them
                    between sessions.
                  </p>
                </div>
                <button onClick={() => setSettings({ ...defaults })}>
                  Restore defaults
                </button>
              </div>
              <section className="panel settings-panel">
                <div className="settings-grid">
                  {(
                    [
                      ["concurrency", "Default concurrency"],
                      ["timeout", "Request timeout (ms)"],
                      ["retries", "Retries"],
                      ["retryDelay", "Retry delay (ms)"],
                      ["maxRedirects", "Maximum redirects"],
                      ["crawlDepth", "Default crawl depth (-1 = full site)"],
                      ["maxPages", "Maximum URLs"],
                      ["perHostConcurrency", "Per-host concurrency"],
                      ["hostDelay", "Host request delay (ms)"],
                      ["fastThreshold", "Fast threshold (ms)"],
                      ["normalThreshold", "Normal threshold (ms)"],
                      ["slowThreshold", "Slow threshold (ms)"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input
                        type="number"
                        value={settings[key]}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            [key]: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                  ))}
                  <label>
                    Authorized private hostnames (comma separated)
                    <input
                      aria-label="Authorized private hostnames"
                      value={(settings.allowedPrivateHosts ?? []).join(", ")}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          allowedPrivateHosts: e.target.value
                            .split(",")
                            .map((host) => host.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                    <small>
                      Only grant exact local hosts you own or are authorized to
                      monitor. Metadata and link-local addresses remain blocked.
                    </small>
                  </label>
                  <label>
                    User-Agent
                    <input
                      value={settings.userAgent}
                      onChange={(e) =>
                        setSettings({ ...settings, userAgent: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Theme
                    <select
                      aria-label="Theme"
                      value={settings.theme}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          theme: e.target.value as Settings["theme"],
                        })
                      }
                    >
                      <option value="system">System</option>
                      <option value="dark">Dark</option>
                      <option value="light">Light</option>
                    </select>
                  </label>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={settings.respectRobots}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          respectRobots: e.target.checked,
                        })
                      }
                    />
                    Respect robots.txt
                  </label>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={settings.checkAssets}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          checkAssets: e.target.checked,
                        })
                      }
                    />
                    Check assets while crawling
                  </label>
                </div>
                <div className="storage-info">
                  <span>SQLite storage</span>
                  <code>{location}</code>
                  <p>
                    Scans and settings are stored here. Network access is used
                    only for the URLs you scan.
                  </p>
                </div>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      setSettings(await api.saveSettings(settings));
                      setNotice("Settings saved");
                    })
                  }
                >
                  Save settings
                </button>
              </section>
            </>
          )}
          {page === "Settings" && (
            <section className="panel">
              <h3>Developer information</h3>
              <p>Developed by Sudipta Roy Akash · Version 1.2.5</p>
              <p>
                Website:{" "}
                <button
                  onClick={() => void api.openUrl("https://sudiptaroy.dev")}
                >
                  sudiptaroy.dev
                </button>
              </p>
              <p>
                GitHub:{" "}
                <button
                  onClick={() =>
                    void api.openUrl("https://github.com/devsudipta")
                  }
                >
                  devsudipta
                </button>
              </p>
              <p>Email: hello@sudiptaroy.dev</p>
            </section>
          )}
          <footer className="workspace-footer">
            <span>
              <i className="online-dot" /> Developed by Sudipta Roy Akash (
              <button
                onClick={() => void api.openUrl("https://sudiptaroy.dev")}
              >
                sudiptaroy.dev
              </button>
              ) · v1.2.5
            </span>
            <span>
              {active ? "Scan in progress" : `${history.length} saved scans`} ·
              SQLite persistence
            </span>
          </footer>
        </div>
      </main>
      {detail && (
        <div className="drawer-overlay" onClick={() => setDetail(null)}>
          <aside className="detail-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="panel-title">
              <span className="eyebrow">URL DIAGNOSTICS</span>
              <button
                onClick={() => setDetail(null)}
                aria-label="Close details"
              >
                ×
              </button>
            </div>
            <h2>{detail.result.url}</h2>
            <span className={`status ${detail.result.category}`}>
              {detail.result.label}
            </span>
            <section>
              <h3>Overview</h3>
              <dl>
                <dt>Name</dt>
                <dd>{detail.result.name || "—"}</dd>
                <dt>Original URL</dt>
                <dd>{detail.result.originalUrl}</dd>
                <dt>Final URL</dt>
                <dd>{detail.result.finalUrl}</dd>
                <dt>HTTP status</dt>
                <dd>{detail.result.code ?? "Unavailable"}</dd>
                <dt>Performance</dt>
                <dd>{detail.result.performance}</dd>
                <dt>Attempts</dt>
                <dd>{detail.result.attempts}</dd>
                <dt>Content type</dt>
                <dd>{detail.result.contentType ?? "Unavailable"}</dd>
                <dt>Body bytes</dt>
                <dd>{detail.result.contentLength ?? "Unavailable"}</dd>
                <dt>Checked at</dt>
                <dd>{new Date(detail.result.checkedAt).toLocaleString()}</dd>
              </dl>
            </section>
            <section>
              <h3>Timing</h3>
              <p className="hint">
                Total includes redirects. Phase timings describe the last
                measured response. Unavailable phases stay blank.
              </p>
              <div className="timing-grid">
                {Object.entries(detail.result.timings).map(([key, value]) => (
                  <div key={key}>
                    <span>{key.toUpperCase()}</span>
                    <strong>{ms(value)}</strong>
                  </div>
                ))}
              </div>
            </section>
            <section>
              <h3>Redirect chain · {detail.result.redirects.length}</h3>
              {detail.result.redirects.map((r, i) => (
                <div className="redirect-hop" key={i}>
                  <code>{r.code}</code>
                  <span>
                    {r.source}
                    <small>↓ {r.destination}</small>
                  </span>
                </div>
              ))}
              {!detail.result.redirects.length && (
                <p className="hint">No redirects recorded.</p>
              )}
            </section>
            <section>
              <h3>SSL / TLS</h3>
              {detail.result.ssl ? (
                <>
                  <span
                    className={`status ${detail.result.ssl.valid ? "online" : "ssl"}`}
                  >
                    {detail.result.ssl.valid
                      ? "Valid certificate"
                      : "Certificate problem"}
                  </span>
                  <dl>
                    {Object.entries(detail.result.ssl).map(([key, value]) => (
                      <div key={key}>
                        <dt>{key}</dt>
                        <dd>{String(value ?? "—")}</dd>
                      </div>
                    ))}
                  </dl>
                  {detail.result.ssl.daysRemaining < 30 && (
                    <p className="warning">
                      {detail.result.ssl.daysRemaining < 0
                        ? "Certificate expired"
                        : `Certificate expires in ${detail.result.ssl.daysRemaining} days`}
                    </p>
                  )}
                </>
              ) : (
                <p className="hint">
                  {detail.result.category === "ssl"
                    ? "TLS validation failed. Certificate metadata was unavailable."
                    : detail.result.url.startsWith("https:")
                      ? "Certificate metadata unavailable."
                      : "HTTP URL; no certificate."}
                </p>
              )}
            </section>
            <section>
              <h3>Error details</h3>
              {detail.result.errorCode ? (
                <>
                  <code>{detail.result.errorCode}</code>
                  <p>{detail.result.errorMessage}</p>
                  <pre>
                    {detail.result.technicalError ??
                      "HTTP response received from the server."}
                  </pre>
                </>
              ) : (
                <p className="hint">No error recorded.</p>
              )}
            </section>
            <section>
              <h3>Source pages · {detail.sources.length}</h3>
              {detail.sources.map((s, i) => (
                <div className="source-link" key={i}>
                  <strong>{s.source}</strong>
                  <small>
                    &lt;{s.element}&gt; · {s.scope} {s.asset ? "· asset" : ""}
                  </small>
                  <p>{s.anchor || s.target}</p>
                  <code>{s.target}</code>
                </div>
              ))}
              {!detail.sources.length && (
                <p className="hint">
                  No source references. Source pages are recorded during website
                  crawls.
                </p>
              )}
            </section>
            <div className="button-group">
              <button
                onClick={() =>
                  void run(async () => {
                    await navigator.clipboard.writeText(detail.result.url);
                    setNotice("URL copied");
                  })
                }
              >
                Copy URL
              </button>
              <button
                onClick={() => void run(() => api.openUrl(detail.result.url))}
              >
                Open in browser ↗
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
