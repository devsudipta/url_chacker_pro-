import { app, BrowserWindow, ipcMain, dialog, shell, session } from "electron";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { DatabaseService } from "./database/DatabaseService";
import { ScanService } from "./services/ScanService";
import { importPaths } from "./services/ImportService";
import { ExportService } from "./services/ExportService";
import { summarize, normalizeUrl } from "./utilities/url";
import {
  idSchema,
  settingsSchema,
  textSchema,
  querySchema,
} from "./utilities/validation";
import { logger } from "./utilities/log";

app.setAppUserModelId("dev.sudiptaroy.urlchecker");
if (process.env.URLCHECKER_DATA_DIR)
  app.setPath("userData", path.resolve(process.env.URLCHECKER_DATA_DIR));
if (process.env.PORTABLE_EXECUTABLE_DIR)
  app.setPath(
    "userData",
    path.join(process.env.PORTABLE_EXECUTABLE_DIR, "URLChecker-data"),
  );
let window: BrowserWindow | null = null;
let db: DatabaseService;
let scanner: ScanService;
let quitting = false;
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
app.on("second-instance", () => {
  if (window?.isMinimized()) window.restore();
  window?.focus();
});
const rendererFile = path.join(__dirname, "../renderer/index.html");
const trusted =
  process.env.ELECTRON_RENDERER_URL || pathToFileURL(rendererFile).href;
app
  .whenReady()
  .then(() => {
    if (!ownsInstance) return;
    mkdirSync(app.getPath("userData"), { recursive: true });
    const log = logger(path.join(app.getPath("userData"), "application.log"));
    db = new DatabaseService(
      path.join(app.getPath("userData"), "url-checker.db"),
    );
    scanner = new ScanService(
      db,
      (progress) => window?.webContents.send("scan:progress", progress),
      log,
    );
    const exporter = new ExportService(db);
    session.defaultSession.setPermissionRequestHandler(
      (_webContents, _permission, callback) => callback(false),
    );
    const handle = (
      channel: string,
      action: (...args: unknown[]) => unknown,
    ): void => {
      ipcMain.handle(channel, async (event, ...args: unknown[]) => {
        if (
          !window ||
          event.sender !== window.webContents ||
          event.senderFrame?.url !== trusted
        )
          throw new Error("Untrusted IPC sender");
        try {
          return await action(...args);
        } catch (error) {
          log(error);
          throw error;
        }
      });
    };
    handle("settings:get", () => ({
      settings: db.settings(),
      location: db.location,
    }));
    handle("settings:save", (input) =>
      db.saveSettings(settingsSchema.parse(input)),
    );
    handle("import:preview", (input) =>
      summarize(textSchema.parse(input).split(/\r?\n/)),
    );
    handle("import:files", async () => {
      const result = await dialog.showOpenDialog(window!, {
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "URL lists", extensions: ["txt", "csv", "xlsx"] }],
      });
      return result.canceled ? null : importPaths(result.filePaths);
    });
    handle("import:drop", (input) =>
      importPaths(z.array(z.string().max(32768)).max(20).parse(input)),
    );
    handle("scan:start", (input) => {
      const v = z
        .object({
          name: z.string().max(200),
          mode: z.enum(["quick", "crawl"]),
          text: textSchema,
          settings: settingsSchema,
        })
        .parse(input);
      if (v.text.split(/\r?\n/).length > 100000)
        throw new Error("Limit: 100,000 URLs");
      return scanner.start(v.name, v.mode, v.text, v.settings);
    });
    handle("scan:control", (input) =>
      scanner.control(z.enum(["pause", "resume", "stop"]).parse(input)),
    );
    handle("scan:history", () => db.history());
    handle("scan:results", (input) => db.results(querySchema.parse(input)));
    handle("scan:detail", (input) => db.detail(idSchema.parse(input)));
    handle("scan:dashboard", (input) => db.dashboard(idSchema.parse(input)));
    handle("scan:delete", (input) => {
      const id = idSchema.parse(input);
      if (
        scanner.current?.id === id &&
        ["running", "paused"].includes(scanner.current.status)
      )
        throw new Error("Stop the active scan before deleting it");
      db.deleteScan(id);
    });
    handle("scan:compare", (a, b) =>
      db.compare(idSchema.parse(a), idSchema.parse(b)),
    );
    handle("scan:export", async (input, format) => {
      const id = idSchema.parse(input),
        ext = z.enum(["csv", "xlsx", "json", "html"]).parse(format);
      const target = await dialog.showSaveDialog(window!, {
        defaultPath: `URLChecker-report.${ext}`,
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
      });
      if (target.canceled || !target.filePath) return null;
      await exporter.write(id, ext, target.filePath);
      return target.filePath;
    });
    handle("url:open", (input) =>
      shell.openExternal(normalizeUrl(z.string().max(10000).parse(input))),
    );
    window = new BrowserWindow({
      width: 1440,
      height: 940,
      minWidth: 1000,
      minHeight: 680,
      title: "URL Checker Pro",
      backgroundColor: "#101718",
      icon: path.join(__dirname, "../../resources/icon.ico"),
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, url) => {
      if (url !== trusted) event.preventDefault();
    });
    if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(trusted);
    else void window.loadFile(rendererFile);
    window.on("closed", () => {
      window = null;
    });
    process.on("uncaughtException", log);
    process.on("unhandledRejection", log);
  })
  .catch((error) => {
    console.error(error);
    app.quit();
  });
app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if (quitting || !scanner) return;
  event.preventDefault();
  quitting = true;
  void scanner.shutdown().finally(() => {
    db.close();
    app.quit();
  });
});
