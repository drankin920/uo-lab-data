import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";

const db = admin.firestore();

/**
 * Runs every hour at minute 5 (e.g., 1:05, 2:05, ...).
 * Aggregates all raw readings from the previous hour into a single
 * summary document in the `readings_hourly` collection.
 *
 * This reduces Firestore reads by ~99.8% for 7d and 30d chart views.
 */
export const aggregateHourlyReadings = onSchedule(
  {
    schedule: "5 * * * *",
    timeZone: "UTC",
    retryCount: 3,
  },
  async () => {
    const now = new Date();

    // Calculate the hour window: e.g., if now is 14:05, aggregate 13:00–14:00
    const hourEnd = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours(),
      0,
      0
    );
    const hourStart = new Date(hourEnd.getTime() - 60 * 60 * 1000);

    const hourStartTimestamp = admin.firestore.Timestamp.fromDate(hourStart);
    const hourEndTimestamp = admin.firestore.Timestamp.fromDate(hourEnd);

    // Check if we already aggregated this hour (idempotency guard)
    const existingCheck = await db
      .collection("readings_hourly")
      .where("hour_start", "==", hourStartTimestamp)
      .limit(1)
      .get();

    if (!existingCheck.empty) {
      console.log(
        `Hourly aggregate already exists for ${hourStart.toISOString()}, skipping`
      );
      return;
    }

    // Query raw readings for this hour window
    const snapshot = await db
      .collection("readings")
      .where("timestamp", ">=", hourStartTimestamp)
      .where("timestamp", "<", hourEndTimestamp)
      .get();

    if (snapshot.empty) {
      console.log(
        `No readings found for hour window ${hourStart.toISOString()} – ${hourEnd.toISOString()}`
      );
      return;
    }

    let tempSum = 0;
    let tempMin = Infinity;
    let tempMax = -Infinity;
    let pressSum = 0;
    let pressMin = Infinity;
    let pressMax = -Infinity;
    let count = 0;

    snapshot.forEach((doc) => {
      const data = doc.data();
      const temp = data.temperature as number;
      const press = data.pressure as number;

      tempSum += temp;
      tempMin = Math.min(tempMin, temp);
      tempMax = Math.max(tempMax, temp);
      pressSum += press;
      pressMin = Math.min(pressMin, press);
      pressMax = Math.max(pressMax, press);
      count++;
    });

    await db.collection("readings_hourly").add({
      device_id: "esp32-lab-01",
      temp_avg: tempSum / count,
      temp_min: tempMin,
      temp_max: tempMax,
      pressure_avg: pressSum / count,
      pressure_min: pressMin,
      pressure_max: pressMax,
      reading_count: count,
      hour_start: hourStartTimestamp,
      hour_end: hourEndTimestamp,
    });

    console.log(
      `Aggregated ${count} readings for ${hourStart.toISOString()} – ${hourEnd.toISOString()}`
    );
  }
);
