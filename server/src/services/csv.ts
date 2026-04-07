// Server-side CSV generation
// Converts raw readings to CSV with unit conversion applied.

import Papa from "papaparse";
import type { Reading } from "../db.js";

// ─── Unit conversion (mirrors src/lib/units.ts from the dashboard) ──

type PressureUnit = "mmHg" | "atm" | "psi";
type TemperatureUnit = "C" | "F" | "K" | "R";

function convertPressure(mmHg: number, to: PressureUnit): number {
  switch (to) {
    case "mmHg":
      return mmHg;
    case "atm":
      return mmHg / 760;
    case "psi":
      return mmHg * 0.0193368;
  }
}

function convertTemperature(celsius: number, to: TemperatureUnit): number {
  switch (to) {
    case "C":
      return celsius;
    case "F":
      return (celsius * 9) / 5 + 32;
    case "K":
      return celsius + 273.15;
    case "R":
      return ((celsius + 273.15) * 9) / 5;
  }
}

// Map URL param unit labels to display labels (with degree symbols)
const PRESSURE_DISPLAY: Record<PressureUnit, string> = {
  mmHg: "mmHg",
  atm: "atm",
  psi: "psi",
};

const TEMP_DISPLAY: Record<TemperatureUnit, string> = {
  C: "\u00B0C",
  F: "\u00B0F",
  K: "K",
  R: "\u00B0R",
};

export function isPressureUnit(s: string): s is PressureUnit {
  return ["mmHg", "atm", "psi"].includes(s);
}

export function isTemperatureUnit(s: string): s is TemperatureUnit {
  return ["C", "F", "K", "R"].includes(s);
}

interface CsvRow {
  timestamp: string;
  temperature: number;
  pressure: number;
  unit_temp: string;
  unit_pressure: string;
  device_id: string;
}

export function generateCsv(
  readings: Reading[],
  pressureUnit: PressureUnit = "mmHg",
  temperatureUnit: TemperatureUnit = "C"
): string {
  const rows: CsvRow[] = readings.map((r) => ({
    timestamp: r.timestamp,
    temperature: convertTemperature(r.temperature, temperatureUnit),
    pressure: convertPressure(r.pressure, pressureUnit),
    unit_temp: TEMP_DISPLAY[temperatureUnit],
    unit_pressure: PRESSURE_DISPLAY[pressureUnit],
    device_id: r.device_id,
  }));

  // Prepend UTF-8 BOM for Excel compatibility with degree symbols
  const csv = Papa.unparse(rows, {
    header: true,
    columns: [
      "timestamp",
      "temperature",
      "pressure",
      "unit_temp",
      "unit_pressure",
      "device_id",
    ],
  });

  return "\uFEFF" + csv;
}
