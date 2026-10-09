import type {
  DiagnosticState,
  EndpointConfig,
  HealthResult,
  Settings,
} from "../../../shared/types";
import { HttpProbeService, abortableDelay } from "./HttpProbeService";
import { shouldRetry } from "./classification";
import { publicConfig, redactUrl } from "../utilities/redaction";

export class HealthCheckService {
  constructor(private probe = new HttpProbeService()) {}
  async check(
    url: string,
    scanId: string,
    settings: Settings,
    config: EndpointConfig,
    signal: AbortSignal,
    gate?: (url: string) => Promise<() => void>,
  ): Promise<HealthResult> {
    const effective = {
      ...settings,
      allowedPrivateHosts: [
        ...(settings.allowedPrivateHosts ?? []),
        ...config.privateHosts,
      ],
    };
    const options = {
      method: config.method,
      headers: config.headers,
      body: config.body ? Buffer.from(config.body) : undefined,
      captureAll: true,
      connectTimeout: config.connectTimeout,
      responseTimeout: config.responseTimeout,
      followRedirects: config.followRedirects,
      preserveMethod: true,
      beforeRedirect: (source: string, destination: string): void => {
        if (
          new URL(source).origin !== new URL(destination).origin &&
          !config.redirectOrigins.includes(new URL(destination).origin)
        )
          throw Object.assign(new Error("Redirect origin is not authorized"), {
            code: "UNSAFE_REDIRECT",
          });
      },
    };
    let output,
      attempts = 0;
    const retrySafe =
      ["GET", "HEAD", "OPTIONS"].includes(config.method) ||
      config.retryUnsafeMethods;
    do {
      output = await this.probe.probe(
        url,
        scanId,
        effective,
        signal,
        0,
        gate,
        options,
      );
      attempts++;
      const acceptedStatus =
        output.result.code !== null &&
        config.expectedStatuses.includes(output.result.code) &&
        (!output.result.errorCode ||
          /^(HTTP_\d+|RATE_LIMITED|BLOCKED)$/.test(output.result.errorCode));
      if (
        acceptedStatus ||
        !retrySafe ||
        attempts > config.retries ||
        !shouldRetry(output.result)
      )
        break;
      await abortableDelay(
        Math.min(
          60000,
          Math.max(output.retryAfter, config.retryDelay * 2 ** (attempts - 1)),
        ),
        signal,
      );
    } while (!signal.aborted);
    const result = output.result;
    const rawError = result.technicalError?.split(":")[0] ?? null;
    const certificateFailure =
      result.category === "ssl" &&
      /CERT|SELF_SIGNED|UNTRUSTED_ROOT|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/.test(
        rawError ?? "",
      );
    const policyFailure = [
      "TARGET_BLOCKED",
      "INVALID_URL",
      "UNSAFE_REDIRECT",
      "METHOD_REDIRECT_BLOCKED",
      "CREDENTIAL_REDIRECT_BLOCKED",
      "REDIRECT_LOOP",
      "TOO_MANY_REDIRECTS",
    ].includes(result.errorCode ?? "");
    const transportError =
      result.errorCode &&
      !["online", "broken", "blocked", "rate-limited"].includes(
        result.category,
      );
    let state: DiagnosticState = certificateFailure
      ? "TLS Certificate Error"
      : result.category === "timeout"
        ? "Timeout"
        : result.category === "dns"
          ? "DNS Error"
          : result.errorCode === "CONNECTION_REFUSED"
            ? "Connection Refused"
            : policyFailure ||
                result.errorCode === "RESPONSE_DECODE_ERROR" ||
                result.errorCode === "BODY_TOO_LARGE"
              ? "Unexpected Response"
              : transportError
                ? "Network Error"
                : "Healthy";
    const assertions: HealthResult["assertions"] = [];
    if (!transportError && result.code !== null) {
      const status = config.expectedStatuses.includes(result.code);
      assertions.push({
        name: `HTTP status matches configured allowed statuses`,
        passed: status,
      });
      if (!status)
        state = result.code >= 400 ? "HTTP Error" : "Unexpected Response";
      if (config.expectedText)
        assertions.push({
          name: "Expected response text matches",
          passed: output.body.includes(config.expectedText),
        });
      if (config.jsonPath) {
        let passed = false;
        try {
          let actual: unknown = JSON.parse(output.body);
          for (const key of config.jsonPath.split(".")) {
            if (
              !actual ||
              typeof actual !== "object" ||
              !Object.prototype.hasOwnProperty.call(actual, key)
            ) {
              actual = undefined;
              break;
            }
            actual = (actual as Record<string, unknown>)[key];
          }
          const expected: unknown = JSON.parse(config.jsonExpected);
          passed = JSON.stringify(actual) === JSON.stringify(expected);
        } catch {
          /* No response values are included in diagnostics. */
        }
        assertions.push({ name: "Expected JSON field matches", passed });
      }
      if (config.maxResponseMs !== null)
        assertions.push({
          name: `Response within ${config.maxResponseMs} ms`,
          passed: result.timings.total <= config.maxResponseMs,
        });
      if (
        state === "Healthy" &&
        assertions.some((assertion) => !assertion.passed)
      )
        state = "Unexpected Response";
    }
    const tls =
      state === "TLS Certificate Error"
        ? "certificate error"
        : new URL(url).protocol === "https:"
          ? result.ssl?.valid
            ? "verified"
            : "unknown"
          : "not applicable";
    const reachable =
      result.code !== null ||
      result.transportConnected === true ||
      result.category === "ssl";
    const blocked = ["TARGET_BLOCKED", "INVALID_URL"].includes(
      result.errorCode ?? "",
    );
    const health: HealthResult = {
      state,
      application:
        state === "Healthy"
          ? "healthy"
          : policyFailure || result.category === "ssl"
            ? "unknown"
            : blocked
              ? "unknown"
              : "failed",
      network: reachable ? "reachable" : blocked ? "unknown" : "unreachable",
      tls,
      method: config.method,
      code: result.code,
      responseMs: result.timings.total,
      checkedAt: result.checkedAt,
      attempts,
      errorType:
        state === "Healthy" ? null : (result.errorCode ?? "EXPECTATION_FAILED"),
      transportErrorCode: rawError,
      errorMessage:
        state === "Healthy"
          ? null
          : state === "Timeout"
            ? (result.technicalError?.includes("Connection timeout")
                ? "Connection deadline exceeded (" + config.connectTimeout
                : "Response deadline exceeded (" + config.responseTimeout) +
              " ms)"
            : transportError
              ? result.errorMessage
              : state === "HTTP Error"
                ? `HTTP ${result.code} is outside the configured expected statuses`
                : "Response did not satisfy configured expectations",
      assertions,
      warnings: [],
      configuration: publicConfig(config),
      certificate: result.ssl,
      redirects: result.redirects.map((item) => ({
        ...item,
        source: redactUrl(item.source),
        destination: redactUrl(item.destination),
      })),
      diagnostic: null,
    };
    if (state === "TLS Certificate Error" && config.insecureDiagnostic) {
      health.warnings.push(
        "SECURITY WARNING: Separate unverified TLS diagnostic only. Certificate verification failed; this is never a verified healthy HTTPS check. Credentials, query values and request bodies are not sent.",
      );
      // Diagnostics have no credentials/query secrets or mutation side effects. The original verified request remains authoritative.
      const diagnosticUrl = new URL(result.finalUrl || url);
      diagnosticUrl.search = "";
      const diagnostic = await this.probe.probe(
        diagnosticUrl.href,
        scanId,
        effective,
        signal,
        0,
        gate,
        {
          method: "HEAD",
          followRedirects: false,
          insecureDiagnostic: true,
          connectTimeout: config.connectTimeout,
          responseTimeout: config.responseTimeout,
        },
      );
      health.diagnostic = {
        url: redactUrl(diagnosticUrl.href),
        verified: false,
        code: diagnostic.result.code,
        responseMs: diagnostic.result.timings.total,
        errorType: diagnostic.result.errorCode,
        certificate: diagnostic.result.ssl,
      };
    }
    if (!retrySafe && config.retries)
      health.warnings.push(
        "Retries disabled for this method to avoid replaying changes. Enable retryUnsafeMethods only when replay is safe.",
      );
    if (health.diagnostic)
      health.warnings.push(
        "Diagnostic uses HEAD without query parameters; it establishes transport reachability, not the original API's response expectations.",
      );
    return health;
  }
}
