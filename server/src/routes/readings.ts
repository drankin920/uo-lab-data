import { Router, type Request, type Response } from "express";
import {
  addReading,
  getReadings,
  getLatestReading,
  getHourlyAggregates,
  getTotalCount,
  getRangeCount,
} from "../db.js";
import { forwardToFirestore } from "../services/firestore.js";
import {
  generateCsv,
  isPressureUnit,
  isTemperatureUnit,
} from "../services/csv.js";

const router = Router();

// ─── POST /api/readings ─────────────────────────────────────────
// Receives a reading from the ESP32, stores it in SQLite,
// and forwards it to Firestore for the real-time dashboard.

router.post("/", async (req: Request, res: Response) => {
  try {
    const { device_id, temperature, pressure, unit_temp, unit_pressure, timestamp } = req.body;

    // Validate required fields
    if (
      typeof temperature !== "number" ||
      typeof pressure !== "number" ||
      typeof timestamp !== "string"
    ) {
      res.status(400).json({
        error: "Missing or invalid fields. Required: temperature (number), pressure (number), timestamp (string)",
      });
      return;
    }

    const reading = {
      device_id: device_id || "esp32-lab-01",
      temperature,
      pressure,
      unit_temp: unit_temp || "Celsius",
      unit_pressure: unit_pressure || "mmHg",
      timestamp,
    };

    // Store in SQLite (synchronous, fast)
    const saved = addReading(reading);

    // Forward to Firestore (async, best-effort — don't block the response)
    forwardToFirestore(reading).catch((err) => {
      console.error("[readings] Firestore forward failed:", err);
    });

    res.status(201).json({ id: saved.id, status: "ok" });
  } catch (err) {
    console.error("[readings] POST error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/readings ──────────────────────────────────────────
// Query historical readings by time range.
// Query params:
//   start  — ISO 8601 start time (required)
//   end    — ISO 8601 end time (required)
//   limit  — max number of rows (optional)
//   mode   — "raw" (default) or "hourly" (returns aggregated hourly data)

router.get("/", (req: Request, res: Response) => {
  try {
    const { start, end, limit, mode } = req.query;

    if (!start || !end) {
      res.status(400).json({
        error: "Missing required query params: start, end (ISO 8601)",
      });
      return;
    }

    const startStr = start as string;
    const endStr = end as string;

    if (mode === "hourly") {
      const aggregates = getHourlyAggregates(startStr, endStr);
      res.json({
        mode: "hourly",
        count: aggregates.length,
        data: aggregates,
      });
      return;
    }

    // Raw mode
    const limitNum = limit ? parseInt(limit as string, 10) : undefined;
    const readings = getReadings(startStr, endStr, limitNum);

    res.json({
      mode: "raw",
      count: readings.length,
      data: readings,
    });
  } catch (err) {
    console.error("[readings] GET error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/readings/latest ───────────────────────────────────
// Returns the single most recent reading.

router.get("/latest", (_req: Request, res: Response) => {
  try {
    const reading = getLatestReading();
    if (!reading) {
      res.status(404).json({ error: "No readings found" });
      return;
    }
    res.json(reading);
  } catch (err) {
    console.error("[readings] GET latest error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/readings/stats ────────────────────────────────────
// Returns count info for monitoring.

router.get("/stats", (req: Request, res: Response) => {
  try {
    const { start, end } = req.query;
    const total = getTotalCount();

    let rangeCount: number | undefined;
    if (start && end) {
      rangeCount = getRangeCount(start as string, end as string);
    }

    res.json({ total, rangeCount });
  } catch (err) {
    console.error("[readings] GET stats error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/readings/export ───────────────────────────────────
// Downloads readings as a CSV file.
// Query params:
//   start         — ISO 8601 start time (required)
//   end           — ISO 8601 end time (required)
//   pressureUnit  — "mmHg" | "atm" | "psi" (default: "mmHg")
//   tempUnit      — "C" | "F" | "K" | "R" (default: "C")

router.get("/export", (req: Request, res: Response) => {
  try {
    const { start, end, pressureUnit, tempUnit } = req.query;

    if (!start || !end) {
      res.status(400).json({
        error: "Missing required query params: start, end (ISO 8601)",
      });
      return;
    }

    const pUnit = (pressureUnit as string) || "mmHg";
    const tUnit = (tempUnit as string) || "C";

    if (!isPressureUnit(pUnit)) {
      res.status(400).json({
        error: `Invalid pressureUnit "${pUnit}". Must be: mmHg, atm, psi`,
      });
      return;
    }
    if (!isTemperatureUnit(tUnit)) {
      res.status(400).json({
        error: `Invalid tempUnit "${tUnit}". Must be: C, F, K, R`,
      });
      return;
    }

    const readings = getReadings(start as string, end as string);

    if (readings.length === 0) {
      res.status(404).json({ error: "No data available for the selected date range" });
      return;
    }

    const csv = generateCsv(readings, pUnit, tUnit);

    const startDate = (start as string).split("T")[0];
    const endDate = (end as string).split("T")[0];
    const filename = `readings_${startDate}_to_${endDate}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error("[readings] GET export error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
