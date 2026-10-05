import type { Settings } from "../../../shared/types";
import { normalizeUrl } from "./url";

export function protocolUrls(
  raw: string,
  mode: Settings["protocol"],
): string[] {
  try {
    const url = new URL(normalizeUrl(raw));
    if (!mode || mode === "auto") return [raw];
    const schemes = mode === "both" ? ["https:", "http:"] : [mode + ":"];
    return schemes.map((scheme) => {
      const copy = new URL(url);
      copy.protocol = scheme;
      return copy.href;
    });
  } catch {
    return [raw];
  }
}
