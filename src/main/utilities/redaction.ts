import type { EndpointConfig } from "../../../shared/types";
export const secretMarker = "[REDACTED]";
// All query values are hidden, including values with unconventional parameter names.
// Operate on strings rather than URLSearchParams: do not reorder or normalize queries.
export function redactUrl(value: string): string {
  return value
    .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]*@/gi, "$1[REDACTED]@")
    .replace(/([?&][^=&#\s]*=)[^&#\s]*/g, "$1[REDACTED]");
}
export function publicConfig(config: EndpointConfig): EndpointConfig {
  return {
    ...config,
    headers: Object.fromEntries(
      Object.keys(config.headers).map((name) => [name, secretMarker]),
    ),
    body: config.body ? secretMarker : "",
    expectedText: config.expectedText ? secretMarker : "",
    jsonExpected: config.jsonExpected ? secretMarker : "",
  };
}
export function redactTree(value: unknown): unknown {
  if (typeof value === "string") return redactUrl(value);
  if (Array.isArray(value)) return value.map(redactTree);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, val]) => [key, redactTree(val)]),
    );
  return value;
}
