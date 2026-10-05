import type { ImportSummary } from "../../../shared/types";
export function normalizeUrl(input: string, base?: string): string {
  let value = input.trim();
  if (!value || [...value].some((char) => char.charCodeAt(0) <= 32))
    throw new Error("URL is empty or contains whitespace");
  if (!base && !/^[a-z][a-z\d+.-]*:/i.test(value)) value = `https://${value}`;
  const url = new URL(value, base);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("Only HTTP and HTTPS URLs are allowed");
  if (!url.hostname || url.username || url.password)
    throw new Error(
      "A hostname is required; URL credentials are not supported",
    );
  url.hash = "";
  return url.href;
}
export function summarize(values: string[]): ImportSummary {
  const urls: string[] = [],
    invalid: string[] = [],
    seen = new Set<string>();
  let duplicates = 0;
  for (const raw of values.map((v) => v.trim()).filter(Boolean)) {
    try {
      const url = normalizeUrl(raw);
      if (seen.has(url)) duplicates++;
      else {
        seen.add(url);
        urls.push(url);
      }
    } catch {
      invalid.push(raw);
    }
  }
  return {
    urls,
    invalid,
    duplicates,
    imported: urls.length + invalid.length + duplicates,
  };
}
export const isInternal = (target: string, base: string): boolean =>
  new URL(target).hostname === new URL(base).hostname;
