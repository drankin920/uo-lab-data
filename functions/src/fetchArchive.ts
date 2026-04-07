import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

const bucket = admin.storage().bucket();

/**
 * HTTPS Cloud Function that fetches raw-resolution CSV data from
 * the Cloud Storage archive for a given date range.
 *
 * Query parameters:
 *   start - ISO 8601 timestamp (e.g., "2026-01-15T08:00:00.000Z")
 *   end   - ISO 8601 timestamp (e.g., "2026-01-20T17:30:00.000Z")
 *
 * Returns: CSV text with header row, filtered to the exact time range.
 *
 * The daily CSV files in Cloud Storage are at:
 *   readings/YYYY/MM/YYYY-MM-DD.csv
 * Each has the header:
 *   timestamp,device_id,temperature,pressure,unit_temp,unit_pressure
 */
export const fetchArchiveReadings = onRequest(
  {
    cors: true,
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  async (req, res) => {
    const startParam = req.query.start as string | undefined;
    const endParam = req.query.end as string | undefined;

    if (!startParam || !endParam) {
      res.status(400).json({ error: "Missing required query parameters: start, end" });
      return;
    }

    const startDate = new Date(startParam);
    const endDate = new Date(endParam);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      res.status(400).json({ error: "Invalid date format. Use ISO 8601." });
      return;
    }

    if (startDate >= endDate) {
      res.status(400).json({ error: "start must be before end" });
      return;
    }

    // Enumerate all calendar days (UTC) that fall within the range
    const days: string[] = [];
    const cursor = new Date(
      Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate())
    );
    const endDay = new Date(
      Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate())
    );

    while (cursor <= endDay) {
      const y = cursor.getUTCFullYear().toString();
      const m = String(cursor.getUTCMonth() + 1).padStart(2, "0");
      const d = String(cursor.getUTCDate()).padStart(2, "0");
      days.push(`readings/${y}/${m}/${y}-${m}-${d}.csv`);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    // Cap at 365 days to prevent abuse
    if (days.length > 365) {
      res.status(400).json({ error: "Maximum export range is 365 days" });
      return;
    }

    const startMs = startDate.getTime();
    const endMs = endDate.getTime();

    // Header row (same as the daily CSVs)
    const header = "timestamp,device_id,temperature,pressure,unit_temp,unit_pressure";
    const outputRows: string[] = [header];
    let filesFound = 0;

    // Fetch each daily CSV and filter rows by exact time range
    for (const filePath of days) {
      const file = bucket.file(filePath);
      const [exists] = await file.exists();

      if (!exists) {
        // No data for this day — skip silently
        continue;
      }

      filesFound++;
      const [contents] = await file.download();
      const text = contents.toString("utf-8");
      const lines = text.split("\n");

      // Skip header (first line) and empty trailing lines
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // First column is the ISO timestamp — parse it to filter
        const commaIdx = line.indexOf(",");
        if (commaIdx === -1) continue;

        const tsStr = line.substring(0, commaIdx);
        const tsMs = new Date(tsStr).getTime();

        if (tsMs >= startMs && tsMs < endMs) {
          outputRows.push(line);
        }
      }
    }

    if (filesFound === 0) {
      res.status(404).json({
        error: "No archived data found for the selected date range",
      });
      return;
    }

    // Return CSV
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Cache-Control", "public, max-age=3600"); // Cache for 1 hour
    res.status(200).send(outputRows.join("\n") + "\n");
  }
);
