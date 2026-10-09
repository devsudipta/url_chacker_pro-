import http from "node:http";
import https from "node:https";
import { checkServerIdentity, type TLSSocket } from "node:tls";
import { performance } from "node:perf_hooks";
type HttpMethod =
  "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
interface HeaderValue {
  name: string;
  value: string;
}
import type {
  Settings,
  SslInfo,
  Timings,
  UrlResult,
} from "../../../shared/types";
import { normalizeUrl } from "../utilities/url";
import { createResult } from "../utilities/result";
import { safeLookup, validateLiteral } from "./TargetPolicy";
import { gunzipSync, inflateSync, brotliDecompressSync } from "node:zlib";
import {
  classify,
  networkError,
  performanceClass,
  shouldRetry,
} from "./classification";

interface Hop {
  code: number;
  location?: string;
  timings: Timings;
  ssl: SslInfo | null;
  body: string;
  contentType: string | null;
  length: number;
  retryAfter: number;
  response: HttpResponseCapture;
}
export interface HttpResponseCapture {
  statusText: string;
  headers: HeaderValue[];
  bytes: Buffer;
  ip: string | null;
  httpVersion: string;
}
export interface HttpRequestOptions {
  connectTimeout?: number;
  responseTimeout?: number;
  insecureDiagnostic?: boolean;
  preserveMethod?: boolean;
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: Buffer;
  captureAll?: boolean;
  followRedirects?: boolean;
  beforeRedirect?: (
    source: string,
    destination: string,
    status: number,
  ) => void;
}
export interface ProbeOutput {
  result: UrlResult;
  body: string;
  retryAfter: number;
  response: HttpResponseCapture | null;
}
export class HttpProbeService {
  async probe(
    original: string,
    scanId: string,
    settings: Settings,
    signal: AbortSignal,
    depth = 0,
    gate?: (url: string) => Promise<() => void>,
    options: HttpRequestOptions = {},
  ): Promise<ProbeOutput> {
    let measuredTotal = 0;
    const result = createResult(original, scanId, depth);
    let body = "",
      retryAfter = 0;
    let response: HttpResponseCapture | null = null;
    let method: HttpMethod = options.method ?? "GET";
    let requestBody = options.body;
    let headers = { ...options.headers };
    try {
      try {
        result.url = normalizeUrl(original);
      } catch {
        throw Object.assign(new Error("Invalid or unsupported URL"), {
          code: "INVALID_URL",
        });
      }
      let current = result.url;
      const seen = new Set<string>();
      while (true) {
        if (seen.has(current))
          throw Object.assign(new Error("Repeated redirect URL"), {
            code: "REDIRECT_LOOP",
          });
        seen.add(current);
        result.finalUrl = current;
        result.code = null;
        result.ssl = null;
        result.contentType = null;
        result.contentLength = null;
        const release = gate ? await gate(current) : () => undefined;
        const requestStarted = performance.now();
        let hop: Hop;
        try {
          hop = await this.request(
            current,
            settings,
            signal,
            (info) => {
              result.ssl = info;
            },
            { ...options, method, body: requestBody, headers },
            (code, info) => {
              result.code = code;
              response = info;
            },
          );
        } finally {
          measuredTotal += performance.now() - requestStarted;
          release();
        }
        result.timings = hop.timings;
        result.ssl = hop.ssl;
        result.code = hop.code;
        result.transportConnected = true;
        result.contentType = hop.contentType;
        result.contentLength = hop.length;
        retryAfter = hop.retryAfter;
        response = hop.response;
        Object.assign(result, classify(hop.code));
        if (
          options.followRedirects !== false &&
          [301, 302, 303, 307, 308].includes(hop.code) &&
          hop.location
        ) {
          let destination: string;
          try {
            destination = normalizeUrl(hop.location, current);
          } catch {
            throw Object.assign(
              new Error("Redirect uses an invalid protocol or URL"),
              { code: "INVALID_URL" },
            );
          }
          if (result.redirects.length >= settings.maxRedirects)
            throw Object.assign(new Error("Redirect limit exceeded"), {
              code: "TOO_MANY_REDIRECTS",
            });
          result.redirects.push({
            source: current,
            destination,
            code: hop.code,
          });
          options.beforeRedirect?.(current, destination, hop.code);
          if (
            new URL(current).protocol === "https:" &&
            new URL(destination).protocol !== "https:"
          )
            throw Object.assign(new Error("HTTPS downgrade redirect blocked"), {
              code: "UNSAFE_REDIRECT",
            });
          if (
            (hop.code === 303 && method !== "GET" && method !== "HEAD") ||
            ([301, 302].includes(hop.code) && method === "POST")
          ) {
            if (options.preserveMethod)
              throw Object.assign(
                new Error(
                  "Redirect would change the configured method; check the destination explicitly",
                ),
                { code: "METHOD_REDIRECT_BLOCKED" },
              );
            method = "GET";
            requestBody = undefined;
            headers = Object.fromEntries(
              Object.entries(headers).filter(
                ([name]) =>
                  ![
                    "content-length",
                    "content-type",
                    "transfer-encoding",
                  ].includes(name.toLowerCase()),
              ),
            );
          }
          if (new URL(current).origin !== new URL(destination).origin) {
            if (
              requestBody?.length ||
              Object.keys(headers).some(
                (name) =>
                  ![
                    "accept",
                    "accept-encoding",
                    "user-agent",
                    "cache-control",
                  ].includes(name.toLowerCase()),
              )
            )
              throw Object.assign(
                new Error(
                  "Cross-origin redirect blocked to protect credentials and request body",
                ),
                { code: "CREDENTIAL_REDIRECT_BLOCKED" },
              );
            headers = Object.fromEntries(
              Object.entries(headers).filter(([name]) =>
                [
                  "accept",
                  "accept-encoding",
                  "user-agent",
                  "cache-control",
                ].includes(name.toLowerCase()),
              ),
            );
          }
          current = destination;
          continue;
        }
        body = hop.body;
        if (result.redirects.length && result.category === "online") {
          result.category = "redirect";
          result.label = "Redirected → online";
        }
        if (result.errorCode) result.errorMessage = result.label;
        break;
      }
    } catch (error) {
      if (signal.aborted) throw error;
      const transport = error as {
        transportConnected?: boolean;
        timings?: Timings;
      };
      result.transportConnected = transport.transportConnected ?? false;
      if (transport.timings) result.timings = transport.timings;
      const classified = networkError(error);
      result.category = classified.category;
      result.label = classified.friendly;
      result.errorCode = classified.code;
      result.errorMessage = classified.friendly;
      result.technicalError = classified.technical;
    }
    result.timings.total = Math.round(measuredTotal);
    result.performance = performanceClass(result.timings.total, settings);
    result.checkedAt = new Date().toISOString();
    return { result, body, retryAfter, response };
  }
  async withRetries(
    original: string,
    scanId: string,
    s: Settings,
    signal: AbortSignal,
    depth = 0,
    gate?: (url: string) => Promise<() => void>,
    options: HttpRequestOptions = {},
  ): Promise<ProbeOutput> {
    let output: ProbeOutput;
    for (let attempt = 0; ; attempt++) {
      output = await this.probe(
        original,
        scanId,
        s,
        signal,
        depth,
        gate,
        options,
      );
      output.result.attempts = attempt + 1;
      if (attempt >= s.retries || !shouldRetry(output.result)) return output;
      await abortableDelay(
        Math.min(
          60000,
          Math.max(output.retryAfter, s.retryDelay * 2 ** attempt),
        ),
        signal,
      );
    }
  }
  private request(
    url: string,
    settings: Settings,
    signal: AbortSignal,
    certificate: (info: SslInfo) => void,
    options: HttpRequestOptions,
    responseHeaders: (code: number, info: HttpResponseCapture) => void,
  ): Promise<Hop> {
    return new Promise((resolve, reject) => {
      const begun = performance.now();
      let dnsEnd: number | null = null,
        connectEnd: number | null = null,
        secureEnd: number | null = null;
      let ssl: SslInfo | null = null,
        finished = false;
      const timings: Timings = {
        dns: null,
        tcp: null,
        tls: null,
        ttfb: null,
        download: null,
        total: 0,
      };
      const parsed = new URL(url);
      validateLiteral(parsed, settings.allowedPrivateHosts ?? []);
      const req = (parsed.protocol === "https:" ? https : http).request(
        parsed,
        {
          method: options.method ?? "GET",
          agent: false,
          ...{ autoSelectFamily: true },
          lookup: safeLookup(settings.allowedPrivateHosts ?? []),
          rejectUnauthorized: options.insecureDiagnostic !== true,
          signal,
          headers: {
            "user-agent": settings.userAgent,
            accept: "*/*",
            "accept-encoding": "identity",
            ...options.headers,
          },
        },
        (response) => {
          const firstByte = performance.now();
          timings.ttfb = Math.round(
            firstByte - (secureEnd ?? connectEnd ?? begun),
          );
          let bytes = 0;
          const chunks: Buffer[] = [];
          const type = String(response.headers["content-type"] ?? "");
          const capture =
            options.captureAll ||
            /text\/html|text\/plain|application\/xhtml/i.test(type);
          const captured: HttpResponseCapture = {
            statusText: response.statusMessage ?? "",
            headers: [],
            bytes: Buffer.alloc(0),
            ip: response.socket.remoteAddress ?? null,
            httpVersion: response.httpVersion,
          };
          for (let i = 0; i < response.rawHeaders.length; i += 2)
            captured.headers.push({
              name: response.rawHeaders[i],
              value: response.rawHeaders[i + 1],
            });
          responseHeaders(response.statusCode ?? 0, captured);
          response.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 10 * 1024 * 1024) {
              req.destroy(
                Object.assign(new Error("Response body limit exceeded"), {
                  code: "BODY_TOO_LARGE",
                }),
              );
              return;
            }
            if (capture) chunks.push(chunk);
          });
          response.on("error", fail);
          response.on("end", () => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            clearTimeout(responseTimer);
            timings.download = Math.round(performance.now() - firstByte);
            timings.total = Math.round(performance.now() - begun);
            const retry = response.headers["retry-after"];
            let retryAfter = 0;
            if (typeof retry === "string")
              retryAfter = /^\d+$/.test(retry)
                ? Number(retry) * 1000
                : Math.max(0, Date.parse(retry) - Date.now()) || 0;
            try {
              const compressed = Buffer.concat(chunks);
              const encoding = String(
                response.headers["content-encoding"] ?? "identity",
              ).toLowerCase();
              const limit = { maxOutputLength: 10 * 1024 * 1024 };
              captured.bytes =
                !capture ||
                options.method === "HEAD" ||
                [204, 304].includes(response.statusCode ?? 0) ||
                encoding === "identity"
                  ? compressed
                  : encoding === "gzip"
                    ? gunzipSync(compressed, limit)
                    : encoding === "deflate"
                      ? inflateSync(compressed, limit)
                      : encoding === "br"
                        ? brotliDecompressSync(compressed, limit)
                        : (() => {
                            throw new Error("Unsupported response encoding");
                          })();
            } catch {
              reject(
                Object.assign(
                  new Error("Response could not be decoded safely"),
                  { code: "RESPONSE_DECODE_ERROR" },
                ),
              );
              return;
            }
            resolve({
              code: response.statusCode ?? 0,
              location: response.headers.location,
              timings,
              ssl,
              body: captured.bytes.toString("utf8"),
              contentType: type || null,
              length: bytes,
              retryAfter,
              response: captured,
            });
          });
        },
      );
      function fail(error: Error): void {
        if (!finished) {
          finished = true;
          clearTimeout(timer);
          clearTimeout(responseTimer);
          reject(
            Object.assign(error, {
              transportConnected: connectEnd !== null,
              timings: {
                ...timings,
                total: Math.round(performance.now() - begun),
              },
            }),
          );
        }
      }
      const timer = setTimeout(
        () =>
          req.destroy(
            Object.assign(new Error("Connection timeout (DNS, TCP or TLS)"), {
              code: "ETIMEDOUT",
            }),
          ),
        options.connectTimeout ?? settings.timeout,
      );
      let responseTimer: ReturnType<typeof setTimeout> | undefined;
      const connected = (): void => {
        clearTimeout(timer);
        responseTimer = setTimeout(
          () =>
            req.destroy(
              Object.assign(new Error("Response timeout"), {
                code: "ETIMEDOUT",
              }),
            ),
          options.responseTimeout ?? settings.timeout,
        );
      };
      req.on("error", fail);
      req.on("socket", (socket) => {
        socket.once("lookup", () => {
          dnsEnd = performance.now();
          timings.dns = Math.round(dnsEnd - begun);
        });
        socket.once("connect", () => {
          connectEnd = performance.now();
          timings.tcp = Math.round(connectEnd - (dnsEnd ?? begun));
          if (parsed.protocol === "http:") connected();
        });
        if (parsed.protocol === "https:") {
          const tls = socket as TLSSocket;
          const inspect = (): void => {
            const cert = tls.getPeerCertificate();
            if (!cert?.valid_to) return;
            const hostnameValid = !checkServerIdentity(
              parsed.hostname.replace(/^\[|\]$/g, ""),
              cert,
            );
            ssl = {
              valid: tls.authorized && hostnameValid,
              subject: JSON.stringify(cert.subject),
              issuer: JSON.stringify(cert.issuer),
              validFrom: cert.valid_from,
              validTo: cert.valid_to,
              daysRemaining: Math.floor(
                (Date.parse(cert.valid_to) - Date.now()) / 86400000,
              ),
              hostnameValid,
              error: tls.authorized ? null : String(tls.authorizationError),
            };
            certificate(ssl);
          };
          tls.once("secureConnect", () => {
            connected();
            secureEnd = performance.now();
            timings.tls =
              connectEnd === null ? null : Math.round(secureEnd - connectEnd);
            inspect();
          });
          tls.once("error", inspect);
        }
      });
      req.end(options.body);
    });
  }
}
export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
