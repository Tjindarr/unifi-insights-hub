-- UniFi Dashboard schema. SQLite with WAL + FTS5.

PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 268435456;

CREATE TABLE IF NOT EXISTS syslog (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  time        INTEGER NOT NULL,   -- unix ms
  host        TEXT NOT NULL,
  appname     TEXT,
  facility    TEXT,
  severity    TEXT NOT NULL,
  message     TEXT NOT NULL,
  raw         TEXT NOT NULL,
  is_firewall INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_syslog_time     ON syslog(time DESC);
CREATE INDEX IF NOT EXISTS idx_syslog_host     ON syslog(host, time DESC);
CREATE INDEX IF NOT EXISTS idx_syslog_severity ON syslog(severity, time DESC);
CREATE INDEX IF NOT EXISTS idx_syslog_firewall ON syslog(is_firewall, time DESC);

-- FTS5 mirror for very fast full-text search on the message body.
CREATE VIRTUAL TABLE IF NOT EXISTS syslog_fts USING fts5(
  message, host, appname,
  content='syslog', content_rowid='id', tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS syslog_ai AFTER INSERT ON syslog BEGIN
  INSERT INTO syslog_fts(rowid, message, host, appname)
  VALUES (new.id, new.message, new.host, new.appname);
END;
CREATE TRIGGER IF NOT EXISTS syslog_ad AFTER DELETE ON syslog BEGIN
  INSERT INTO syslog_fts(syslog_fts, rowid, message, host, appname)
  VALUES ('delete', old.id, old.message, old.appname, old.host);
END;

CREATE TABLE IF NOT EXISTS firewall_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  syslog_id     INTEGER NOT NULL REFERENCES syslog(id) ON DELETE CASCADE,
  time          INTEGER NOT NULL,
  rule          TEXT,
  action        TEXT,
  event_type    TEXT,
  message_type  TEXT,
  client_mac    TEXT,
  src_ip        TEXT,
  src_port      INTEGER,
  dst_ip        TEXT,
  dst_port      INTEGER,
  proto         TEXT,
  vap           TEXT,
  rssi          INTEGER,
  reason        TEXT,
  raw_json      TEXT
);
CREATE INDEX IF NOT EXISTS idx_fw_time   ON firewall_events(time DESC);
CREATE INDEX IF NOT EXISTS idx_fw_action ON firewall_events(action, time DESC);
CREATE INDEX IF NOT EXISTS idx_fw_mac    ON firewall_events(client_mac, time DESC);
-- Covering composite for bucket aggregation (time-range scan + action sum).
CREATE INDEX IF NOT EXISTS idx_fw_time_action ON firewall_events(time, action);
-- Search-filter indexes used by the firewall page.
CREATE INDEX IF NOT EXISTS idx_fw_srcip  ON firewall_events(src_ip, time DESC) WHERE src_ip IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fw_dstip  ON firewall_events(dst_ip, time DESC) WHERE dst_ip IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fw_rule   ON firewall_events(rule, time DESC) WHERE rule IS NOT NULL;
-- Partial indexes that mirror the kind predicates so bucket queries can
-- skip rows of the other kind without a full table scan.
CREATE INDEX IF NOT EXISTS idx_fw_kind_firewall ON firewall_events(time, action) WHERE
  src_ip IS NOT NULL
  OR dst_ip IS NOT NULL
  OR rule LIKE 'LAN\_%' ESCAPE '\'
  OR rule LIKE 'WAN\_%' ESCAPE '\'
  OR rule LIKE 'GUEST\_%' ESCAPE '\'
  OR rule IN ('UFW','UBNT','FW');
CREATE INDEX IF NOT EXISTS idx_fw_kind_internal ON firewall_events(time, action) WHERE
  src_ip IS NULL AND dst_ip IS NULL
  AND (rule IS NULL OR (
    rule NOT LIKE 'LAN\_%' ESCAPE '\'
    AND rule NOT LIKE 'WAN\_%' ESCAPE '\'
    AND rule NOT LIKE 'GUEST\_%' ESCAPE '\'
  ));

-- FTS5 mirror for fast full-text search across firewall_events. The previous
-- implementation used `LIKE %q%` on rule / client_mac / vap / raw_json which
-- forced a full-table scan on every keystroke. The mirror table keeps search
-- responsive even with millions of rows. `content=` makes it an external
-- content table so we don't double-store every column.
CREATE VIRTUAL TABLE IF NOT EXISTS firewall_events_fts USING fts5(
  rule, client_mac, src_ip, dst_ip, vap, reason, raw_json,
  content='firewall_events', content_rowid='id', tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS firewall_events_ai AFTER INSERT ON firewall_events BEGIN
  INSERT INTO firewall_events_fts(rowid, rule, client_mac, src_ip, dst_ip, vap, reason, raw_json)
  VALUES (new.id, new.rule, new.client_mac, new.src_ip, new.dst_ip, new.vap, new.reason, new.raw_json);
END;
CREATE TRIGGER IF NOT EXISTS firewall_events_ad AFTER DELETE ON firewall_events BEGIN
  INSERT INTO firewall_events_fts(firewall_events_fts, rowid, rule, client_mac, src_ip, dst_ip, vap, reason, raw_json)
  VALUES ('delete', old.id, old.rule, old.client_mac, old.src_ip, old.dst_ip, old.vap, old.reason, old.raw_json);
END;
CREATE TRIGGER IF NOT EXISTS firewall_events_au AFTER UPDATE ON firewall_events BEGIN
  INSERT INTO firewall_events_fts(firewall_events_fts, rowid, rule, client_mac, src_ip, dst_ip, vap, reason, raw_json)
  VALUES ('delete', old.id, old.rule, old.client_mac, old.src_ip, old.dst_ip, old.vap, old.reason, old.raw_json);
  INSERT INTO firewall_events_fts(rowid, rule, client_mac, src_ip, dst_ip, vap, reason, raw_json)
  VALUES (new.id, new.rule, new.client_mac, new.src_ip, new.dst_ip, new.vap, new.reason, new.raw_json);
END;


-- Snapshot of the latest UniFi API state. Single-row tables to keep things simple.
CREATE TABLE IF NOT EXISTS unifi_clients_snapshot (
  ts   INTEGER NOT NULL,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS unifi_health_snapshot (
  ts   INTEGER NOT NULL,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS unifi_devices_snapshot (
  ts   INTEGER NOT NULL,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS unifi_events_snapshot (
  ts   INTEGER NOT NULL,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS unifi_dpi_snapshot (
  ts   INTEGER NOT NULL,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS unifi_dpi_catalog_snapshot (
  ts   INTEGER NOT NULL,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS unifi_speedtest_snapshot (
  ts   INTEGER NOT NULL,
  json TEXT NOT NULL
);

-- ---- Syslog-derived enrichment tables -----------------------------------
-- MAC ↔ IP history derived from wevent EVENT_STA_IP lines on the APs.
CREATE TABLE IF NOT EXISTS client_ip_history (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  time  INTEGER NOT NULL,
  mac   TEXT NOT NULL,
  ip    TEXT NOT NULL,
  vap   TEXT,
  host  TEXT
);
CREATE INDEX IF NOT EXISTS idx_ciph_mac  ON client_ip_history(mac, time DESC);
CREATE INDEX IF NOT EXISTS idx_ciph_time ON client_ip_history(time DESC);

-- DHCP ACKs from dnsmasq-dhcp on the gateway. Authoritative MAC→hostname/IP.
CREATE TABLE IF NOT EXISTS dhcp_leases (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  time      INTEGER NOT NULL,
  mac       TEXT NOT NULL,
  ip        TEXT NOT NULL,
  hostname  TEXT,
  op        TEXT          -- DHCPACK / DHCPOFFER / DHCPREQUEST / DHCPNAK
);
CREATE INDEX IF NOT EXISTS idx_dhcp_mac  ON dhcp_leases(mac, time DESC);
CREATE INDEX IF NOT EXISTS idx_dhcp_time ON dhcp_leases(time DESC);

-- Wi-Fi association / auth events from stahtd STA-TRACKER JSON blobs.
CREATE TABLE IF NOT EXISTS wifi_auth_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  time          INTEGER NOT NULL,
  mac           TEXT NOT NULL,
  vap           TEXT,
  event_type    TEXT,     -- success / failure
  message_type  TEXT,
  assoc_status  INTEGER,
  auth_failures INTEGER,
  rssi          INTEGER,
  reason_code   TEXT,
  reason        TEXT
);
CREATE INDEX IF NOT EXISTS idx_wae_mac  ON wifi_auth_events(mac, time DESC);
CREATE INDEX IF NOT EXISTS idx_wae_time ON wifi_auth_events(time DESC);

-- ---- IP enrichment cache (GeoIP + AbuseIPDB) ----------------------------
CREATE TABLE IF NOT EXISTS ip_enrichment (
  ip              TEXT PRIMARY KEY,
  country         TEXT,
  cc              TEXT,
  city            TEXT,
  isp             TEXT,
  geo_fetched_at  INTEGER,
  abuse_score     INTEGER,
  abuse_reports   INTEGER,
  abuse_fetched_at INTEGER
);

-- ---- Local threat-feed cache (offline IP / CIDR blocklists) -------------
-- Populated on a schedule from public feeds (FireHOL, Spamhaus, AbuseIPDB
-- blacklist, etc). /api/ipinfo consults these before falling back to per-IP
-- AbuseIPDB /check lookups, which keeps free-tier quota intact.
CREATE TABLE IF NOT EXISTS threat_feed_ip (
  ip        TEXT NOT NULL,
  source    TEXT NOT NULL,
  added_at  INTEGER NOT NULL,
  PRIMARY KEY (ip, source)
);
CREATE INDEX IF NOT EXISTS idx_tfi_ip ON threat_feed_ip(ip);

CREATE TABLE IF NOT EXISTS threat_feed_cidr (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  cidr       TEXT NOT NULL,
  start_int  INTEGER NOT NULL,
  end_int    INTEGER NOT NULL,
  source     TEXT NOT NULL,
  added_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tfc_range  ON threat_feed_cidr(start_int, end_int);
CREATE INDEX IF NOT EXISTS idx_tfc_source ON threat_feed_cidr(source);

CREATE TABLE IF NOT EXISTS threat_feed_meta (
  source           TEXT PRIMARY KEY,
  last_updated_at  INTEGER,
  last_attempt_at  INTEGER,
  last_error       TEXT,
  ip_count         INTEGER DEFAULT 0,
  cidr_count       INTEGER DEFAULT 0
);




