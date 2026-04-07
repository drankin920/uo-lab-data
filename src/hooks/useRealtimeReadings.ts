import { useState, useEffect, useCallback } from "react";
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

export interface RawReading {
  id: string;
  device_id: string;
  temperature: number;
  pressure: number;
  unit_temp: string;
  unit_pressure: string;
  timestamp: Date;
}

export interface HourlyReading {
  id: string;
  device_id: string;
  temp_avg: number;
  temp_min: number;
  temp_max: number;
  pressure_avg: number;
  pressure_min: number;
  pressure_max: number;
  reading_count: number;
  hour_start: Date;
  hour_end: Date;
}

export type TimeRange = "24h" | "7d" | "30d" | "custom";

interface UseRealtimeReadingsReturn {
  currentReading: RawReading | null;
  historicalReadings: RawReading[];
  hourlyReadings: HourlyReading[];
  isLoading: boolean;
  error: string | null;
  timeRange: TimeRange;
  setTimeRange: (range: TimeRange) => void;
  customStart: Date | null;
  customEnd: Date | null;
  setCustomRange: (start: Date, end: Date) => void;
}

function getTimeRangeDates(range: TimeRange): { start: Date; end: Date } {
  const now = new Date();
  const end = now;
  let start: Date;
  switch (range) {
    case "24h":
      start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      break;
    case "7d":
      start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case "30d":
      start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    default:
      start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }
  return { start, end };
}

export function useRealtimeReadings(): UseRealtimeReadingsReturn {
  const [currentReading, setCurrentReading] = useState<RawReading | null>(null);
  const [historicalReadings, setHistoricalReadings] = useState<RawReading[]>([]);
  const [hourlyReadings, setHourlyReadings] = useState<HourlyReading[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>("24h");
  const [customStart, setCustomStart] = useState<Date | null>(null);
  const [customEnd, setCustomEnd] = useState<Date | null>(null);

  const setCustomRange = useCallback((start: Date, end: Date) => {
    setCustomStart(start);
    setCustomEnd(end);
    setTimeRange("custom");
  }, []);

  // Real-time listener for the latest reading (Firestore onSnapshot — stays real-time)
  useEffect(() => {
    const q = query(
      collection(db, "readings"),
      orderBy("timestamp", "desc"),
      limit(1)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        if (!snapshot.empty) {
          const doc = snapshot.docs[0];
          const data = doc.data();
          setCurrentReading({
            id: doc.id,
            device_id: data.device_id,
            temperature: data.temperature,
            pressure: data.pressure,
            unit_temp: data.unit_temp || "Celsius",
            unit_pressure: data.unit_pressure || "mmHg",
            timestamp: data.timestamp?.toDate() || new Date(),
          });
        }
        setIsLoading(false);
      },
      (err) => {
        console.error("Firestore real-time listener error:", err);
        setError(err.message);
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  // Fetch historical data from Pi server API
  const fetchHistoricalData = useCallback(async () => {
    try {
      let start: string;
      let end: string;
      let mode: "raw" | "hourly";

      if (timeRange === "custom") {
        if (!customStart || !customEnd) return;
        start = customStart.toISOString();
        end = customEnd.toISOString();

        // Use hourly mode if custom range spans more than 3 days
        const spanMs = customEnd.getTime() - customStart.getTime();
        mode = spanMs > 3 * 24 * 60 * 60 * 1000 ? "hourly" : "raw";
      } else {
        const dates = getTimeRangeDates(timeRange);
        start = dates.start.toISOString();
        end = dates.end.toISOString();

        // 24h uses raw data; 7d and 30d use hourly aggregates
        mode = timeRange === "24h" ? "raw" : "hourly";
      }

      const url = `${API_URL}/api/readings?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&mode=${mode}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      const json = await response.json();

      if (mode === "hourly") {
        // Map Pi API hourly aggregates to HourlyReading[]
        const readings: HourlyReading[] = (json.data || []).map(
          (row: {
            hour: string;
            temp_avg: number;
            temp_min: number;
            temp_max: number;
            pressure_avg: number;
            pressure_min: number;
            pressure_max: number;
            reading_count: number;
          }, index: number) => ({
            id: `hourly-${index}`,
            device_id: "esp32-lab-01",
            temp_avg: row.temp_avg,
            temp_min: row.temp_min,
            temp_max: row.temp_max,
            pressure_avg: row.pressure_avg,
            pressure_min: row.pressure_min,
            pressure_max: row.pressure_max,
            reading_count: row.reading_count,
            hour_start: new Date(row.hour),
            hour_end: new Date(new Date(row.hour).getTime() + 60 * 60 * 1000),
          })
        );
        setHourlyReadings(readings);
        setHistoricalReadings([]);
      } else {
        // Map Pi API raw readings to RawReading[]
        const readings: RawReading[] = (json.data || []).map(
          (row: {
            id: number;
            device_id: string;
            temperature: number;
            pressure: number;
            unit_temp: string;
            unit_pressure: string;
            timestamp: string;
          }) => ({
            id: String(row.id),
            device_id: row.device_id,
            temperature: row.temperature,
            pressure: row.pressure,
            unit_temp: row.unit_temp || "Celsius",
            unit_pressure: row.unit_pressure || "mmHg",
            timestamp: new Date(row.timestamp),
          })
        );
        setHistoricalReadings(readings);
        setHourlyReadings([]);
      }
    } catch (err) {
      console.error("Error fetching historical data from Pi API:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch historical data");
    }
  }, [timeRange, customStart, customEnd]);

  useEffect(() => {
    fetchHistoricalData();
  }, [fetchHistoricalData]);

  // Auto-refresh historical data periodically on 24h view (every 30 seconds)
  // so the chart stays relatively current without relying on Firestore onSnapshot
  useEffect(() => {
    if (timeRange !== "24h") return;

    const interval = setInterval(() => {
      fetchHistoricalData();
    }, 30_000);

    return () => clearInterval(interval);
  }, [timeRange, fetchHistoricalData]);

  return {
    currentReading,
    historicalReadings,
    hourlyReadings,
    isLoading,
    error,
    timeRange,
    setTimeRange,
    customStart,
    customEnd,
    setCustomRange,
  };
}
