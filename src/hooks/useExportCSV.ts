import { useCallback, useState } from "react";
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import Papa from "papaparse";
import {
  convertPressure,
  convertTemperature,
  type PressureUnit,
  type TemperatureUnit,
} from "@/lib/units";

/** Cloud Function URL for fetching archived raw CSV data from Cloud Storage. */
const ARCHIVE_FUNCTION_URL =
  "https://us-central1-uo-lab-pulse.cloudfunctions.net/fetchArchiveReadings";

const TIMEZONE = "America/Denver";

/**
 * Format a Date as a Mountain Time string: "YYYY-MM-DD HH:MM:SS MST" (or MDT).
 * Uses Intl.DateTimeFormat to get the correct offset for DST handling.
 */
function toMountainTimeString(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")} ${get("timeZoneName")}`;
}

interface ExportRow {
  timestamp: string;
  temperature: number;
  pressure: number;
  unit_temp: string;
  unit_pressure: string;
  device_id: string;
}

interface UseExportCSVReturn {
  exportCSV: (
    pressureUnit: PressureUnit,
    temperatureUnit: TemperatureUnit,
    startDate: Date,
    endDate: Date,
  ) => Promise<void>;
  isExporting: boolean;
  error: string | null;
}

export function useExportCSV(): UseExportCSVReturn {
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exportCSV = useCallback(
    async (
      pressureUnit: PressureUnit,
      temperatureUnit: TemperatureUnit,
      startDate: Date,
      endDate: Date,
    ) => {
      setIsExporting(true);
      setError(null);

      try {
        // Determine whether to use raw readings from Firestore or
        // the Cloud Storage archive via Cloud Function.
        // Raw readings in Firestore are only available for the last 48 hours.
        // For anything older, fetch full-resolution data from Cloud Storage.
        const now = new Date();
        const cutoff48h = new Date(now.getTime() - 48 * 60 * 60 * 1000);
        const useArchive = startDate < cutoff48h;

        if (useArchive) {
          // Fetch full-resolution raw data from Cloud Storage via Cloud Function
          const params = new URLSearchParams({
            start: startDate.toISOString(),
            end: endDate.toISOString(),
          });
          const response = await fetch(`${ARCHIVE_FUNCTION_URL}?${params}`);

          if (response.status === 404) {
            setError("No archived data found for the selected date range");
            setIsExporting(false);
            return;
          }

          if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.error || `Archive fetch failed (HTTP ${response.status})`);
          }

          const csvText = await response.text();
          const parsed = Papa.parse<Record<string, string>>(csvText, {
            header: true,
            skipEmptyLines: true,
          });

          if (parsed.data.length === 0) {
            setError("No data available for the selected date range");
            setIsExporting(false);
            return;
          }

          // Apply unit conversions to the raw archive data
          const rows: ExportRow[] = parsed.data.map((row) => {
            // Prefer the machine-friendly ISO with offset if present
            const tsRaw = (row.timestamp_MT_ISO ?? row.timestamp ?? row.timestamp_MT) as string;
            return {
              timestamp: toMountainTimeString(new Date(tsRaw)),
              temperature: convertTemperature(parseFloat(row.temperature), temperatureUnit),
              pressure: convertPressure(parseFloat(row.pressure), pressureUnit),
              unit_temp: temperatureUnit,
              unit_pressure: pressureUnit,
              device_id: row.device_id || "esp32-lab-01",
            };
          });

          generateAndDownloadCSV(rows, startDate, endDate);
        } else {
          // Query raw readings directly from Firestore (last 48h)
          const startTs = Timestamp.fromDate(startDate);
          const endTs = Timestamp.fromDate(endDate);

          const q = query(
            collection(db, "readings"),
            where("timestamp", ">=", startTs),
            where("timestamp", "<", endTs),
            orderBy("timestamp", "asc")
          );
          const snapshot = await getDocs(q);

          if (snapshot.empty) {
            setError("No data available for the selected date range");
            setIsExporting(false);
            return;
          }

          const rows: ExportRow[] = snapshot.docs.map((doc) => {
            const data = doc.data();
            const ts = (data.timestamp as Timestamp).toDate();
            return {
              timestamp: toMountainTimeString(ts),
              temperature: convertTemperature(data.temperature, temperatureUnit),
              pressure: convertPressure(data.pressure, pressureUnit),
              unit_temp: temperatureUnit,
              unit_pressure: pressureUnit,
              device_id: data.device_id || "esp32-lab-01",
            };
          });

          generateAndDownloadCSV(rows, startDate, endDate);
        }
      } catch (err) {
        console.error("CSV export error:", err);
        setError(err instanceof Error ? err.message : "Export failed");
      } finally {
        setIsExporting(false);
      }
    },
    [],
  );

  return { exportCSV, isExporting, error };
}

function generateAndDownloadCSV(
  rows: ExportRow[],
  startDate: Date,
  endDate: Date,
): void {
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

  // Replace the header row's "timestamp" with "timestamp_MT" to indicate timezone
  const csvWithTzHeader = csv.replace(/^timestamp,/, "timestamp_MT,");

  // Trigger browser download — prepend UTF-8 BOM so Excel reads special chars correctly
  const blob = new Blob(["\uFEFF" + csvWithTzHeader], {
    type: "text/csv;charset=utf-8;",
  });
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const pad = (n: number) => String(n).padStart(2, "0");
  const startStr = `${startDate.toISOString().split("T")[0]}_${pad(startDate.getHours())}${pad(startDate.getMinutes())}`;
  const endStr = `${endDate.toISOString().split("T")[0]}_${pad(endDate.getHours())}${pad(endDate.getMinutes())}`;
  link.href = blobUrl;
  link.download = `readings_${startStr}_to_${endStr}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(blobUrl);
}
