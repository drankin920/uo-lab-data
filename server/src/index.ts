import "dotenv/config";
import express from "express";
import cors from "cors";
import readingsRouter from "./routes/readings.js";
import { initFirestore } from "./services/firestore.js";
import { getTotalCount, closeDb } from "./db.js";

const PORT = parseInt(process.env.PORT || "3001", 10);
const HOST = process.env.HOST || "0.0.0.0"; // Listen on all interfaces (needed for LAN access)

// ─── CORS ────────────────────────────────────────────────────────
// Allow the Firebase-hosted dashboard and local development
const ALLOWED_ORIGINS = [
  "https://uo-lab-pulse.web.app",
  "https://uo-lab-pulse.firebaseapp.com",
  "http://localhost:5173", // Vite dev server
  "http://localhost:8080",
];

// Also allow any origin specified in env (e.g., Cloudflare Tunnel domain)
if (process.env.CORS_ORIGIN) {
  ALLOWED_ORIGINS.push(process.env.CORS_ORIGIN);
}

const app = express();

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (curl, ESP32, server-to-server)
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
  })
);

app.use(express.json());

// ─── Routes ──────────────────────────────────────────────────────

app.use("/api/readings", readingsRouter);

// Health check endpoint
app.get("/health", (_req, res) => {
  const count = getTotalCount();
  res.json({
    status: "ok",
    uptime: process.uptime(),
    readings_stored: count,
  });
});

// ─── Initialize & Start ─────────────────────────────────────────

// Initialize Firestore forwarding (optional — server works without it)
initFirestore();

const server = app.listen(PORT, HOST, () => {
  console.log(`[server] UO Lab Pulse API listening on http://${HOST}:${PORT}`);
  console.log(`[server] Readings stored: ${getTotalCount()}`);
});

// ─── Graceful Shutdown ──────────────────────────────────────────

function shutdown(signal: string) {
  console.log(`\n[server] Received ${signal}, shutting down...`);
  server.close(() => {
    closeDb();
    console.log("[server] Goodbye.");
    process.exit(0);
  });
  // Force exit after 5s if graceful shutdown hangs
  setTimeout(() => process.exit(1), 5000);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
