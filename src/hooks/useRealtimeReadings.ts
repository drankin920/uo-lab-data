import { useState, useEffect, useCallback } from "react";
import {
  collection,
  query,
  orderBy,
  limit,
  where,
  getDocs,
  onSnapshot,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

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

  // Real-time listener for the latest reading (Firestore onSnapshot)
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

  // Fetch historical data from Firestore
  const fetchHistoricalData = useCallback(async () => {
    try {
      let start: Date;
      let end: Date;
      let mode: "raw" | "hourly";

      if (timeRange === "custom") {
        if (!customStart || !customEnd) return;
        start = customStart;
        end = customEnd;

        // Use hourly mode if custom range spans more than 3 days
        const spanMs = customEnd.getTime() - customStart.getTime();
        mode = spanMs > 3 * 24 * 60 * 60 * 1000 ? "hourly" : "raw";
      } else {
        const dates = getTimeRangeDates(timeRange);
        start = dates.start;
        end = dates.end;

        // 24h uses raw data; 7d and 30d use hourly aggregates
        mode = timeRange === "24h" ? "raw" : "hourly";
      }

      const startTs = Timestamp.fromDate(start);
      const endTs = Timestamp.fromDate(end);

      if (mode === "hourly") {
        // Query readings_hourly collection
        const q = query(
          collection(db, "readings_hourly"),
          where("hour_start", ">=", startTs),
          where("hour_start", "<", endTs),
          orderBy("hour_start", "asc")
        );
        const snapshot = await getDocs(q);

        const readings: HourlyReading[] = snapshot.docs.map((doc) => {
          const data = doc.data();
          return {
            id: doc.id,
            device_id: data.device_id || "esp32-lab-01",
            temp_avg: data.temp_avg,
            temp_min: data.temp_min,
            temp_max: data.temp_max,
            pressure_avg: data.pressure_avg,
            pressure_min: data.pressure_min,
            pressure_max: data.pressure_max,
            reading_count: data.reading_count,
            hour_start: data.hour_start?.toDate() || new Date(),
            hour_end: data.hour_end?.toDate() || new Date(),
          };
        });

        setHourlyReadings(readings);
        setHistoricalReadings([]);
      } else {
        // Query raw readings collection
        const q = query(
          collection(db, "readings"),
          where("timestamp", ">=", startTs),
          where("timestamp", "<", endTs),
          orderBy("timestamp", "asc")
        );
        const snapshot = await getDocs(q);

        const readings: RawReading[] = snapshot.docs.map((doc) => {
          const data = doc.data();
          return {
            id: doc.id,
            device_id: data.device_id || "esp32-lab-01",
            temperature: data.temperature,
            pressure: data.pressure,
            unit_temp: data.unit_temp || "Celsius",
            unit_pressure: data.unit_pressure || "mmHg",
            timestamp: data.timestamp?.toDate() || new Date(),
          };
        });

        setHistoricalReadings(readings);
        setHourlyReadings([]);
      }
    } catch (err) {
      console.error("Error fetching historical data from Firestore:", err);
      setError(
        err instanceof Error ? err.message : "Failed to fetch historical data"
      );
    }
  }, [timeRange, customStart, customEnd]);

  useEffect(() => {
    fetchHistoricalData();
  }, [fetchHistoricalData]);

  // Auto-refresh historical data periodically on 24h view (every 30 seconds)
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
