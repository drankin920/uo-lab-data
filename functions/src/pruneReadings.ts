import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";

const db = admin.firestore();

/**
 * Runs daily at 2:00 AM UTC.
 * Deletes raw `readings` older than 48 hours and
 * `readings_hourly` aggregates older than 31 days.
 *
 * Why 48 hours for raw data (not 24)?
 * - The 24h chart needs a full 24 hours of raw data at any time.
 * - The aggregation function runs hourly — the extra 24-hour buffer
 *   ensures no raw data is deleted before it has been aggregated.
 */
export const pruneOldReadings = onSchedule(
  {
    schedule: "0 2 * * *",
    timeZone: "UTC",
    retryCount: 3,
  },
  async () => {
    const now = new Date();

    // Delete raw readings older than 48 hours
    const rawCutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    await deleteOldDocuments("readings", rawCutoff, "timestamp");

    // Delete hourly aggregates older than 31 days
    const hourlyCutoff = new Date(
      now.getTime() - 31 * 24 * 60 * 60 * 1000
    );
    await deleteOldDocuments("readings_hourly", hourlyCutoff, "hour_start");
  }
);

/**
 * Deletes all documents in `collectionName` where `timestampField` < `cutoffDate`.
 * Processes in batches of 500 (Firestore batch limit).
 */
async function deleteOldDocuments(
  collectionName: string,
  cutoffDate: Date,
  timestampField: string
): Promise<void> {
  const cutoffTimestamp = admin.firestore.Timestamp.fromDate(cutoffDate);

  let totalDeleted = 0;
  let hasMore = true;

  while (hasMore) {
    const snapshot = await db
      .collection(collectionName)
      .where(timestampField, "<", cutoffTimestamp)
      .limit(500)
      .get();

    if (snapshot.empty) {
      hasMore = false;
      break;
    }

    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();

    totalDeleted += snapshot.size;
    console.log(
      `Deleted batch of ${snapshot.size} from ${collectionName}`
    );

    // If we got fewer than 500, we've processed everything
    if (snapshot.size < 500) {
      hasMore = false;
    }
  }

  console.log(
    `Pruned ${totalDeleted} documents from ${collectionName} (cutoff: ${cutoffDate.toISOString()})`
  );
}
