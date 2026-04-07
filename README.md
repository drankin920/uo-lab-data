# UO Lab Pulse

Real-time temperature and pressure dashboard for a single ESP32 sensor device. Public link — no authentication required.

**Live dashboard:** https://uo-lab-pulse.web.app

## Architecture

```
ESP32 (every 5s)
    POST JSON → http://<Pi-LAN-IP>:3001/api/readings
    ↓
Raspberry Pi 5 (Node.js + Express + SQLite)
    ├── Stores every reading in SQLite (permanent)
    ├── Forwards to Firestore (for real-time onSnapshot listener)
    └── Serves REST API on port 3001
        ├── GET /api/readings?start=...&end=...&mode=raw|hourly
        ├── GET /api/readings/latest
        ├── GET /api/readings/stats
        └── GET /api/readings/export?start=...&end=...&pressureUnit=...&tempUnit=...
    ↓ (via Cloudflare Tunnel)
React Dashboard (uo-lab-pulse.web.app)
    ├── Firestore onSnapshot → latest reading (real-time)
    └── fetch() → Pi API for historical data + CSV export
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite |
| UI | Shadcn UI + Tailwind CSS |
| Charts | Recharts |
| Real-time | Firebase Firestore (`onSnapshot` for latest reading) |
| Hosting | Firebase Hosting (free CDN + SSL) |
| Server | Node.js + Express + TypeScript (runs on Raspberry Pi) |
| Database | SQLite via better-sqlite3 (permanent storage on Pi) |
| Tunnel | Cloudflare Tunnel (free, exposes Pi API to public dashboard) |
| Device | ESP32 + Arduino (C++) |
| Sensors | MAX6675 thermocouple + analog pressure sensor |
| Display | Waveshare 2.9" e-Paper V2 |

## Project Structure

```
src/                              — React dashboard
  pages/Index.tsx                 — Main dashboard layout
  components/
    SensorCard.tsx                — Real-time metric card (temp/pressure)
    SensorChart.tsx               — Recharts time-series visualization
  hooks/
    useRealtimeReadings.ts        — Firestore real-time + Pi API historical
    useExportCSV.ts               — CSV export via Pi API
  lib/
    firebase.ts                   — Firebase initialization
    units.ts                      — Unit conversion (pressure + temperature)

server/                           — Pi server (Node.js + Express + SQLite)
  src/
    index.ts                      — Express app entry point
    db.ts                         — SQLite schema + queries
    routes/readings.ts            — REST API endpoints
    services/firestore.ts         — Firebase Admin SDK forwarding
    services/csv.ts               — Server-side CSV generation
  .env.example                    — Configuration template
  uo-lab-pulse.service            — systemd service file

esp32/esp32_sensor/               — ESP32 firmware
  esp32_sensor.ino                — Main firmware (sensors, WiFi, display, HTTP POST)
  DEV_Config.h/.cpp               — E-paper GPIO/SPI config
  EPD_2in9_V2.h/.cpp              — E-paper driver
  GUI_Paint.h/.cpp                — Drawing library
  fonts, Debug, ImageData         — Support files

wall_display_PT_code/             — Original e-paper code (reference only)
```

## Setup & Deployment

### Prerequisites

- Node.js 18+ (20 LTS recommended)
- Firebase CLI: `npm install -g firebase-tools`
- Arduino IDE (for ESP32 firmware)
- A Raspberry Pi (Pi 5 4GB recommended) with Raspberry Pi OS
- A Cloudflare account (free tier)

### 1. Dashboard (local development)

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env.local
# Fill in Firebase credentials (see .env.example for details)
# Set VITE_API_URL to http://localhost:3001 for local dev

# Run dev server
npm run dev
# Opens at http://localhost:5173
```

### 2. Pi Server Setup

On the Raspberry Pi:

```bash
# Flash Raspberry Pi OS Lite (64-bit) to microSD
# Connect Pi to network via Ethernet
# SSH in or use terminal directly

# Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs

# Clone the repo
git clone https://github.com/JobXcel-AI/uo-lab-pulse.git
cd uo-lab-pulse/server

# Install dependencies & build
npm install
npm run build

# Configure environment
cp .env.example .env
# Edit .env:
#   PORT=3001
#   HOST=0.0.0.0
#   GOOGLE_APPLICATION_CREDENTIALS=/home/pi/uo-lab-pulse/server/uo-lab-pulse-service-account.json
```

**Firebase service account key:**
1. Go to Firebase Console → Project Settings → Service Accounts
2. Click "Generate New Private Key"
3. Save the JSON file to the Pi as `server/uo-lab-pulse-service-account.json`

**Set up systemd service (auto-start on boot):**

```bash
sudo cp uo-lab-pulse.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable uo-lab-pulse
sudo systemctl start uo-lab-pulse

# Check status
sudo systemctl status uo-lab-pulse

# View logs
sudo journalctl -u uo-lab-pulse -f
```

**Find the Pi's IP address** (needed for ESP32 config):

