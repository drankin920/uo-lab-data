import { useCallback, useState } from "react";
import Papa from "papaparse";
import {
  convertPressure,
  convertTemperature,
  type PressureUnit,
  type TemperatureUnit,
} from "@/lib/units";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

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
        const start = startDate.toISOString();
        const end = endDate.toISOString();

        // Fetch raw readings from Pi server API
        const url = `${API_URL}/api/readings?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&mode=raw`;
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(`API error: ${response.status} ${response.statusText}`);
        }

        const json = await response.json();
        const data = json.data || [];

        if (data.length === 0) {
          setError("No data available for the selected date range");
          setIsExporting(false);
          return;
        }

        // Convert units client-side (supports all dashboard units)
        const rows: ExportRow[] = data.map(
          (row: {
            timestamp: string;
            temperature: number;
            pressure: number;
            device_id: string;
          }) => ({
            timestamp: row.timestamp,
            temperature: convertTemperature(row.temperature, temperatureUnit),
            pressure: convertPressure(row.pressure, pressureUnit),
            unit_temp: temperatureUnit,
            unit_pressure: pressureUnit,
            device_id: row.device_id || "esp32-lab-01",
          })
        );

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

        // Trigger browser download — prepend UTF-8 BOM so Excel reads °/special chars correctly
        const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
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
