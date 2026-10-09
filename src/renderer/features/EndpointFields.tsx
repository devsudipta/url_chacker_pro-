import type { EndpointConfig } from "../../../shared/types";

export function EndpointFields({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}): React.JSX.Element {
  let config: EndpointConfig;
  try {
    config = JSON.parse(value);
    if (!config || !config.headers || !Array.isArray(config.expectedStatuses))
      return <p>Correct the configuration JSON below to use the form.</p>;
  } catch {
    return <p>Correct the configuration JSON below to use the form.</p>;
  }
  const change = (patch: Partial<EndpointConfig>): void =>
    onChange(JSON.stringify({ ...config, ...patch }, null, 2));
  return (
    <div className="settings-grid">
      <label>
        Request method
        <select
          aria-label="Request method"
          value={config.method}
          onChange={(e) =>
            change({ method: e.target.value as EndpointConfig["method"] })
          }
        >
          {["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].map(
            (method) => (
              <option key={method}>{method}</option>
            ),
          )}
        </select>
      </label>
      {(
        [
          ["connectTimeout", "Connection timeout (ms)"],
          ["responseTimeout", "Response timeout (ms)"],
          ["retries", "Retry attempts"],
          ["retryDelay", "Initial backoff (ms)"],
        ] as const
      ).map(([key, label]) => (
        <label key={key}>
          {label}
          <input
            type="number"
            aria-label={label}
            value={config[key]}
            onChange={(e) => change({ [key]: Number(e.target.value) })}
          />
        </label>
      ))}
      <label>
        Expected status codes
        <input
          aria-label="Expected status codes"
          value={config.expectedStatuses.join(",")}
          onChange={(e) =>
            change({
              expectedStatuses: e.target.value
                .split(",")
                .map((code) => Number(code.trim())),
            })
          }
        />
      </label>
      <label>
        Maximum response time (ms; blank disables)
        <input
          type="number"
          value={config.maxResponseMs ?? ""}
          onChange={(e) =>
            change({
              maxResponseMs: e.target.value ? Number(e.target.value) : null,
            })
          }
        />
      </label>
      <label>
        Expected response text
        <input
          type="password"
          autoComplete="off"
          value={config.expectedText}
          onChange={(e) => change({ expectedText: e.target.value })}
        />
      </label>
      <label>
        JSON field path
        <input
          value={config.jsonPath}
          placeholder="health.ok"
          onChange={(e) => change({ jsonPath: e.target.value })}
        />
      </label>
      <label>
        Expected JSON value
        <input
          type="password"
          autoComplete="off"
          value={config.jsonExpected}
          onChange={(e) => change({ jsonExpected: e.target.value })}
        />
      </label>
      <label>
        Authorized private hosts
        <input
          value={config.privateHosts.join(",")}
          onChange={(e) =>
            change({
              privateHosts: e.target.value
                .split(",")
                .map((host) => host.trim())
                .filter(Boolean),
            })
          }
        />
      </label>
      <label>
        Authorized redirect origins
        <input
          value={config.redirectOrigins.join(",")}
          placeholder="https://api.example.com"
          onChange={(e) =>
            change({
              redirectOrigins: e.target.value
                .split(",")
                .map((origin) => origin.trim())
                .filter(Boolean),
            })
          }
        />
      </label>
      {(
        [
          ["followRedirects", "Follow authorized redirects"],
          ["retryUnsafeMethods", "Allow retries that may repeat API changes"],
          [
            "insecureDiagnostic",
            "Enable separate insecure TLS diagnostic (security risk)",
          ],
        ] as const
      ).map(([key, label]) => (
        <label className="checkbox" key={key}>
          <input
            type="checkbox"
            checked={config[key]}
            onChange={(e) => change({ [key]: e.target.checked })}
          />
          {label}
        </label>
      ))}
    </div>
  );
}
