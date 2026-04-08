import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import { zonedTimeToUtc, utcToZonedTime, format } from "date-fns-tz";

const db = admin.firestore();
const TZ = "America/Denver";

/**
 * Runs daily at 00:30 America/Denver and exports the previous local calendar day
 * (local 00:00 -> next local 00:00). File path: readings/YYYY/MM/YYYY-MM-DD.csv
 */
export const exportDailyReadings = onSchedule(
  {
    schedule: "30 0 * * *", // 00:30 local
    timeZone: TZ,
    retryCount: 3,
  },
  async () => {
    const now = new Date();
    const nowInTz = utcToZonedTime(now, TZ);

    // Previous local calendar day
    const prevLocal = new Date(nowInTz);
    prevLocal.setDate(prevLocal.getDate() - 1);

    // Local date string for filename
    const dateStr = format(prevLocal, "yyyy-MM-dd", { timeZone: TZ });
    const year = dateStr.slice(0, 4);
    const month = dateStr.slice(5, 7);
    const filePath = `readings/${year}/${month}/${dateStr}.csv`;

    // Compute UTC instants corresponding to local midnight start/end
    const dayStartUtc = zonedTimeToUtc(`${dateStr}T00:00:00`, TZ);
    const dayEndUtc = new Date(dayStartUtc.getTime() + 24 * 60 * 60 * 1000);

    // Idempotency guard: skip if file already exists
    const bucket = admin.storage().bucket();
    const file = bucket.file(filePath);
    const [exists] = await file.exists();
    if (exists) {
      console.log(`Export already exists at ${filePath}, skipping`);
      return;
    }

    // Query Firestore with UTC instants matching the local-day window
    const dayStartTimestamp = admin.firestore.Timestamp.fromDate(dayStartUtc);
    const dayEndTimestamp = admin.firestore.Timestamp.fromDate(dayEndUtc);

    const snapshot = await db
      .collection("readings")
      .where("timestamp", ">=", dayStartTimestamp)
      .where("timestamp", "<", dayEndTimestamp)
      .orderBy("timestamp", "asc")
      .get();

    if (snapshot.empty) {
      console.log(`No readings found for ${dateStr}, skipping export`);
      return;
    }

    // Build CSV: include two timestamp columns (ISO with offset + human)
    const header = "timestamp_MT_ISO,timestamp_MT,device_id,temperature,pressure,unit_temp,unit_pressure";
    const rows: string[] = [header];

    snapshot.forEach((doc) => {
      const data = doc.data();
      const tsDate = (data.timestamp as admin.firestore.Timestamp).toDate();

      // Machine-friendly ISO with offset (e.g. 2026-04-08T00:05:00-06:00)
      const tsMtIso = format(tsDate, "yyyy-MM-dd'T'HH:mm:ssXXX", { timeZone: TZ });

      // Human-friendly local string with timezone abbreviation (e.g. 2026-04-08 00:05:00 MDT)
      const tsMtHuman = format(tsDate, "yyyy-MM-dd HH:mm:ss zzz", { timeZone: TZ });

      const deviceId = (data.device_id as string) ?? "esp32-lab-01";
      const temp = data.temperature as number;
      const pressure = data.pressure as number;
      const unitTemp = (data.unit_temp as string) ?? "Celsius";
      const unitPressure = (data.unit_pressure as string) ?? "hPa";

      // Escape CSV values if necessary (simple approach: wrap strings that contain comma)
      const row = [
        tsMtIso,
        tsMtHuman,
        deviceId,
        String(temp),
        String(pressure),
        unitTemp,
        unitPressure,
      ].map((v) => (String(v).includes(",") ? `"${String(v).replace(/"/g, '""')}"` : v)).join(",");

      rows.push(row);
    });

    const csvContent = rows.join("\n") + "\n";

    await file.save(csvContent, {
      contentType: "text/csv",
      metadata: {
        customMetadata: {
          date: dateStr, // local date
          readingCount: String(snapshot.size),
          exportedAt: new Date().toISOString(),
        },
      },
    });

    console.log(`Exported ${snapshot.size} readings for local date ${dateStr} to ${filePath}`);
  }
);
