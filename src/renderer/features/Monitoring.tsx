import { useEffect, useState } from "react";
import type { MonitorSnapshot, Settings } from "../../../shared/types";

const date = (value: string | null): string =>
  value ? new Date(value).toLocaleString() : "—";
const duration = (ms: number): string => {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m ${seconds % 60}s`;
};
export function Monitoring({
  scanId,
  settings,
}: {
  scanId: string;
  settings: Settings;
}): React.JSX.Element {
  const [state, setState] = useState<MonitorSnapshot | null>(null);
  const [interval, setIntervalSeconds] = useState(5);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  useEffect(() => {
    if (!scanId) return;
    let alive = true;
    let pending = false;
    setState(null);
    const refresh = async (): Promise<void> => {
      if (pending) return;
      pending = true;
      try {
        const next = await window.desktop.monitorState(scanId);
        if (alive) setState(next);
      } catch (error) {
        if (alive) setMessage(String(error));
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [scanId]);
  const action = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setMessage("");
    try {
      await fn();
      setState(await window.desktop.monitorState(scanId));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const active = state?.active;
  const running = active?.scanId === scanId;
  if (!scanId) return <></>;
  return (
    <section className="panel monitoring-panel" aria-label="URL monitoring">
      <div className="panel-title">
        <div>
          <h3>Auto refresh & outage history</h3>
          <p>
            Checks continue while the app is open. HTTP 2xx/3xx is online; other
            responses or connection failures are offline.
          </p>
        </div>
      </div>
      <div className="monitor-controls">
        <label>
          Recheck interval
          <select
            aria-label="Recheck interval"
            value={interval}
            onChange={(e) => setIntervalSeconds(Number(e.target.value))}
            disabled={busy}
          >
            {[5, 10, 20, 30, 60, 120, 300, 600].map((n) => (
              <option key={n} value={n}>
                {n < 60
                  ? `${n} seconds`
                  : `${n / 60} minute${n > 60 ? "s" : ""}`}
              </option>
            ))}
          </select>
        </label>
        <button
          className="primary"
          disabled={busy || running}
          onClick={() =>
            void action(() =>
              window.desktop.monitorStart(scanId, interval, settings),
            )
          }
        >
          Start monitoring
        </button>
        <button
          disabled={busy || !active}
          onClick={() => void action(() => window.desktop.monitorStop())}
        >
          Stop monitoring
        </button>
        <button
          disabled={busy || !running}
          onClick={() =>
            void action(() =>
              window.desktop.monitorStart(scanId, interval, settings),
            )
          }
        >
          Apply interval
        </button>
        <button onClick={() => setShowHistory(!showHistory)}>
          {showHistory ? "Hide outage history" : "Show outage history"}
        </button>
        <button
          disabled={busy || !state?.sessions.length}
          onClick={() =>
            void action(async () => {
              const file = await window.desktop.monitorExport(scanId);
              if (file) setMessage(`Monitoring record saved: ${file}`);
            })
          }
        >
          Export monitoring JSON
        </button>
      </div>
      <p role="status">
        {running
          ? `Monitoring every ${active.interval} seconds after each completed cycle`
          : active
            ? "Monitoring another scan; starting here will stop that session."
            : "Monitoring stopped"}{" "}
        · {state?.checkCount ?? 0} saved checks
      </p>
      <p>
        Offline/recovery timestamps are observed check times. Slow checks extend
        the interval. Stopping or closing the app ends observation without
        marking a link recovered.
      </p>
      {message && <p role="alert">{message}</p>}
      {!!state?.targets.length && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>URL</th>
                <th>Live status</th>
                <th>HTTP</th>
                <th>Last checked</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {state.targets.map((target) => (
                <tr key={target.id}>
                  <td>{target.name || "—"}</td>
                  <td className="url-cell" title={target.url}>
                    {target.url}
                  </td>
                  <td>
                    <span
                      className={`status ${target.status === "online" ? "online" : target.status === "offline" ? "broken" : "skipped"}`}
                    >
                      {target.status}
                    </span>
                  </td>
                  <td>{target.code ?? "—"}</td>
                  <td>{date(target.checkedAt)}</td>
                  <td>{target.error ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showHistory && (
        <>
          <h3>Offline periods</h3>
          <p>
            Most recent 1,000 periods shown; JSON export includes all records.
          </p>
          <div className="table-scroll">
            <table aria-label="Outage history">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>URL</th>
                  <th>Offline detected</th>
                  <th>Online detected</th>
                  <th>Offline duration</th>
                </tr>
              </thead>
              <tbody>
                {state?.outages.map((outage) => (
                  <tr key={outage.id}>
                    <td>{outage.name || "—"}</td>
                    <td className="url-cell" title={outage.url}>
                      {outage.url}
                    </td>
                    <td>{date(outage.offlineAt)}</td>
                    <td>
                      {outage.onlineAt
                        ? date(outage.onlineAt)
                        : outage.endedAt
                          ? "Recovery not observed (monitoring ended)"
                          : "Still offline"}
                    </td>
                    <td>
                      {outage.durationMs !== null
                        ? duration(outage.durationMs)
                        : outage.endedAt
                          ? "Unknown"
                          : `${duration(Date.now() - Date.parse(outage.offlineAt))} (ongoing)`}
                    </td>
                  </tr>
                ))}
                {!state?.outages.length && (
                  <tr>
                    <td colSpan={5}>No outages recorded.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <h3>Monitoring sessions</h3>
          <ul>
            {state?.sessions.map((session) => (
              <li key={session.id}>
                {date(session.startedAt)} — {session.interval}s interval ·{" "}
                {session.status}
                {session.stoppedAt ? ` · Ended ${date(session.stoppedAt)}` : ""}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
