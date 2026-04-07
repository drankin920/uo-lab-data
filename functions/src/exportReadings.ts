import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";

const db = admin.firestore();

/**
 * Runs daily at 1:30 AM UTC (30 minutes before the prune function).
 * Exports all raw readings from the previous complete calendar day (UTC)
 * to a CSV file in the default Firebase Storage bucket.
 *
 * File path: readings/YYYY/MM/YYYY-MM-DD.csv
 *
 * This preserves the full-resolution raw data indefinitely in cheap
 * cloud storage, even after Firestore pruning deletes it after 48 hours.
 */
export const exportDailyReadings = onSchedule(
  {
    schedule: "30 1 * * *",
    timeZone: "UTC",
    retryCount: 3,
  },
  async () => {
    const now = new Date();

    // Calculate the previous complete calendar day (UTC)
    const dayEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );
    const dayStart = new Date(dayEnd.getTime() - 24 * 60 * 60 * 1000);

    const year = dayStart.getUTCFullYear().toString();
    const month = String(dayStart.getUTCMonth() + 1).padStart(2, "0");
    const day = String(dayStart.getUTCDate()).padStart(2, "0");
    const dateStr = `${year}-${month}-${day}`;
    const filePath = `readings/${year}/${month}/${dateStr}.csv`;

    // Idempotency guard: skip if file already exists
    const bucket = admin.storage().bucket();
    const file = bucket.file(filePath);
    const [exists] = await file.exists();

    if (exists) {
      console.log(`Export already exists at ${filePath}, skipping`);
      return;
    }

    // Query all raw readings for the previous day
    const dayStartTimestamp = admin.firestore.Timestamp.fromDate(dayStart);
    const dayEndTimestamp = admin.firestore.Timestamp.fromDate(dayEnd);

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

    // Build CSV content
    const header = "timestamp,device_id,temperature,pressure,unit_temp,unit_pressure";
    const rows: string[] = [header];

    snapshot.forEach((doc) => {
      const data = doc.data();
      const ts = (data.timestamp as admin.firestore.Timestamp)
        .toDate()
        .toISOString();
      const deviceId = data.device_id as string;
      const temp = data.temperature as number;
      const pressure = data.pressure as number;
      const unitTemp = data.unit_temp as string;
      const unitPressure = data.unit_pressure as string;

      rows.push(`${ts},${deviceId},${temp},${pressure},${unitTemp},${unitPressure}`);
    });

    const csvContent = rows.join("\n") + "\n";

    // Upload to Cloud Storage
    await file.save(csvContent, {
      contentType: "text/csv",
      metadata: {
        customMetadata: {
          date: dateStr,
          readingCount: String(snapshot.size),
          exportedAt: new Date().toISOString(),
        },
      },
    });

    console.log(
      `Exported ${snapshot.size} readings for ${dateStr} to ${filePath}`
    );
  }
);
