import type { Category, Settings, UrlResult } from "../../../shared/types";
export function classify(code: number): {
  category: Category;
  label: string;
  errorCode: string | null;
} {
  const labels: Record<number, string> = {
    301: "Permanent redirect",
    302: "Temporary redirect",
    303: "See other",
    307: "Temporary redirect",
    308: "Permanent redirect",
    400: "Bad request",
    401: "Authentication required",
    403: "Forbidden",
    404: "Not found",
    410: "Gone",
    429: "Rate limited",
    500: "Server error",
    502: "Bad gateway",
    503: "Service unavailable",
    504: "Gateway timeout",
  };
  const category: Category =
    code >= 200 && code < 300
      ? "online"
      : code >= 300 && code < 400
        ? "redirect"
        : code === 429
          ? "rate-limited"
          : code === 401 || code === 403
            ? "blocked"
            : code >= 400
              ? "broken"
              : "error";
  return {
    category,
    label: labels[code] ?? (category === "online" ? "Online" : `HTTP ${code}`),
    errorCode:
      code >= 400
        ? code === 429
          ? "RATE_LIMITED"
          : code === 403
            ? "BLOCKED"
            : `HTTP_${code}`
        : null,
  };
}
export function networkError(error: unknown): {
  category: Category;
  code: string;
  friendly: string;
  technical: string;
} {
  const err = error as NodeJS.ErrnoException;
  const raw = err.code ?? "UNKNOWN_ERROR";
  const map: Record<string, [Category, string, string]> = {
    TARGET_BLOCKED: [
      "skipped",
      "TARGET_BLOCKED",
      "Target blocked by monitoring authorization policy",
    ],
    UNSAFE_REDIRECT: [
      "redirect",
      "UNSAFE_REDIRECT",
      "HTTPS downgrade redirect blocked",
    ],
    METHOD_REDIRECT_BLOCKED: [
      "redirect",
      "METHOD_REDIRECT_BLOCKED",
      "Redirect would change the configured request method",
    ],
    RESPONSE_DECODE_ERROR: [
      "error",
      "RESPONSE_DECODE_ERROR",
      "Response could not be decoded safely",
    ],
    CREDENTIAL_REDIRECT_BLOCKED: [
      "redirect",
      "CREDENTIAL_REDIRECT_BLOCKED",
      "Cross-origin redirect stopped to protect request credentials or body",
    ],
    ENOTFOUND: ["dns", "DNS_NOT_FOUND", "Hostname could not be resolved"],
    EAI_AGAIN: ["dns", "DNS_TIMEOUT", "DNS lookup temporarily failed"],
    ECONNREFUSED: [
      "connection",
      "CONNECTION_REFUSED",
      "Server refused the connection",
    ],
    ECONNRESET: ["connection", "CONNECTION_RESET", "Connection was reset"],
    ENETUNREACH: [
      "connection",
      "NETWORK_UNREACHABLE",
      "Network is unreachable",
    ],
    EHOSTUNREACH: ["connection", "HOST_UNREACHABLE", "Host is unreachable"],
    ETIMEDOUT: ["timeout", "REQUEST_TIMEOUT", "Request exceeded the timeout"],
    CERT_HAS_EXPIRED: ["ssl", "SSL_EXPIRED", "SSL certificate has expired"],
    ERR_TLS_CERT_ALTNAME_INVALID: [
      "ssl",
      "SSL_HOSTNAME_MISMATCH",
      "Certificate does not match the hostname",
    ],
    REDIRECT_LOOP: ["redirect", "REDIRECT_LOOP", "Redirect loop detected"],
    TOO_MANY_REDIRECTS: [
      "redirect",
      "TOO_MANY_REDIRECTS",
      "Maximum redirects exceeded",
    ],
    INVALID_URL: ["invalid", "INVALID_URL", "Invalid or unsafe URL"],
    ROBOTS_DISALLOWED: [
      "skipped",
      "ROBOTS_DISALLOWED",
      "Skipped by robots.txt",
    ],
    ROBOTS_UNAVAILABLE: [
      "skipped",
      "ROBOTS_UNAVAILABLE",
      "Robots policy could not be retrieved; crawling skipped",
    ],
    BODY_TOO_LARGE: [
      "error",
      "BODY_TOO_LARGE",
      "Response exceeds the 10 MB safety limit",
    ],
  };
  const entry =
    map[raw] ??
    (/CERT|SSL|TLS|SELF_SIGNED|UNTRUSTED_ROOT/.test(raw)
      ? (["ssl", "SSL_ERROR", "SSL certificate validation failed"] as const)
      : (["error", "UNKNOWN_ERROR", "Request failed"] as const));
  return {
    category: entry[0],
    code: entry[1],
    friendly: entry[2],
    technical: `${raw}: ${err.message ?? String(error)}`,
  };
}
export function shouldRetry(
  result: Pick<UrlResult, "errorCode" | "code">,
): boolean {
  return (
    [
      "DNS_TIMEOUT",
      "CONNECTION_RESET",
      "REQUEST_TIMEOUT",
      "CONNECTION_REFUSED",
    ].includes(result.errorCode ?? "") ||
    [429, 500, 502, 503, 504].includes(result.code ?? 0)
  );
}
export function performanceClass(
  ms: number,
  s: Settings,
): UrlResult["performance"] {
  return ms < s.fastThreshold
    ? "fast"
    : ms < s.normalThreshold
      ? "normal"
      : ms <= s.slowThreshold
        ? "slow"
        : "very slow";
}
