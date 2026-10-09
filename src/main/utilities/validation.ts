import { z } from "zod";
export const settingsSchema = z
  .object({
    allowedPrivateHosts: z
      .array(
        z
          .string()
          .max(253)
          .regex(/^[a-zA-Z0-9.:[\]-]+$/),
      )
      .max(100)
      .default([]),
    protocol: z.enum(["auto", "https", "http", "both"]).default("auto"),
    concurrency: z.number().int().min(1).max(100),
    timeout: z.number().int().min(100).max(120000),
    retries: z.number().int().min(0).max(5),
    retryDelay: z.number().int().min(0).max(60000),
    maxRedirects: z.number().int().min(0).max(30),
    crawlDepth: z.number().int().min(-1).max(100),
    maxPages: z.number().int().min(1).max(100000),
    perHostConcurrency: z.number().int().min(1).max(100),
    hostDelay: z.number().int().min(0).max(60000),
    respectRobots: z.boolean(),
    checkAssets: z.boolean(),
    userAgent: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[\x20-\x7e]+$/),
    fastThreshold: z.number().min(1).max(120000),
    normalThreshold: z.number().min(1).max(120000),
    slowThreshold: z.number().min(1).max(120000),
    theme: z.enum(["dark", "light", "system"]),
  })
  .refine(
    (s) =>
      s.fastThreshold < s.normalThreshold &&
      s.normalThreshold < s.slowThreshold,
    "Timing thresholds must increase",
  );
export const textSchema = z.string().max(20_000_000);
export const idSchema = z.string().uuid();
export const querySchema = z.object({
  scanId: idSchema,
  page: z.number().int().min(0).max(100000),
  search: z.string().max(500),
  filter: z.enum([
    "all",
    "online",
    "broken",
    "redirect",
    "timeout",
    "slow",
    "ssl",
    "4xx",
    "5xx",
    "asset",
  ]),
  scope: z.enum(["both", "internal", "external"]),
  sort: z.enum(["url", "code", "time", "checkedAt"]),
  direction: z.enum(["asc", "desc"]),
});
