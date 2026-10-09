import { writeFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { DatabaseService } from "../database/DatabaseService";
import { broken } from "./ScanService";
import type { UrlResult } from "../../../shared/types";
const safeCell = (value: unknown): string => {
  const s = value == null ? "" : String(value);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};
const escape = (s: unknown): string =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const headers = [
  "Name",
  "URL",
  "Status",
  "HTTP code",
  "Response ms",
  "Final URL",
  "Redirects",
  "SSL valid",
  "Error",
  "Checked at",
  "DNS ms",
  "TCP ms",
  "TLS ms",
  "TTFB ms",
  "Download ms",
  "Attempts",
];
const values = (r: UrlResult): unknown[] => [
  r.name ?? "",
  r.url,
  r.label,
  r.code,
  r.timings.total,
  r.finalUrl,
  r.redirects.length,
  r.ssl?.valid ?? null,
  r.errorCode,
  r.checkedAt,
  r.timings.dns,
  r.timings.tcp,
  r.timings.tls,
  r.timings.ttfb,
  r.timings.download,
  r.attempts,
];
export class ExportService {
  constructor(private db: DatabaseService) {}
  async write(
    scanId: string,
    format: "csv" | "xlsx" | "json" | "html",
    file: string,
  ): Promise<void> {
    const results = this.db.allResults(scanId);
    const summary = this.db.dashboard(scanId);
    const sources = this.db.sources(scanId);
    const exportHeaders = headers;
    const exportValues = values;
    if (format === "json") {
      await writeFile(
        file,
        JSON.stringify({ version: 1, summary, results, sources }, null, 2),
      );
      return;
    }
    if (format === "csv") {
      await writeFile(
        file,
        "\ufeff" +
          [exportHeaders, ...results.map(exportValues)]
            .map((row) =>
              row.map((v) => `"${safeCell(v).replace(/"/g, '""')}"`).join(","),
            )
            .join("\r\n"),
      );
      return;
    }
    if (format === "xlsx") {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "URL Checker Pro";
      const summarySheet = workbook.addWorksheet("Summary");
      summarySheet.addRow(["Metric", "Value"]);
      Object.entries(summary.counts).forEach(([k, v]) =>
        summarySheet.addRow([k, v]),
      );
      summarySheet.addRow(["Average response ms", summary.average]);
      const sheets: [string, UrlResult[]][] = [
        ["All URLs", results],
        ["Broken URLs", results.filter(broken)],
        ["Redirects", results.filter((r) => r.redirects.length)],
        [
          "Slow URLs",
          results.filter((r) => ["slow", "very slow"].includes(r.performance)),
        ],
        [
          "SSL Issues",
          results.filter(
            (r) =>
              r.category === "ssl" ||
              (r.ssl && (!r.ssl.valid || r.ssl.daysRemaining < 30)),
          ),
        ],
      ];
      for (const [name, rows] of sheets) {
        const sheet = workbook.addWorksheet(name);
        sheet.addRow(exportHeaders);
        rows.forEach((r) =>
          sheet.addRow(
            exportValues(r).map((v) =>
              typeof v === "string" ? safeCell(v) : v,
            ),
          ),
        );
        sheet.views = [{ state: "frozen", ySplit: 1 }];
        sheet.autoFilter = { from: "A1", to: "P1" };
      }
      const sourceSheet = workbook.addWorksheet("Source Pages");
      sourceSheet.addRow([
        "Source",
        "Target",
        "Normalized target",
        "Element",
        "Anchor",
        "Scope",
        "Asset",
      ]);
      sources.forEach((l) =>
        sourceSheet.addRow(
          [
            l.source,
            l.target,
            l.normalizedTarget,
            l.element,
            l.anchor,
            l.scope,
            String(l.asset),
          ].map(safeCell),
        ),
      );
      workbook.eachSheet((sheet) => {
        sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
        sheet.getRow(1).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF154E45" },
        };
        sheet.columns.forEach((column) => {
          column.width = 26;
        });
      });
      await workbook.xlsx.writeFile(file);
      return;
    }
    const sourceMap = new Map<string, string[]>();
    for (const s of sources) {
      const list = sourceMap.get(s.normalizedTarget) ?? [];
      list.push(`${s.source} · <${s.element}> · ${s.anchor}`);
      sourceMap.set(s.normalizedTarget, list);
    }
    await writeFile(
      file,
      `<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>URL Checker Pro report</title><style>body{font:14px system-ui;margin:40px;color:#172a2b}table{border-collapse:collapse;width:100%}td,th{padding:12px;border-bottom:1px solid #ddd;text-align:left;word-break:break-all}h1{color:#154e45}th{background:#edf4f2}</style><h1>URL Checker Pro · Scan report</h1><p>${escape(new Date().toISOString())} · ${results.length} URLs · ${summary.counts.broken ?? 0} broken · Average ${Math.round(summary.average ?? 0)} ms</p><table><thead><tr>${["Name", "URL", "Status", "HTTP", "Time", "Error", "Source pages"].map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${results.map((r) => `<tr><td>${escape(r.name)}</td><td>${escape(r.url)}</td><td>${escape(r.label)}</td><td>${escape(r.code)}</td><td>${r.timings.total} ms</td><td>${escape(r.errorCode)}</td><td>${(sourceMap.get(r.url) ?? []).map(escape).join("<br>")}</td></tr>`).join("")}</tbody></table></html>`,
    );
  }
}
