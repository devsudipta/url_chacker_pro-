import { z } from "zod";
const hosts = z
  .array(
    z
      .string()
      .min(1)
      .max(253)
      .regex(/^[a-zA-Z0-9.:[\]-]+$/),
  )
  .max(100);
export const endpointSchema = z
  .object({
    method: z.enum([
      "GET",
      "HEAD",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ]),
    headers: z
      .record(
        z.string().regex(/^[!#$%&'*+.^_`|~0-9a-zA-Z-]+$/),
        z
          .string()
          .max(16384)
          .regex(/^[\x20-\xff]*$/),
      )
      .refine(
        (headers) =>
          Object.keys(headers).length <= 100 &&
          !Object.keys(headers).some((name) =>
            [
              "host",
              "connection",
              "content-length",
              "transfer-encoding",
              "upgrade",
              "proxy-authorization",
              "proxy-connection",
            ].includes(name.toLowerCase()),
          ),
        "Unsafe request headers are not permitted",
      ),
    body: z.string().max(1024 * 1024),
    connectTimeout: z.number().int().min(100).max(120000),
    responseTimeout: z.number().int().min(100).max(120000),
    retries: z.number().int().min(0).max(5),
    retryDelay: z.number().int().min(100).max(60000),
    retryUnsafeMethods: z.boolean(),
    expectedStatuses: z
      .array(z.number().int().min(100).max(599))
      .min(1)
      .max(500),
    expectedText: z.string().max(10000),
    jsonPath: z
      .string()
      .max(500)
      .refine(
        (value) =>
          !value
            .split(".")
            .some((key) =>
              ["__proto__", "constructor", "prototype"].includes(key),
            ),
      ),
    jsonExpected: z.string().max(10000),
    maxResponseMs: z.number().min(1).max(240000).nullable(),
    insecureDiagnostic: z.boolean(),
    privateHosts: hosts,
    followRedirects: z.boolean(),
    redirectOrigins: z
      .array(
        z
          .string()
          .url()
          .refine((value) => {
            const url = new URL(value);
            return (
              ["http:", "https:"].includes(url.protocol) &&
              !url.username &&
              !url.password &&
              url.origin === value
            );
          }),
      )
      .max(100),
  })
  .refine(
    (config) =>
      !config.jsonPath ||
      config.jsonExpected === "[REDACTED]" ||
      (() => {
        try {
          JSON.parse(config.jsonExpected);
          return true;
        } catch {
          return false;
        }
      })(),
    "JSON expected value must be valid JSON",
  );
