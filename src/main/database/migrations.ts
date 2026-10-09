export const migrations = [
  `
CREATE TABLE projects(id TEXT PRIMARY KEY, name TEXT NOT NULL, base_url TEXT UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE scans(id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), name TEXT NOT NULL, mode TEXT NOT NULL, base_url TEXT, status TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT, total INTEGER NOT NULL DEFAULT 0, checked INTEGER NOT NULL DEFAULT 0, counts TEXT NOT NULL DEFAULT '{}');
CREATE TABLE url_results(id TEXT PRIMARY KEY, scan_id TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE, original_url TEXT NOT NULL, normalized_url TEXT NOT NULL, final_url TEXT NOT NULL, status_code INTEGER, status_category TEXT NOT NULL, error_code TEXT, response_time REAL NOT NULL, checked_at TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(scan_id, normalized_url));
CREATE INDEX idx_results_scan ON url_results(scan_id,status_category);
CREATE INDEX idx_results_time ON url_results(scan_id,response_time);
CREATE INDEX idx_results_status ON url_results(scan_id,status_code);
CREATE TABLE redirects(id INTEGER PRIMARY KEY, url_result_id TEXT NOT NULL REFERENCES url_results(id) ON DELETE CASCADE, sequence INTEGER NOT NULL, source_url TEXT NOT NULL, destination_url TEXT NOT NULL, status_code INTEGER NOT NULL);
CREATE TABLE discovered_links(id INTEGER PRIMARY KEY, scan_id TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE, source_url TEXT NOT NULL, target_url TEXT NOT NULL, normalized_target_url TEXT NOT NULL, element_type TEXT NOT NULL, anchor_text TEXT NOT NULL, internal_external TEXT NOT NULL, asset INTEGER NOT NULL, UNIQUE(scan_id,source_url,target_url,element_type,anchor_text));
CREATE INDEX idx_sources_target ON discovered_links(scan_id,normalized_target_url);
CREATE TABLE ssl_results(url_result_id TEXT PRIMARY KEY REFERENCES url_results(id) ON DELETE CASCADE, valid INTEGER NOT NULL, issuer TEXT, subject TEXT, valid_from TEXT, valid_to TEXT, days_remaining INTEGER, hostname_valid INTEGER, error TEXT);
CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
`,
  `
CREATE TABLE monitor_sessions(id TEXT PRIMARY KEY,scan_id TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,interval_seconds INTEGER NOT NULL,status TEXT NOT NULL,started_at TEXT NOT NULL,stopped_at TEXT);
CREATE TABLE monitor_targets(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES monitor_sessions(id) ON DELETE CASCADE,name TEXT NOT NULL,url TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'unknown',checked_at TEXT,code INTEGER,response_ms REAL,error TEXT);
CREATE TABLE monitor_checks(id INTEGER PRIMARY KEY,target_id TEXT NOT NULL REFERENCES monitor_targets(id) ON DELETE CASCADE,checked_at TEXT NOT NULL,status TEXT NOT NULL,code INTEGER,response_ms REAL,error TEXT);
CREATE INDEX idx_monitor_checks ON monitor_checks(target_id,checked_at);
CREATE TABLE outages(id TEXT PRIMARY KEY,target_id TEXT NOT NULL REFERENCES monitor_targets(id) ON DELETE CASCADE,offline_at TEXT NOT NULL,online_at TEXT,ended_at TEXT,duration_ms REAL);
CREATE UNIQUE INDEX idx_open_outage ON outages(target_id) WHERE ended_at IS NULL;
CREATE INDEX idx_monitor_session ON monitor_sessions(scan_id,started_at);
`,
];
