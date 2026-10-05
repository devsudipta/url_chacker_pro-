import {
  test,
  expect,
  _electron as electron,
  chromium,
} from "@playwright/test";
import http from "node:http";
import path from "node:path";
import { mkdir, copyFile, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
test.setTimeout(process.env.URLCHECKER_TEST_EXE ? 180000 : 60000);

test("real desktop: scan, detail, themes, persistence and preload isolation", async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/missing") {
      res.writeHead(404);
      res.end("missing");
      return;
    }
    if (req.url === "/redirect") {
      res.writeHead(301, { Location: "/ok" });
      res.end();
      return;
    }
    res.end("ok");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const storage = path.resolve("test-artifacts", `desktop-${Date.now()}`);
  await mkdir(storage, { recursive: true });
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  env.URLCHECKER_DATA_DIR = storage;
  delete env.ELECTRON_RUN_AS_NODE;
  const executable = process.env.URLCHECKER_TEST_EXE;
  const portable = executable?.includes("Portable")
    ? path.join(storage, path.basename(executable))
    : null;
  if (portable && executable) await copyFile(executable, portable);
  const launch = async () => {
    if (portable) {
      const portFile = path.join(
        storage,
        "URLChecker-data",
        "DevToolsActivePort",
      );
      await rm(portFile, { force: true });
      const child = spawn(portable, ["--remote-debugging-port=0"], {
        env,
        windowsHide: true,
        stdio: "ignore",
      });
      let port = "",
        launchError: Error | null = null;
      child.on("error", (error) => {
        launchError = error;
      });
      const deadline = Date.now() + 90000;
      while (!port) {
        if (launchError) throw launchError;
        if (child.exitCode !== null)
          throw new Error(`Portable launcher exited ${child.exitCode}`);
        if (Date.now() > deadline) {
          child.kill();
          throw new Error("Portable debugger port was not created");
        }
        try {
          port = (await readFile(portFile, "utf8")).split(/\r?\n/)[0];
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      await expect
        .poll(() => browser.contexts()[0]?.pages().length ?? 0)
        .toBeGreaterThan(0);
      const page = browser.contexts()[0].pages()[0];
      return {
        firstWindow: async () => page,
        close: async () => {
          await page.evaluate(() => window.close()).catch(() => undefined);
          if (child.exitCode === null)
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(() => {
                child.kill();
                reject(new Error("Portable did not exit after window close"));
              }, 15000);
              child.once("exit", () => {
                clearTimeout(timer);
                resolve();
              });
            });
          await browser.close();
        },
      };
    }
    return electron.launch({
      timeout: 60000,
      ...(executable
        ? { executablePath: executable, args: [] }
        : { args: ["."] }),
      env,
    });
  };
  let application = await launch();
  try {
    let page = await application.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await expect(
      page.getByRole("heading", { name: "Dashboard", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => ({
        require: typeof (window as unknown as { require: unknown }).require,
        node: typeof (window as unknown as { process: unknown }).process,
      })),
    ).toEqual({ require: "undefined", node: "undefined" });
    await page.getByRole("button", { name: "Quick Scan", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "API Checker", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator(".workspace-footer")).toContainText(
      "Developed by Sudipta Roy Akash",
    );
    await expect(page.locator(".workspace-footer")).toContainText("1.0.2");
    await expect(page.getByLabel("URL protocol")).toHaveValue("auto");
    await page.getByLabel("URL protocol").selectOption("both");
    await page.getByLabel("URL protocol").selectOption("auto");
    await page
      .getByPlaceholder("Optional name for this scan")
      .fill("Desktop verification");
    await page
      .getByRole("textbox", { name: "URLs to check" })
      .fill(
        `${base}/ok\n${base}/missing\n${base}/redirect\n${base}/ok#duplicate\nfile:///invalid`,
      );
    await expect(page.getByText("1 duplicates")).toBeVisible();
    await page.getByRole("button", { name: "Start scan" }).click();
    await expect(page.getByText(/4 checked · completed/)).toBeVisible({
      timeout: 20000,
    });
    await expect(page.locator("tbody tr")).toHaveCount(4);
    await page.locator("tbody tr").filter({ hasText: "HTTP_404" }).click();
    await expect(
      page.getByRole("heading", { name: "Error details" }),
    ).toBeVisible();
    await expect(
      page.locator(".detail-drawer").getByText("HTTP_404", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close details" }).click();
    await page
      .getByRole("button", { name: "Broken Links", exact: true })
      .click();
    await expect(page.locator("tbody tr")).toHaveCount(2);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByText("Email: hello@sudiptaroy.dev")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "devsudipta", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Theme", { exact: true }).selectOption("dark");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Settings saved")).toBeVisible();
    await page.getByRole("button", { name: "Dashboard", exact: true }).click();
    await page.screenshot({
      path: "test-artifacts/desktop-dark.png",
      fullPage: true,
    });
    await application.close();
    application = await launch();
    page = await application.firstWindow();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page
      .getByRole("button", { name: "URL Results", exact: true })
      .click();
    await expect(page.locator("tbody tr")).toHaveCount(4);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByLabel("Theme", { exact: true }).selectOption("light");
    await page.getByRole("button", { name: "Save settings" }).click();
    await page.getByRole("button", { name: "Dashboard", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.screenshot({
      path: "test-artifacts/desktop-light.png",
      fullPage: true,
    });
    expect(errors).toEqual([]);
  } finally {
    await application.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
