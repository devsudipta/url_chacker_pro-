import { load } from "cheerio";
import type { SourceLink } from "../../../shared/types";
import { isInternal, normalizeUrl } from "../utilities/url";
export function discoverLinks(
  html: string,
  source: string,
  base: string,
  assets: boolean,
): SourceLink[] {
  const $ = load(html);
  const links: SourceLink[] = [];
  const seen = new Set<string>();
  let resolveBase = source;
  try {
    const declared = $("base[href]").first().attr("href");
    if (declared) resolveBase = normalizeUrl(declared, source);
  } catch {
    /* Ignore invalid document base. */
  }
  $(
    assets ? "a[href],img[src],script[src],link[href],iframe[src]" : "a[href]",
  ).each((_index, node) => {
    const element = node.tagName;
    const target = $(node).attr(
      element === "a" || element === "link" ? "href" : "src",
    );
    if (
      !target ||
      /^(mailto:|tel:|javascript:|data:|file:)/i.test(target.trim())
    )
      return;
    try {
      const normalizedTarget = normalizeUrl(target, resolveBase);
      const anchor = $(node).text().trim().slice(0, 500);
      const key = `${target}\0${element}\0${anchor}`;
      if (seen.has(key)) return;
      seen.add(key);
      links.push({
        source,
        target,
        normalizedTarget,
        element,
        anchor,
        scope: isInternal(normalizedTarget, base) ? "internal" : "external",
        asset: element !== "a",
      });
    } catch {
      /* Non-HTTP links cannot be probed. */
    }
  });
  return links;
}
