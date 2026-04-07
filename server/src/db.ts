import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Database file lives next to the compiled JS, or override with DB_PATH env var
const dbPath = process.env.DB_PATH || path.join(__dirname, "..", "data", "readings.db");

// Ensure the data directory exists
import fs from "node:fs";
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath);

// Performance pragmas for a write-heavy, single-writer workload
db.pragma("journal_mode = WAL"); // Write-Ahead Logging — concurrent reads while writing
db.pragma("synchronous = NORMAL"); // Good durability without fsync on every write
db.pragma("cache_size = -64000"); // 64MB page cache
db.pragma("busy_timeout = 5000"); // Wait up to 5s if DB is locked

// ─── Schema ──────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL DEFAULT 'esp32-lab-01',
    temperature REAL NOT NULL,
    pressure REAL NOT NULL,
    unit_temp TEXT NOT NULL DEFAULT 'Celsius',
    unit_pressure TEXT NOT NULL DEFAULT 'mmHg',
    timestamp TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_readings_timestamp ON readings(timestamp);
  CREATE INDEX IF NOT EXISTS idx_readings_device_timestamp ON readings(device_id, timestamp);
`);

// ─── Types ───────────────────────────────────────────────────────

export interface Reading {
  id: number;
  device_id: string;
  temperature: number;
  pressure: number;
  unit_temp: string;
  unit_pressure: string;
  timestamp: string; // ISO 8601 UTC
}

export interface HourlyAggregate {
  hour: string; // ISO 8601 hour start (e.g. "2026-04-07T14:00:00Z")
  temp_avg: number;
  temp_min: number;
  temp_max: number;
  pressure_avg: number;
  pressure_min: number;
  pressure_max: number;
  reading_count: number;
}

// ─── Prepared Statements ─────────────────────────────────────────

const insertReading = db.prepare(`
  INSERT INTO readings (device_id, temperature, pressure, unit_temp, unit_pressure, timestamp)
  VALUES (@device_id, @temperature, @pressure, @unit_temp, @unit_pressure, @timestamp)
`);

const selectRange = db.prepare(`
  SELECT id, device_id, temperature, pressure, unit_temp, unit_pressure, timestamp
  FROM readings
  WHERE timestamp >= @start AND timestamp <= @end
  ORDER BY timestamp ASC
`);

const selectRangeWithLimit = db.prepare(`
  SELECT id, device_id, temperature, pressure, unit_temp, unit_pressure, timestamp
  FROM readings
  WHERE timestamp >= @start AND timestamp <= @end
  ORDER BY timestamp ASC
  LIMIT @limit
`);

const selectLatest = db.prepare(`
  SELECT id, device_id, temperature, pressure, unit_temp, unit_pressure, timestamp
  FROM readings
  ORDER BY timestamp DESC
  LIMIT 1
`);

const selectHourlyAggregate = db.prepare(`
  SELECT
    strftime('%Y-%m-%dT%H:00:00Z', timestamp) AS hour,
    AVG(temperature) AS temp_avg,
    MIN(temperature) AS temp_min,
    MAX(temperature) AS temp_max,
    AVG(pressure) AS pressure_avg,
    MIN(pressure) AS pressure_min,
    MAX(pressure) AS pressure_max,
    COUNT(*) AS reading_count
  FROM readings
  WHERE timestamp >= @start AND timestamp <= @end
  GROUP BY strftime('%Y-%m-%dT%H:00:00Z', timestamp)
  ORDER BY hour ASC
`);

const selectCount = db.prepare(`
  SELECT COUNT(*) AS count FROM readings
`);

const selectCountRange = db.prepare(`
  SELECT COUNT(*) AS count
  FROM readings
  WHERE timestamp >= @start AND timestamp <= @end
`);

// ─── Public API ──────────────────────────────────────────────────

export function addReading(reading: Omit<Reading, "id">): Reading {
  const result = insertReading.run(reading);
  return { ...reading, id: Number(result.lastInsertRowid) };
}

export function getReadings(start: string, end: string, limit?: number): Reading[] {
  if (limit != null) {
    return selectRangeWithLimit.all({ start, end, limit }) as Reading[];
  }
  return selectRange.all({ start, end }) as Reading[];
}

export function getLatestReading(): Reading | undefined {
  return selectLatest.get() as Reading | undefined;
}

export function getHourlyAggregates(start: string, end: string): HourlyAggregate[] {
  return selectHourlyAggregate.all({ start, end }) as HourlyAggregate[];
}

export function getTotalCount(): number {
  const row = selectCount.get() as { count: number };
  return row.count;
}

export function getRangeCount(start: string, end: string): number {
  const row = selectCountRange.get({ start, end }) as { count: number };
  return row.count;
}

export function closeDb(): void {
  db.close();
}
