import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { summarize } from "../utilities/url";
import type { ImportSummary } from "../../../shared/types";
export async function importPaths(paths: string[]): Promise<ImportSummary> {
  const values: string[] = [];
  if (paths.length > 20) throw new Error("Import at most 20 files at once");
  for (const file of paths) {
    if ((await stat(file)).size > 20 * 1024 * 1024)
      throw new Error("Import file exceeds 20 MB");
    const extension = path.extname(file).toLowerCase();
    if (extension === ".xlsx") {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(file);
      workbook.eachSheet((sheet) => {
        if (readNamedSheet(sheet, values)) return;
        sheet.eachRow((row) =>
          row.eachCell((cell) => {
            const value = cell.value;
            const text =
              value && typeof value === "object" && "hyperlink" in value
                ? value.hyperlink
                : cell.text;
            if (text && /^(https?:\/\/|www\.)/i.test(text.trim()))
              values.push(text);
          }),
        );
      });
    } else if (extension === ".csv") {
      const workbook = new ExcelJS.Workbook();
      const sheet = await workbook.csv.readFile(file);
      if (readNamedSheet(sheet, values)) continue;
      // A one-column file may contain scheme-less URLs or invalid entries.
      if (sheet.columnCount === 1) {
        sheet.eachRow((row, index) => {
          const text = row.getCell(1).text.trim();
          if (index === 1 && /^(url|urls|website)$/i.test(text)) return;
          values.push(text);
        });
      } else
        sheet.eachRow((row) =>
          row.eachCell((cell) => {
            const text = cell.text.trim();
            if (/^(https?:\/\/|www\.)/i.test(text)) values.push(text);
          }),
        );
    } else if (extension === ".txt")
      values.push(...(await readFile(file, "utf8")).split(/\r?\n/));
    else throw new Error("Supported files: TXT, CSV and XLSX");
    if (values.length > 100000) throw new Error("Import limit is 100,000 URLs");
  }
  return summarize(values);
}
function readNamedSheet(sheet: ExcelJS.Worksheet, values: string[]): boolean {
  let nameColumn = 0,
    urlColumn = 0;
  sheet.getRow(1).eachCell((cell, index) => {
    const heading = cell.text.trim().toLowerCase();
    if (heading === "name") nameColumn = index;
    if (["url", "urls", "website"].includes(heading)) urlColumn = index;
  });
  if (!nameColumn || !urlColumn) return false;
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    const value = row.getCell(urlColumn).value;
    const url =
      value && typeof value === "object" && "hyperlink" in value
        ? value.hyperlink
        : row.getCell(urlColumn).text.trim();
    if (!url) return;
    const name = row.getCell(nameColumn).text.trim().slice(0, 200);
    values.push(name ? `${name} | ${url}` : url);
    if (values.length > 100000) throw new Error("Import limit is 100,000 URLs");
  });
  return true;
}
