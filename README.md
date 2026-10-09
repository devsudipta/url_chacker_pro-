# URL Checker Pro

**Version 1.2.0 · Windows 10/11 x64 · Developed by Sudipta Roy Akash**

## Download and install

- [Download the 1.2.0 Windows installer](https://github.com/devsudipta/url_chacker_pro-/releases/download/v1.2.0/URLChecker-Setup-1.2.0.exe) — installation with desktop/Start Menu shortcuts and an uninstaller.
- [Download the 1.2.0 portable executable](https://github.com/devsudipta/url_chacker_pro-/releases/download/v1.2.0/URLChecker-Portable-1.2.0.exe) — run from a writable folder without installing.
- [All versions and release notes](https://github.com/devsudipta/url_chacker_pro-/releases) · [Fixes and changelog](CHANGELOG.md)

These development builds do not have a publisher signing certificate. Node.js is required for source development, not for running the downloaded application.

Launch the app, open **Quick Scan**, add a Name and URL (or paste URLs), and select a protocol. **Automatic** keeps the entered scheme and tries HTTP if HTTPS fails without a response. **Both** checks HTTP and HTTPS separately. After the scan, select a recheck interval and click **Start monitoring** to track live status and save outage/recovery times. Use **Show outage history** and **Export monitoring JSON** for the saved record.

## Developer

Sudipta Roy Akash · [sudiptaroy.dev](https://sudiptaroy.dev) · [GitHub: devsudipta](https://github.com/devsudipta) · hello@sudiptaroy.dev

## About

A local Windows x64 desktop application for bulk URL diagnostics, website crawling and scan reporting. Electron runs the networking engine and SQLite database; a sandboxed React renderer uses a narrow, validated preload API. There is no remote backend, account or telemetry service.

## Requirements and setup

Windows 10/11 x64, Node.js 24 LTS and npm. Build dependencies need internet access on first installation; the installed application needs internet access only for the addresses you ask it to check. Local HTTP services can be scanned offline.

```powershell
git clone https://github.com/devsudipta/url_chacker_pro-.git
cd url_chacker_pro-
npm install
npm run dev
```

If a terminal inherited `ELECTRON_RUN_AS_NODE=1`, remove it for that terminal before launching Electron:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm run dev
```

If your npm environment is forced into offline mode, use `npm install --offline=false`. If Electron's package exists but its executable was not downloaded, run `node node_modules/electron/install.js`, then retry development.

## Features

- Paste up to 100,000 URLs or import/drop TXT, CSV or XLSX files. Validation and fragment deduplication show an import summary. Invalid pasted entries become diagnostic results.
- Controlled asynchronous workers, per-host concurrency and delay, pause/resume/stop, absolute per-request timeouts and selected transient retries with exponential backoff and `Retry-After` support capped at 60 seconds.
- GET probes preserve actual HTTP codes and meaningful DNS, connection, TLS, timeout and redirect errors. 401/403 are reachable but blocked; 429 is rate limited. Redirect history includes each source, destination and response code.
- Measured DNS, TCP, TLS, TTFB, body and total time. Missing timings are null. IP-address requests do not invent DNS lookup timing. Total time includes the redirects of the final attempt; phase timings refer to its last response. Queue waits, pauses and retry waiting are excluded from response time.
- Website crawling with depth 0, 1, 2, 3, higher/custom depth in Settings, full site (`-1`), maximum URL count, robots policy, and optional image/CSS/JS/iframe/font preload checks. Discovered external targets are checked but not expanded. Source references retain original link attributes, element, anchor, source page and internal/external classification.
- TLS certificate subject, issuer, validity dates, hostname validity and expiry warnings when the socket provides metadata. Certificate failures remain separate from HTTP reachability.
- Database-backed searchable/sortable/filterable results with 100-row pages, details drawer, copy/open actions, source locations, history, scan deletion and interrupted-scan recovery.
- Dashboard, dark/light/system themes, persistent preferences, CSV/XLSX/JSON/standalone HTML exports, and comparison of two scans in the same project.
- Assisted NSIS installation, configurable installation directory, Start Menu/Desktop shortcuts, normal uninstall registration and optional portable build.

## Architecture and compatibility

Verified toolchain: Electron 44.5.1, Node 24.21.0 on the development host, React 19.3, Vite 7.3.6, electron-vite 5, TypeScript 5.9, Tailwind 4 and electron-builder 26.15.3. Vite 7 is intentional: electron-vite 5's peer range currently supports Vite 5â€“7. `package-lock.json` records the complete dependency tree. There are no separate native Node addons to rebuild.

SQLite uses **Electron's bundled `node:sqlite`** rather than better-sqlite3. The initial addon build could not find Python/MSVC and warned about the workspace path containing spaces. Using bundled SQLite avoids ABI mismatches and those build prerequisites while keeping ordinary SQLite files. The Node 24 SQLite API is still marked experimental; this dependency choice should be reviewed when upgrading Electron. Database calls occur only in the main process, use prepared statements, transactions, WAL, indexes and versioned migrations. Timings and extensible result metadata are stored in JSON alongside indexed SQL fields; redirects, source links and certificates have separate relational tables.

The HTTP engine uses Node HTTP/HTTPS lifecycle events. It never runs in React. A bounded queue controls asynchronous requests and throttles progress events to about three per second. React queries one page rather than storing the entire scan dataset. Exports and large imports run asynchronously in main; workbook parsing and SQLite work can still block main briefly for very large datasets. A worker process for heavy imports/exports is a future scalability improvement.

Electron enables context isolation, sandboxing and disables Node integration. IPC schemas validate settings, IDs and queries; requests must originate in the application main frame. Navigation, new windows and permissions are denied. Only HTTP/HTTPS scanning and external opening are supported, including redirect destinations. Remote HTML is parsed for links, never mounted in the renderer. React escapes displayed values. HTML exports escape data and prohibit scripts; CSV/XLSX text protects against spreadsheet formula injection.

HTTP and HTTPS, www/non-www, query order, and non-root trailing slashes are **not merged**: these can identify different resources. The URL parser lowercases hostnames, resolves relative paths, removes default ports and strips fragments. Internal links mean the same hostname (subdomains remain external); scheme and port do not change this classification. Crawls check external links and assets but expand only internal HTML pages. The maximum count includes pages, external URLs and assets. Depth is a discovery depth; HTML at the depth boundary is checked without expanding more links. Robots paths disallowed for this User-Agent are visibly skipped. Missing robots files (404/410) allow crawling; other retrieval failures skip that origin rather than silently allowing it. Redirect targets also pass robots checks.

Direct dependencies are supported releases. ExcelJS and electron-builder retain some deprecated transitive packages; the app does not import these directly. An ExcelJS-scoped UUID 11 override fixes the known advisory while retaining its CommonJS-compatible API. The dependency audit was clean when verified; run `npm audit` as part of future releases.

## Development and verification

```powershell
npm run typecheck
npm run lint
npm run test
npm run test:desktop
npm run build
```

Unit/integration tests start a deterministic loopback HTTP server: success, 404, 403, retries, redirect chains/loops, unsafe redirects, timeout, queue control, crawl depth/limits/robots, source references, imports, exports, SQLite recovery and persistence. Desktop tests launch the actual Electron application, check renderer isolation, scan a local test service, reopen results and verify theme persistence. Test profiles/screenshots are under `test-artifacts/` and are separate from normal application data.

`npm run format` formats source. `node scripts/generate-icon.mjs` regenerates the application icon from code.

After creating a portable build, test that actual executable with:

```powershell
$env:URLCHECKER_TEST_EXE = Join-Path (Get-Location) 'dist\URLChecker-Portable-1.2.0.exe'
npx playwright test
Remove-Item Env:URLCHECKER_TEST_EXE
```

The same environment variable can target an installed executable. Portable tests copy the binary into an isolated folder and verify its adjacent database across two launches. No test debugging switches are enabled in ordinary user launches.

## Windows installer and portable executable

```powershell
npm run dist:win
# dist\URLChecker-Setup-1.2.0.exe

npm run dist:portable
# dist\URLChecker-Portable-1.2.0.exe
```

Do not run two distribution/build commands concurrently: both use `out/` and `dist/win-unpacked/`. First builds download Electron/NSIS tools. The installer is assisted (`oneClick: false`), per-user by default and allows a custom installation directory. It registers in Installed Apps and supplies an uninstaller. Keep the stable application ID `dev.sudiptaroy.urlchecker` across releases. Publisher metadata names Sudipta Roy Akash.

Portable builds need no installer. Their writable `URLChecker-data` directory is beside the portable executable. Use a writable folder rather than Program Files. Normal installed/development data is `%APPDATA%\url-checker-pro\url-checker.db`; the Settings screen shows the actual path. `URLCHECKER_DATA_DIR` optionally overrides the storage directory for development/testing; portable mode takes precedence. Logs rotate at 2 MB, retaining one previous file. Uninstall normally removes program files and shortcuts; saved application data may remain for later reinstall.

## Code signing

Development builds do not need a signing certificate. Unsigned binaries may show SmartScreen/Unknown Publisher warnings. No certificates or passwords are checked in. Electron-builder supports later signing through its environment variables:

```powershell
$env:CSC_LINK = "C:\secure\publisher.pfx"
$env:CSC_KEY_PASSWORD = "<set securely in your build environment>"
npm run dist:win
```

Keep signing secrets out of source control and logs. Do not disable Windows security to test an unsigned build.

## Project structure

```text
shared/                 Data contracts and defaults
src/main/database/      SQLite migrations, queries, transactions
src/main/services/      HTTP, crawler, queue, scans, import/export
src/main/utilities/     URL normalization, IPC schemas, bounded logs
src/main/index.ts       Electron window, IPC registration, shutdown
src/preload/            Explicit contextBridge API
src/renderer/           React UI, table, details, dashboard and themes
resources/              Windows ICO and PNG application icons
scripts/                Reproducible icon generation
tests/                  Local-server integration and Electron E2E tests
out/                    Compiled application
dist/                   Installer, portable and unpacked builds
```

## Version 1.2.0

### Names and automatic rechecks

In Quick Scan, enter a **Name** before the **URL** and click **Add URL**. You can also paste `Main website | https://example.com`, one entry per line, or import CSV/XLSX with `Name` and `URL` column headers. Names appear before URLs in results and reports and are searchable.

After the scan finishes, use **Auto refresh & outage history** on URL Results. Choose 5, 10, 20 or 30 seconds, or 1, 2, 5 or 10 minutes, then click **Start monitoring**. Each cycle rechecks the URLs; the delay starts after a completed cycle so requests never overlap. **Apply interval** changes the delay without resetting an outage. Stop monitoring to end the session.

The live table updates automatically and every check is stored in SQLite. HTTP 2xx/3xx without a network/redirect error counts as online; other results count as offline. **Show outage history** displays when failure was detected, when recovery was detected, and the observed offline duration. **Export monitoring JSON** saves all check records and outage history. Names, ports, query strings and existing HTTP/HTTPS selection are preserved.

Monitoring continues across page navigation while the app is running. Closing the app stops monitoring; saved records remain after reopening. Monitoring does not run as a Windows background service and does not restart automatically. Outages with no observed recovery show an unknown final duration when monitoring ends. Detection times are approximate check times; availability between checks is not measured. Monitoring history can grow with frequent checks; deleting its parent scan removes those records.

The live monitoring table shows current status; the original scan table and scan reports remain the original scan snapshot. The history view shows the newest 1,000 outages; monitoring JSON includes all periods and checks.

API Checker has been removed. Scan configuration offers Automatic, HTTPS only, HTTP only and Both. Automatic preserves the entered scheme (HTTPS for scheme-less URLs) and tries HTTP when HTTPS fails without an HTTP response. Both saves separate results for each scheme. Paths and queries are preserved; TLS verification stays enabled. Automatic fallback uses unencrypted HTTP; choose HTTPS only when required.

Developed by Sudipta Roy Akash. Website: https://sudiptaroy.dev Â· GitHub: https://github.com/devsudipta Â· Email: hello@sudiptaroy.dev.

## Limits and troubleshooting

- Static HTML crawler: no browser execution, JavaScript-generated links, authenticated sessions, CSS `url()`/font traversal or sitemap crawling. Fonts linked using HTML `<link>` are checked. Fragments are deduplicated; fragment target existence is not checked.
- GET bodies are limited to 10 MB to bound worker memory. Larger resources become `BODY_TOO_LARGE` diagnostic results. `Accept-Encoding: identity` is requested. Sites that insist on compressed or non-UTF-8 HTML may not yield useful crawl links yet.
- Retries re-probe the complete redirect chain. Robots policies are cached per origin during a scan. Longest crawl discovery paths may win when concurrent pages discover the same URL at different depths; strict breadth-first depth optimization is a future improvement.
- Full source references for links beyond the URL limit are saved, but these targets remain unchecked. Progress counts discovered/enqueued URLs, not every occurrence of a link.
- Scans interrupted by an application/PC crash remain readable, but pending work is not resumed automatically. Start another scan to recheck a list/site. Only one scan can run at a time.
- Some TLS errors prevent Node from exposing certificate details. Validation remains enabled; the application never disables certificate verification to collect metadata.
- Imports are limited to 20 files and 20 MB per file. Multi-column CSV and XLSX select explicit `http(s)`/`www` cells and Excel hyperlinks; scheme-less entries work in paste, TXT and one-column CSV. Header rows named URL/URLs/Website are skipped in one-column CSV.
- Comparison displays at most 1,000 changed rows. Exports cover the whole selected scan rather than just the current table filter. XLSX includes a Source Pages sheet; JSON preserves complete chains/certificates. CSV has one row per resource, without repeated source records.
- Large scans, workbook imports and exports need further performance benchmarking before broad production deployment. PDF, multilingual UI and automatic updates are not implemented.
- Application startup failures are recorded in the local log when storage is available. A locked/read-only data directory or insufficient disk space must be resolved before scanning.

See `VERIFICATION.md` for the actual checks performed and any unverified installation interactions.
