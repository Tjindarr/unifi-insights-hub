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