```bash
hostname -I
# e.g., 192.168.1.100
```

### 3. Cloudflare Tunnel Setup

The Cloudflare Tunnel exposes the Pi's API (port 3001) to the public internet so the hosted dashboard can reach it.

```bash
# Install cloudflared on the Pi
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb

# Authenticate with Cloudflare
cloudflared tunnel login

# Create a tunnel
cloudflared tunnel create uo-lab-pulse

# Configure the tunnel — create ~/.cloudflared/config.yml:
# tunnel: <TUNNEL_ID>
# credentials-file: /home/pi/.cloudflared/<TUNNEL_ID>.json
#
# ingress:
#   - hostname: uo-lab-api.yourdomain.com
#     service: http://localhost:3001
#   - service: http_status:404

# Add DNS route
cloudflared tunnel route dns uo-lab-pulse uo-lab-api.yourdomain.com

# Install as a systemd service
sudo cloudflared service install

# Start the tunnel
sudo systemctl start cloudflared
sudo systemctl enable cloudflared
```

After this, the Pi API is available at `https://uo-lab-api.yourdomain.com`.

### 4. ESP32 Firmware

1. Open `esp32/esp32_sensor/esp32_sensor.ino` in Arduino IDE
2. Install required libraries via Library Manager:
   - **ArduinoJson** (by Benoit Blanchon, v7+)
   - **MAX6675** (by Adafruit)
3. Update configuration at the top of the file:
   - `EAP_IDENTITY` — your eduroam email
   - `EAP_PASSWORD` — your eduroam password (**change this from the default!**)
   - `PI_SERVER_URL` — `http://<Pi-LAN-IP>:3001/api/readings` (use the IP from step 2)
4. Select board: **ESP32 Dev Module**
5. Upload to ESP32

**Pin wiring:**

| Component | GPIO |
|-----------|------|
| MAX6675 CLK | 32 |
| MAX6675 CS | 33 |
| MAX6675 DO | 25 |
| Pressure sensor | 34 (analog) |
| Stop button | 35 |
| EPD SCK | 13 |
| EPD MOSI | 14 |
| EPD CS | 15 |
| EPD RST | 26 |
| EPD DC | 27 |
| EPD BUSY | 25 |

> **Note:** GPIO 25 is shared between MAX6675 DO and EPD BUSY. This works because both are input-only pins used at different times.

### 5. Deploy Dashboard to Production

Once the Cloudflare Tunnel is set up and you have the public URL:

```bash
# Update .env.local with the tunnel URL
# VITE_API_URL=https://uo-lab-api.yourdomain.com

# Build
npm run build

# Deploy to Firebase Hosting
firebase deploy --only hosting
```

The dashboard will be live at https://uo-lab-pulse.web.app.

## Dashboard Features

- **Real-time display** — latest temperature & pressure update within seconds
- **Unit selectors** — pressure (mmHg, atm, psi, kPa, hPa, inHg, bar) and temperature (°C, °F, K, °R)
- **Historical charts** — 24h (raw data), 7d/30d (hourly aggregates), custom date range
- **Y-axis controls** — manual min/max with reset button; auto-resets when units change
- **CSV export** — date range picker with "Last 24 Hours" quick-select, UTF-8 BOM for Excel compatibility
- **E-paper display** — shows current readings and WiFi status on the physical device

## Pi Server API

All endpoints are prefixed with `/api/readings`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/` | Receive reading from ESP32 (stores in SQLite, forwards to Firestore) |
| `GET` | `/?start=...&end=...&mode=raw\|hourly` | Query historical readings by time range |
| `GET` | `/latest` | Get the most recent reading |
| `GET` | `/stats` | Get total count and optional range count |
| `GET` | `/export?start=...&end=...&pressureUnit=...&tempUnit=...` | Download CSV file |

## Data Storage

- **SQLite on Pi** — permanent storage. At 1 reading/5s: ~17,280 rows/day, ~1.7 MB/day, ~6.3 GB over 10 years.
- **Firestore** — only holds readings for real-time `onSnapshot` delivery to the dashboard. Not the source of truth for historical data.
- **No Cloud Functions needed** — the Pi server handles aggregation on-the-fly via SQL `GROUP BY`.

## Hardware

Recommended Raspberry Pi setup (~$97 total):
- Raspberry Pi 5 (4GB) — ~$60
- 128GB microSD card — ~$12
- USB-C power supply (5V/5A) — ~$15 (any USB-C charger with sufficient wattage works)
- Ethernet cable (for reliable campus network connection)

## Security Notes

- Dashboard is **intentionally public** (no auth). No sensitive data is exposed.
- ESP32 posts to the Pi over the **local network** (LAN only, not exposed to internet).
- Pi server validates POST payload fields before storing.
- Firestore security rules allow public reads; writes are restricted.
- **Do not commit passwords** to the repository. The `.ino` file contains an `EAP_PASSWORD` placeholder that must be changed.
