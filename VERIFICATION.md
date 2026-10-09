# Verification record

Verified on Windows x64 on October 5, 2026. This record distinguishes implemented/automated checks from manual release checks.

## Version 1.2.5 — October 9, 2026

Type checking, lint, production build and all 26 integration tests passed. Coverage includes HTTP 200/500, GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS, exact duplicate/empty queries, gzip JSON, expected text/JSON/status/time failures, DNS failures, refused/reset connections, connection/TLS/response timeouts, trusted/untrusted/expired/mismatched certificates, isolated insecure diagnostics (including failed redirected TLS destinations), retries/replay restrictions, private-host/metadata restrictions and encrypted configuration persistence.

A populated version 1.2.0 database upgrade test preserves scans, named endpoints, original queries, preferences, existing monitoring checks and exact outage durations. Prior history is not reclassified or rewritten. TLS-only failures remain unknown application health and do not open false outages or invent recovery.

The real compiled Electron desktop test passed across three launches, including endpoint method/timeouts/status configuration, encrypted API-header storage with redacted previews, application/network/TLS indicators, original scanner features, outage/recovery, interval changes and persisted history. The monitoring screenshot is test-artifacts/monitoring-1.2.5.png; its layout was visually inspected.

Both Windows builds succeeded. The actual URLChecker-Portable-1.2.5.exe passed the same desktop test across three launches in approximately 90 seconds. Packaged Windows metadata reports version 1.2.5, company Sudipta Roy Akash.

- Installer: dist/URLChecker-Setup-1.2.5.exe, 116,997,423 bytes. SHA-256: A9CCF4F7691B10A9C97EC6B8095FCB0103BA7CC2C5D11C619F27EEF869CE774A.
- Portable: dist/URLChecker-Portable-1.2.5.exe, 103,150,491 bytes. SHA-256: F58A05854DC77AB62060391AEC013F0A9A0D6C5722E913538B0DCADB3A4AF7C5.

The supplied production PHP endpoint was not contacted; equivalent local HTTP/TLS servers validate its reported diagnostic pattern. Installer wizard/install/uninstall interactions were not repeated for this version. Builds remain unsigned. JSON matching is UTF-8 and serialization-based; object property order matters. Existing URL queries remain sensitive local database data. Full implementation and security limits are documented in MONITORING.md.

## Version 1.2.0 — October 9, 2026

Type checking, lint and production build passed. All 19 integration tests passed: the original scanner/protocol coverage plus named URL/import/export/search tests, additive SQLite migration and outage transition/persistence tests, and a real repeating HTTP monitor test with failure, recovery, interval changes and cancellation.

The real Electron desktop test passed across three launches. It exercised the Name/URL form, names before URLs, 5/10-second interval selection, real 503 offline detection, recovery and saved duration, interval changes without losing the outage, stopping and restored history. The monitoring screenshot is `test-artifacts/monitoring-1.2.0.png`.

Monitoring records observed times rather than the unmeasured instant a remote endpoint changes. Closing/stopping interrupts observation without inventing recovery. Sessions are not automatically resumed after reopening. Original scan snapshots remain unchanged; monitoring stores every check and exports separate complete JSON history.

Both Windows distribution builds succeeded. Packaged metadata reports `1.2.0.0`, company `Sudipta Roy Akash`. Installer wizard/install/uninstall interactions were not repeated for this version.

The actual `URLChecker-Portable-1.2.0.exe` passed the complete desktop test across three launches, including named entry, offline/recovery records, interval changes, cancellation, original scanner functionality, themes and persisted outage durations.

- Installer: `dist/URLChecker-Setup-1.2.0.exe`, 116,990,852 bytes. SHA-256: `7E555B24BF06FFFA29C8B296E57F1AAAC887D6ADA0056103718A511868587BB8`.
- Portable: `dist/URLChecker-Portable-1.2.0.exe`, 103,146,078 bytes. SHA-256: `3D7DC81BFF82A320A9553AC667DCB3D08F362DCBE3FA2A7BE72CAFB8485E3D99`.

## Version 1.0.2

API Checker has been removed, including its UI, IPC methods and request service. Existing saved history is retained. The scan UI offers Automatic, HTTPS only, HTTP only and Both. Automatic retries failed HTTPS connections over HTTP and labels fallback results; Both records separate scheme results. Developer information and the footer identify Sudipta Roy Akash, sudiptaroy.dev, GitHub devsudipta and hello@sudiptaroy.dev.

Type checking, lint and the production build pass. All 16 integration tests pass, including the original 14 scanner tests and two new protocol tests. A real HTTP-only loopback server verifies HTTPS failure, successful automatic fallback, forced HTTP, separate results for Both, query/port preservation and crawler compatibility. The real Electron desktop test passes, verifying protocol controls, removal of API Checker, developer details, versioned footer and existing scanner/theme/persistence behavior. The light-theme screenshot was visually inspected. Installation/uninstallation evidence below applies to the original 1.0.0 release.

