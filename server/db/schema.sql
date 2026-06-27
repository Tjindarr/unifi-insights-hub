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
