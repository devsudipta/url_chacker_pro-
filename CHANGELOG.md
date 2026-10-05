# Changelog

Every published version has a separate Git tag and GitHub Release. Executables are attached to Releases rather than committed to the source repository.

## Unreleased

Record future fixes here as they are implemented. No additional fixes are claimed yet.

## 1.0.2 — 2026-10-06

### Fixed

- HTTPS connections without an HTTP response can fall back to HTTP in Automatic mode. Results identify fallback and retain the entered URL in details.
- Protocol selection applies to crawl discoveries and starting URLs.

### Added

- Automatic, HTTPS only, HTTP only and Both protocol options. Both keeps separate scheme results.
- Footer and developer information for Sudipta Roy Akash, including website, GitHub and email.
- Version 1.0.2 installer and portable downloads.

### Removed

- API Checker UI, request service and API IPC methods. Existing saved history is retained.

### Verification

Typecheck, lint, build and 16 integration tests passed. Real Electron desktop checks passed for the development build and the actual portable executable. The 1.0.2 installer was generated; install/uninstall interactions were not repeated. See VERIFICATION.md.

## 1.0.0 — 2026-10-05

Initial Windows URL diagnostics application: bulk scans, website crawling, timing/TLS diagnostics, SQLite history, reports, themes, assisted installer and portable build.

The historical release contains the original binaries. Its original source snapshot was not retained; the tag contains archive documentation rather than reconstructed source.

## Future releases

- Fixes increment the patch version, for example 1.0.2 → 1.0.3. Compatible features increment the minor version; breaking changes increment the major version.
- Update package.json, the root/package entries in package-lock.json, displayed app version, installer verification paths and changelog together.
- Tag tested releases as `vX.Y.Z`. The tag-triggered Windows workflow prepares a draft Release for review.
- Preserve published tags and download files. Do not overwrite older releases with newer builds.
