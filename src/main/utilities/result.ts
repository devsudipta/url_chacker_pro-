import { randomUUID } from "node:crypto";
import type { UrlResult } from "../../../shared/types";
export function createResult(
  original: string,
  scanId: string,
  depth: number,
): UrlResult {
  return {
    id: randomUUID(),
    scanId,
    originalUrl: original,
    url: original,
    finalUrl: original,
    code: null,
    category: "error",
    label: "",
    errorCode: null,
    errorMessage: null,
    technicalError: null,
    timings: {
      dns: null,
      tcp: null,
      tls: null,
      ttfb: null,
      download: null,
      total: 0,
    },
    redirects: [],
    ssl: null,
    contentType: null,
    contentLength: null,
    checkedAt: new Date().toISOString(),
    attempts: 1,
    performance: "fast",
    depth,
  };
}
