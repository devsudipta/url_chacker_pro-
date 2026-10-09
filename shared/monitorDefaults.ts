import type { EndpointConfig, Settings } from "./types";
export function monitorDefaults(settings?: Settings): EndpointConfig {
  return {
    method: "GET",
    headers: {},
    body: "",
    connectTimeout: settings?.timeout ?? 10000,
    responseTimeout: settings?.timeout ?? 10000,
    retries: settings?.retries ?? 2,
    retryDelay: Math.max(100, settings?.retryDelay ?? 1000),
    retryUnsafeMethods: false,
    expectedStatuses: Array.from({ length: 100 }, (_, i) => 200 + i),
    expectedText: "",
    jsonPath: "",
    jsonExpected: "",
    maxResponseMs: null,
    insecureDiagnostic: false,
    privateHosts: [],
    followRedirects: false,
    redirectOrigins: [],
  };
}
