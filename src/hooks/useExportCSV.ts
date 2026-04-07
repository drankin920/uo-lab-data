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
        const startTs = Timestamp.fromDate(startDate);
        const endTs = Timestamp.fromDate(endDate);

        // Determine whether to use raw readings or hourly aggregates.
        // Raw readings are only available for the last 48 hours (pruned after that).
        // For ranges older than 48h or spanning more than 48h, use hourly data.
        const now = new Date();
        const cutoff48h = new Date(now.getTime() - 48 * 60 * 60 * 1000);
        const useHourly = startDate < cutoff48h;

        if (useHourly) {
          // Query hourly aggregates from readings_hourly
          const q = query(
            collection(db, "readings_hourly"),
            where("hour_start", ">=", startTs),
            where("hour_start", "<", endTs),
            orderBy("hour_start", "asc")
          );
          const snapshot = await getDocs(q);

          if (snapshot.empty) {
            setError("No data available for the selected date range");
            setIsExporting(false);
            return;
          }

          const rows: ExportRow[] = snapshot.docs.map((doc) => {
            const data = doc.data();
            const ts = (data.hour_start as Timestamp).toDate().toISOString();
            return {
              timestamp: ts,
              temperature: convertTemperature(data.temp_avg, temperatureUnit),
              pressure: convertPressure(data.pressure_avg, pressureUnit),
              unit_temp: temperatureUnit,
              unit_pressure: pressureUnit,
              device_id: data.device_id || "esp32-lab-01",
            };
          });

          generateAndDownloadCSV(rows, startDate, endDate);
        } else {
          // Query raw readings
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
            const ts = (data.timestamp as Timestamp).toDate().toISOString();
            return {
              timestamp: ts,
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

  // Trigger browser download — prepend UTF-8 BOM so Excel reads special chars correctly
  const blob = new Blob(["\uFEFF" + csv], {
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
