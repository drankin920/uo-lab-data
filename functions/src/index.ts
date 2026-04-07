import * as admin from "firebase-admin";

admin.initializeApp();

export { aggregateHourlyReadings } from "./aggregateReadings";
export { pruneOldReadings } from "./pruneReadings";
