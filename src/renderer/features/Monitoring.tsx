import { useEffect, useState } from "react";
import { EndpointFields } from "./EndpointFields";
import type {
  EndpointConfig,
  MonitorSnapshot,
  MonitorTarget,
  Settings,
} from "../../../shared/types";

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
  const [selected, setSelected] = useState<MonitorTarget | null>(null);
  const [editing, setEditing] = useState(false),
    [configuration, setConfiguration] = useState("");
  const [tlsAcknowledged, setTlsAcknowledged] = useState(false);
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
            Checks continue while the app is open. Application health, network
            reachability and TLS security are evaluated separately. Configure
            each endpoint after starting monitoring.
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
                <th>Application health</th>
                <th>HTTP</th>
                <th>Network</th>
                <th>TLS security</th>
                <th>Last checked</th>
                <th>Error</th>
                <th>Details</th>
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
                      {target.diagnostic?.state ?? target.status}
                    </span>
                  </td>
                  <td>
                    {target.diagnostic?.application ??
                      (target.status === "online"
                        ? "healthy"
                        : target.status === "offline"
                          ? "failed"
                          : "unknown")}
                  </td>
                  <td>{target.code ?? "—"}</td>
                  <td>{target.diagnostic?.network ?? "unknown"}</td>
                  <td>{target.diagnostic?.tls ?? "unknown"}</td>
                  <td>{date(target.checkedAt)}</td>
                  <td>{target.error ?? "—"}</td>
                  <td>
                    <button
                      onClick={() => {
                        setSelected(target);
                        setEditing(false);
                      }}
                    >
                      Check details
                    </button>
                    <button
                      onClick={() =>
                        void action(async () => {
                          setSelected(target);
                          setConfiguration(
                            JSON.stringify(
                              await window.desktop.monitorConfig(target.id),
                              null,
                              2,
                            ),
                          );
                          setEditing(true);
                          setTlsAcknowledged(false);
                        })
                      }
                    >
                      Configure endpoint
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selected && (
        <section className="panel" aria-label="Detailed check result">
          <h3>
            {selected.name || "Endpoint"} — {selected.url}
          </h3>
          <button
            onClick={() => {
              setSelected(null);
              setEditing(false);
            }}
          >
            Close details
          </button>
          {editing ? (
            <>
              <p>
                Edit monitoring configuration. Timeouts and thresholds use
                milliseconds; retries means additional attempts. JSON paths use
                dot-separated own-property names; jsonExpected is a JSON value.
                Allowed status codes default to 200–299. Changes apply next
                cycle. Existing [REDACTED] values retain their encrypted
                secrets; enter an empty value to clear them.
              </p>
              <p>
                privateHosts grants exact private hostnames you are authorized
                to monitor. Redirects default off; cross-origin redirects need
                redirectOrigins authorization and never forward credentials or
                bodies. Scheme and method fallback are disabled.
              </p>
              <EndpointFields
                value={configuration}
                onChange={setConfiguration}
              />
              <details>
                <summary>
                  Advanced request headers, body and full configuration
                </summary>
                <label>
                  Endpoint configuration JSON
                  <textarea
                    aria-label="Endpoint configuration JSON"
                    rows={20}
                    value={configuration}
                    onChange={(e) => setConfiguration(e.target.value)}
                    spellCheck={false}
                  />
                </label>
              </details>
              <p role="alert">
                Security warning: insecureDiagnostic permits a separate
                unverified HEAD connection after a certificate failure. It omits
                query values and credentials, and cannot prove verified HTTPS
                health.
              </p>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={tlsAcknowledged}
                  onChange={(e) => setTlsAcknowledged(e.target.checked)}
                />
                I understand the security risk of an unverified TLS diagnostic.
              </label>
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const config: EndpointConfig = JSON.parse(configuration);
                    if (config.insecureDiagnostic && !tlsAcknowledged)
                      throw new Error(
                        "Acknowledge the TLS security warning before enabling insecure diagnostics",
                      );
                    await window.desktop.monitorSaveConfig(selected.id, config);
                    setEditing(false);
                    setMessage(
                      "Endpoint settings saved; apply on the next check.",
                    );
                  })
                }
              >
                Save endpoint configuration
              </button>
            </>
          ) : (
            (() => {
              const result =
                state?.targets.find((target) => target.id === selected.id)
                  ?.diagnostic ?? selected.diagnostic;
              return result ? (
                <>
                  <p>
                    <strong>{result.state}</strong> · Application:{" "}
                    {result.application} · Network: {result.network} · TLS:{" "}
                    {result.tls}
                  </p>
                  <p>
                    {result.method} · HTTP{" "}
                    {result.code ?? "no verified response"} ·{" "}
                    {result.responseMs} ms · {result.attempts} attempt(s) ·{" "}
                    {date(result.checkedAt)}
                  </p>
                  {result.errorType && (
                    <p>
                      {result.errorType}
                      {result.transportErrorCode
                        ? " (" + result.transportErrorCode + ")"
                        : ""}
                      : {result.errorMessage}
                    </p>
                  )}
                  <ul>
                    {result.assertions.map((check) => (
                      <li key={check.name}>
                        {check.passed ? "Passed" : "Failed"}: {check.name}
                      </li>
                    ))}
                  </ul>
                  {result.warnings.map((warning) => (
                    <p role="alert" key={warning}>
                      {warning}
                    </p>
                  ))}
                  {result.certificate && (
                    <p>
                      Certificate issuer: {result.certificate.issuer} · Valid
                      to: {result.certificate.validTo} · Hostname matches:{" "}
                      {String(result.certificate.hostnameValid)} ·{" "}
                      {result.certificate.error}
                    </p>
                  )}
                  {result.diagnostic && (
                    <p>
                      Separate UNVERIFIED diagnostic: HEAD{" "}
                      {result.diagnostic.url} · HTTP{" "}
                      {result.diagnostic.code ?? "no response"} ·{" "}
                      {result.diagnostic.responseMs} ms ·{" "}
                      {result.diagnostic.errorType ?? "HTTP response received"}.
                      Primary certificate failure remains unresolved.
                    </p>
                  )}
                  <details>
                    <summary>
                      Saved configuration and redirect trace (secrets hidden)
                    </summary>
                    <pre>
                      {JSON.stringify(
                        {
                          configuration: result.configuration,
                          redirects: result.redirects,
                          diagnosticCertificate: result.diagnostic?.certificate,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                  <p>
                    Response bodies and credentials are intentionally omitted
                    from previews and check history.
                  </p>
                </>
              ) : (
                <p>
                  No detailed check has been recorded for this endpoint yet.
                </p>
              );
            })()
          )}
        </section>
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
                          : state?.targets.find(
                                (target) => target.id === outage.targetId,
                              )?.status === "unknown"
                            ? "Recovery not observed (current health unknown)"
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
