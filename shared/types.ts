export type ScanMode = "quick" | "crawl";
export type Category =
  | "online"
  | "redirect"
  | "broken"
  | "timeout"
  | "dns"
  | "connection"
  | "ssl"
  | "rate-limited"
  | "blocked"
  | "invalid"
  | "skipped"
  | "error";
export interface Timings {
  dns: number | null;
  tcp: number | null;
  tls: number | null;
  ttfb: number | null;
  download: number | null;
  total: number;
}
export interface Redirect {
  source: string;
  destination: string;
  code: number;
}
export interface SslInfo {
  valid: boolean;
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  daysRemaining: number;
  hostnameValid: boolean;
  error: string | null;
}
export interface UrlResult {
  id: string;
  scanId: string;
  originalUrl: string;
  url: string;
  finalUrl: string;
  code: number | null;
  category: Category;
  label: string;
  errorCode: string | null;
  errorMessage: string | null;
  technicalError: string | null;
  timings: Timings;
  redirects: Redirect[];
  ssl: SslInfo | null;
  contentType: string | null;
  contentLength: number | null;
  checkedAt: string;
  attempts: number;
  performance: "fast" | "normal" | "slow" | "very slow";
  depth: number;
}
export interface SourceLink {
  source: string;
  target: string;
  normalizedTarget: string;
  element: string;
  anchor: string;
  scope: "internal" | "external";
  asset: boolean;
}
export interface Settings {
  protocol?: "auto" | "https" | "http" | "both";
  concurrency: number;
  timeout: number;
  retries: number;
  retryDelay: number;
  maxRedirects: number;
  crawlDepth: number;
  maxPages: number;
  perHostConcurrency: number;
  hostDelay: number;
  respectRobots: boolean;
  checkAssets: boolean;
  userAgent: string;
  fastThreshold: number;
  normalThreshold: number;
  slowThreshold: number;
  theme: "dark" | "light" | "system";
}
export interface ImportSummary {
  urls: string[];
  invalid: string[];
  imported: number;
  duplicates: number;
}
export interface Scan {
  id: string;
  name: string;
  mode: ScanMode;
  baseUrl: string | null;
  status: "running" | "paused" | "completed" | "cancelled" | "interrupted";
  startedAt: string;
  completedAt: string | null;
  total: number;
  checked: number;
  counts: Record<string, number>;
}
export interface Progress {
  scan: Scan;
  active: number;
  elapsed: number;
  rate: number;
}
export interface ResultQuery {
  scanId: string;
  page: number;
  search: string;
  filter: string;
  scope: string;
  sort: "url" | "code" | "time" | "checkedAt";
  direction: "asc" | "desc";
}
export interface ResultsPage {
  rows: UrlResult[];
  total: number;
}
export interface Dashboard {
  counts: Record<string, number>;
  average: number | null;
  slowest: UrlResult[];
  errors: { code: string; count: number }[];
  internal: number;
  external: number;
  brokenInternal: number;
  brokenExternal: number;
}
export interface Comparison {
  url: string;
  before: number | null;
  after: number | null;
  change: string;
  delta: number;
}
export interface DesktopApi {
  settings: () => Promise<{ settings: Settings; location: string }>;
  saveSettings: (settings: Settings) => Promise<Settings>;
  importFiles: () => Promise<ImportSummary | null>;
  importDrop: (files: File[]) => Promise<ImportSummary>;
  preview: (text: string) => Promise<ImportSummary>;
  start: (input: {
    name: string;
    mode: "quick" | "crawl";
    text: string;
    settings: Settings;
  }) => Promise<Scan>;
  control: (action: "pause" | "resume" | "stop") => Promise<void>;
  history: () => Promise<Scan[]>;
  results: (query: ResultQuery) => Promise<ResultsPage>;
  detail: (id: string) => Promise<{ result: UrlResult; sources: SourceLink[] }>;
  dashboard: (scanId: string) => Promise<Dashboard>;
  deleteScan: (id: string) => Promise<void>;
  exportScan: (
    scanId: string,
    format: "csv" | "xlsx" | "json" | "html",
  ) => Promise<string | null>;
  compare: (first: string, second: string) => Promise<Comparison[]>;
  openUrl: (url: string) => Promise<void>;
  onProgress: (callback: (progress: Progress) => void) => () => void;
}
