# Monitoring implementation — 1.2.5

## Existing architecture and root cause

The app retains its Electron 44 / React 19 / TypeScript / SQLite architecture. Networking runs in the main process; the renderer is sandboxed and uses validated IPC. `HttpProbeService` is reused by scans, crawling and the new `HealthCheckService`. `MonitorService` still schedules non-overlapping cycles and `MonitorStore` retains outage transitions.

Before this change, monitoring forced retries to zero and performed only GET requests. It collapsed every failure into Offline, including a reachable server with an untrusted certificate. Automatic mode could replace a failed HTTPS result with an HTTP result and discard the original TLS failure. HTTP success alone could not validate API payloads. The request engine used a single deadline and lacked DNS/redirect destination authorization.

For the supplied diagnostic example, successful HTTP GET/HEAD demonstrates an HTTP response. HTTPS certificate rejection demonstrates a TLS trust problem, not an unreachable host. A response obtained without verification remains unverified. The supplied production endpoint was not contacted during development; equivalent local servers exercise these cases without invoking the PHP endpoint.

## New request and diagnostic path

`HealthCheckService` performs the configured request with certificate verification enabled, evaluates expected statuses/text/JSON/time, and produces eight distinct states. Application, network and TLS indicators are independent. An additive third SQLite migration stores per-URL endpoint settings and a detailed result JSON on every check and target. Prior tables, scans, endpoint records and history are retained. Historic checks without detailed diagnostics remain readable.

TLS-only failures and policy-blocked requests have unknown application health. They cannot open application outages or close existing outages. Verified success closes an outage; HTTP errors, expectation failures and unreachable targets open one. Unknown periods leave an existing outage unresolved; duration remains the interval between observed failure and later observed verified recovery, rather than measured continuous availability. Old historical observations are not reclassified.

Connect timeout covers DNS/TCP/TLS; the response deadline covers first byte through response completion. Total response time measures the final attempt, including redirects but excluding queue and backoff waits. Retry attempts are additional requests. Transient timeouts/refusals/resets/DNS retry errors and HTTP 429/500/502/503/504 use exponential backoff, capped at 60 seconds, respecting Retry-After. An explicitly accepted HTTP status is not retried. State-changing methods require explicit replay permission. No method fallback is implemented.

Queries are never rebuilt with URLSearchParams. Duplicate names, empty names, empty values, ordering and escaped values survive request dispatch. Normal URL parsing still canonicalizes hostnames/default ports and removes fragments as in previous releases.

Captured responses are bounded to 10 MB compressed and decompressed. gzip, deflate and Brotli are decoded before matching. Text bodies are interpreted as UTF-8; binary/non-UTF-8 payload matching is not supported. JSON paths walk only own properties; forbidden prototype property names are rejected. JSON values are compared by serialization, so object key order matters.

## TLS diagnostic isolation

An explicitly configured per-endpoint diagnostic makes a separate HEAD request only after a certificate validation failure. Its request has no custom headers, body, query or redirects. `rejectUnauthorized: false` exists only on that single diagnostic request. Primary checks explicitly set it true. The primary certificate failure is retained, and the detailed panel labels the secondary status as UNVERIFIED. HTTP-to-HTTPS/HTTPS-to-HTTP probing and silent method rewriting are removed. HTTPS downgrade redirects are blocked everywhere; monitoring redirects that would rewrite POST are blocked with an explanation.

## Authorization, SSRF and secrets

The local app has no server/API listener or remote user accounts. The trusted main window is the authorization boundary: IPC checks webContents, main frame and exact renderer URL, then validates IDs and configuration. Monitoring uses saved scan endpoints; unknown endpoint IDs cannot configure requests.

Public HTTP/HTTPS targets are permitted only through user-requested scans/monitoring. Private/loopback/reserved targets require exact hostname grants; wildcards and CIDR grants are not accepted. Metadata/link-local, unspecified, multicast and IPv6 transition ranges are blocked even with grants. DNS lookup validates every returned address before supplying a pinned list to Node's address-family selection; no second resolver lookup occurs. Literal IPs are validated too, including canonical numeric IPv4 and mapped IPv6. Every redirect destination and every retry undergoes the same policy. Endpoint redirects default off; cross-origin redirects require an exact origin grant and cannot forward credentials/custom headers or request bodies. Header overrides for Host, transfer framing, connection upgrade and proxy credentials are rejected.

This follows the validation/redirect/DNS-rebinding principles in the [OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html). Host grants authorize that exact hostname's resolved private addresses and ports; grant only systems you control. This policy is not a replacement for OS/network firewall rules.

Saved API headers, bodies, and expected secret values are encrypted with Electron safeStorage (Windows DPAPI). Storage fails closed if encryption is unavailable. The SQLite public configuration contains only redacted placeholders; decrypting happens only in the main process for a request. Editing a placeholder preserves the encrypted value; empty values clear it. Configuration previews and check-history snapshots redact all header values and expected secret values; query values are masked without changing the dispatched URL. No response body is persisted or previewed. Logs omit exception content to prevent arbitrary secret-bearing error text from being written.

Existing URLs/history remain intact in the local database, including original query strings, and old records are not rewritten or encrypted retrospectively. Exported monitoring JSON redacts URL query values; exporting original scan reports remains an explicit local action that can include original URLs. DPAPI protects stored API configuration, but does not provide access control against other processes running as the same Windows user. Use normal OS account/disk protection for database files, exports and backups.

## Verification and limits

Tests use real local HTTP/TLS servers: success/error statuses, every supported method, duplicate/empty queries, compressed JSON, invalid expectations, thresholds, refused connections, DNS failures, connection/TLS/response timeouts, trusted/untrusted certificates, isolated insecure diagnostics, backoff/replay restrictions, unsafe redirects/private grants, encrypted persistence and preserved history. Desktop tests exercise real Electron windows, configuration edits, redaction, outage/recovery and restarts. This remains a desktop monitor that stops when closed; no Windows background service or remote monitoring backend is introduced.