Both `npm run dist:win` and `npm run dist:portable` succeeded for 1.0.2. The actual portable executable passed the desktop test across two launches, including protocol controls, credits, scanner functionality and persistence. The packaged application reports product version `1.0.2.0` and company `Sudipta Roy Akash`. The 1.0.2 installer wizard/install/uninstall interactions were not repeated.

- Installer: `dist/URLChecker-Setup-1.0.2.exe`, 116,986,262 bytes. SHA-256: `4F4BC0CDAB8D2646FA6EDADC63819E328560663A93CF901273187009D6B041CF`.
- Portable: `dist/URLChecker-Portable-1.0.2.exe`, 103,140,171 bytes. SHA-256: `8D0FCEE2DB303F8E82B2A6B39A2876292C9307E57ADAF2C80EDE995166F0AB8B`.

## Passed (original scanner release)

- `npm install`: the exact command completed successfully after setup, including postinstall; the final dependency audit reported zero vulnerabilities. Initial network installation used `npm install --offline=false --cache .npm-cache` because the execution environment initially forced offline mode. The first better-sqlite3 install failed because Python/build prerequisites were unavailable; the implementation now uses bundled SQLite instead.
- `npm run typecheck`: no TypeScript errors.
- `npm run lint`: no lint errors.
- `npm run test`: 14 deterministic integration tests passed. These cover URL normalization/validation, HTTP status/error classes, internal/external detection, retries, redirect chains/limits/loops/unsafe protocols, socket timings, timeout, original URL preservation, queue delay exclusion, concurrency, pause/resume/cancel, crawling/robots/depth/limits/source deduplication, database recovery/persistence, imports/exports, comparison, and real local TLS validation for valid/untrusted/expired/hostname-mismatched certificates.
- `npm run dev`: the Electron desktop application launched from Vite without a startup error after downloading the Electron binary and removing an inherited `ELECTRON_RUN_AS_NODE` flag for the launch process.
- `npm run build`: main, sandboxed preload and React renderer compiled successfully.
- `npm run test:desktop`: the actual Electron window passed an end-to-end test for a real loopback scan, invalid URL and 404 diagnostics, result details/filters, renderer Node isolation, dark/light themes and persistence after closing/reopening. Both theme screenshots were visually inspected.
- `npm run dist:win`: generated `dist/URLChecker-Setup-1.0.0.exe` (116,985,312 bytes). The configuration uses an assisted installer with custom-directory support, x64, stable application ID, application icon and version metadata.
- Silent installation to `test-artifacts/installed` completed with exit code 0 and a functioning installed executable.
- The installed executable passed the same scan/detail/filter/theme/persistence end-to-end test.
- Actual Windows registry registration: `URL Checker Pro 1.0.0`, publisher `Sudipta Roy`, uninstall registration pointing to the test installation. The executable reports product version `1.0.0.0`.
- Actual desktop and Start Menu shortcuts were created.
- Silent uninstall returned exit code 0. Installed executable, Windows registration, desktop shortcut and Start Menu shortcut were removed. The test did not replace an existing installation.
- The installer is unsigned as intended for development. SHA-256: `6E458481628309D1AFE0DFF0CE307195BDAFFD26B5947BA585BCB506A4028DD1`.
- `npm run dist:portable`: generated `dist/URLChecker-Portable-1.0.0.exe` (103,129,378 bytes). SHA-256: `ABA49EBB6916E75F2018E66ED1973CFC179D7450F2CA5DB49926EC6ADBF34B12`.
- The actual portable executable passed the scan/detail/filter/theme/persistence end-to-end test across two launches. It was copied unchanged into an isolated test folder and used its adjacent `URLChecker-data` SQLite directory. The first test attempt used Electron's direct debugger launcher, which cannot connect through the NSIS wrapper's output; the successful harness connects to the real portable application's Chromium debugging port instead.

## Manual checks still required before publishing

The native Windows computer-use helper was unavailable after retry/reset. Consequently, the visible installer wizard's pages, manual directory-picker interaction, Installed Apps Settings UI and uninstall wizard were not visually exercised. Directory customization, actual registration, installation/uninstallation and installed functionality were verified through automation instead. Configuration alone does not prove the wizard UI.

Code signing/SmartScreen reputation, clean Windows-user profiles, organization deployment policies, accessibility with a screen reader, and sustained large-site performance require additional release testing. This is a working first version, not a claim that every production deployment scenario has been certified.

Screenshots, isolated test databases and installation evidence are under `test-artifacts/`. `scripts/verify-install.ps1` provides guarded installation/check/uninstall checks for the project-local test installation. It refuses to overwrite an existing installation. Systems that restrict `.ps1` execution can review and run its authored commands directly without changing system execution policy.

See README.md for architectural limitations, including static HTML crawling, body/import limits, bundled SQLite API status and unavailable TLS metadata on some failed handshakes.
