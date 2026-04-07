// Firestore forwarding service
// Writes the latest reading to Firestore so the web dashboard can use
// its real-time onSnapshot listener for live updates.

import { initializeApp, cert, type ServiceAccount } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import fs from "node:fs";

let firestoreDb: FirebaseFirestore.Firestore | null = null;

/**
 * Initialize Firebase Admin SDK.
 * Expects GOOGLE_APPLICATION_CREDENTIALS env var pointing to the
 * service account JSON file, OR FIREBASE_SERVICE_ACCOUNT_JSON containing
 * the JSON string directly.
 */
export function initFirestore(): void {
  try {
    let credential;

    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      // Service account JSON passed directly (useful for Docker/CI)
      const serviceAccount = JSON.parse(
        process.env.FIREBASE_SERVICE_ACCOUNT_JSON
      ) as ServiceAccount;
      credential = cert(serviceAccount);
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      // Path to service account JSON file
      const raw = fs.readFileSync(
        process.env.GOOGLE_APPLICATION_CREDENTIALS,
        "utf-8"
      );
      const serviceAccount = JSON.parse(raw) as ServiceAccount;
      credential = cert(serviceAccount);
    } else {
      console.warn(
        "[firestore] No service account configured — Firestore forwarding disabled"
      );
      return;
    }

    initializeApp({ credential });
    firestoreDb = getFirestore();
    console.log("[firestore] Firebase Admin SDK initialized");
  } catch (err) {
    console.error("[firestore] Failed to initialize:", err);
  }
}

/**
 * Forward a reading to Firestore.
 * Uses a fixed document ID ("latest") so we only ever store one document
 * in Firestore, keeping it as a lightweight real-time relay.
 * Also creates a new document in "readings" for the onSnapshot listener
 * on the dashboard (which listens for the latest by timestamp).
 */
export async function forwardToFirestore(reading: {
  device_id: string;
  temperature: number;
  pressure: number;
  unit_temp: string;
  unit_pressure: string;
  timestamp: string;
}): Promise<void> {
  if (!firestoreDb) return;

  try {
    const firestoreTimestamp = Timestamp.fromDate(new Date(reading.timestamp));

    // Write to the "readings" collection (new document each time)
    // The dashboard's onSnapshot listener picks this up for real-time display
    await firestoreDb.collection("readings").add({
      device_id: reading.device_id,
      temperature: reading.temperature,
      pressure: reading.pressure,
      unit_temp: reading.unit_temp,
      unit_pressure: reading.unit_pressure,
      timestamp: firestoreTimestamp,
    });
  } catch (err) {
    // Log but don't crash — Firestore forwarding is best-effort
    console.error("[firestore] Failed to forward reading:", err);
  }
}
