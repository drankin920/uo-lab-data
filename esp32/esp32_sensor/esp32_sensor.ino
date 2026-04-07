/**
 * UO Lab Pulse — ESP32 Sensor Firmware
 *
 * Posts temperature and pressure readings to a local Raspberry Pi
 * server every 5 seconds via HTTP. The Pi stores data in SQLite
 * and forwards each reading to Firebase Firestore for real-time
 * dashboard updates.
 *
 * Hardware:
 *   - MAX6675 thermocouple (CLK=32, CS=33, DO=25)
 *   - Analog pressure sensor on GPIO 34 (with voltage divider)
 *   - Waveshare 2.9" e-Paper V2 (SCK=13, MOSI=14, CS=15, RST=26, DC=27, BUSY=25)
 *   - Stop button on GPIO 35
 *
 * Required Libraries (install via Arduino IDE Library Manager):
 *   - ArduinoJson (by Benoit Blanchon) v7+
 *   - max6675 (by Adafruit)
 *   - WiFi.h (built-in with ESP32 board package)
 *   - HTTPClient.h (built-in with ESP32 board package)
 *
 * E-Paper Display:
 *   Uses the Waveshare EPD library files from the wall_display_PT_code folder.
 *   These files must be in the same sketch folder or a library:
 *     DEV_Config.h/.cpp, EPD_2in9_V2.h/.cpp, GUI_Paint.h/.cpp, fonts, ImageData
 *
 * WiFi:
 *   Configured for eduroam (WPA2-Enterprise EAP-PEAP/MSCHAPv2).
 *   Edit EAP_IDENTITY and EAP_PASSWORD below.
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <time.h>
#include "esp_wpa2.h"
#include "max6675.h"

// E-Paper display includes
#include "DEV_Config.h"
#include "EPD_2in9_V2.h"
#include "GUI_Paint.h"

// ─── CONFIGURATION ──────────────────────────────────────────────

// eduroam WPA2-Enterprise credentials
const char* WIFI_SSID      = "eduroam";
const char* EAP_IDENTITY   = "YOUR_EMAIL@university.edu";    // <-- your university email
const char* EAP_PASSWORD   = "YOUR_PASSWORD";       // <-- enter your password here

// Raspberry Pi server URL (LAN address — ESP32 and Pi on same network)
// Change this to your Pi's IP address after setting it up
const char* PI_SERVER_URL = "http://192.168.1.100:3001/api/readings";

// Device identity
const char* DEVICE_ID = "esp32-lab-01";

// Posting interval in milliseconds (5 seconds)
const unsigned long POST_INTERVAL_MS = 5000;

// ─── SENSOR PIN CONFIGURATION ───────────────────────────────────

// MAX6675 thermocouple
const int THERMO_CLK = 32;
const int THERMO_CS  = 33;
const int THERMO_DO  = 25;

// Analog pressure sensor
const int PRES_SENSOR = 34;

// Stop button (press to put device to sleep)
const int STOP_BUTTON = 35;

// Voltage divider ratio: R2 / (R1 + R2)
static const float VOLTAGE_DIVIDER = 3.3 / (1.68 + 3.3);

// ─── GLOBALS ────────────────────────────────────────────────────

MAX6675 thermocouple(THERMO_CLK, THERMO_CS, THERMO_DO);

unsigned long lastPostTime = 0;
int consecutiveFailures = 0;
const int MAX_FAILURES_BEFORE_RESTART = 20;

// E-Paper display image buffer
UBYTE *BlackImage = NULL;

// ─── SENSOR READING ─────────────────────────────────────────────

bool readSensor(float &temperature, float &pressure) {
  // Read temperature from MAX6675 thermocouple (returns Celsius)
  temperature = thermocouple.readCelsius();

  // MAX6675 returns NAN or very high values on read error
  if (isnan(temperature) || temperature > 500.0) {
    Serial.println("MAX6675 read error");
    return false;
  }

  // Read pressure from analog sensor
  int adc_val = analogRead(PRES_SENSOR);
  float mes_voltage = adc_val * (3.3 / 4095.0);
  float sensor_voltage = mes_voltage / VOLTAGE_DIVIDER;

  // Convert voltage to pressure in mmHg
  // Sensor range: 800–1060 mbar over 0–5V, then convert mbar*100 Pa to mmHg
  pressure = (800.0 + (sensor_voltage * (1060.0 - 800.0) / 5.0)) * 100.0 * 760.0 / 101325.0;

  return true;
}

// ─── E-PAPER DISPLAY ────────────────────────────────────────────

void initDisplay() {
  DEV_Module_Init();

  Serial.println("e-Paper Init and Clear...");
  EPD_2IN9_V2_Init();
  EPD_2IN9_V2_Clear();
  DEV_Delay_ms(500);

  // Allocate image buffer for 4-grayscale mode
  UWORD imageSize = ((EPD_2IN9_V2_WIDTH % 4 == 0)
    ? (EPD_2IN9_V2_WIDTH / 4)
    : (EPD_2IN9_V2_WIDTH / 4 + 1)) * EPD_2IN9_V2_HEIGHT;

  BlackImage = (UBYTE *)malloc(imageSize);
  if (BlackImage == NULL) {
    Serial.println("Failed to allocate e-Paper image buffer!");
    return;
  }

  // Initialize 4-grayscale mode for partial refresh
  EPD_2IN9_V2_Gray4_Init();
  Paint_NewImage(BlackImage, EPD_2IN9_V2_WIDTH, EPD_2IN9_V2_HEIGHT, 270, WHITE);
  Paint_SetScale(4);
  Paint_Clear(WHITE);

  // Draw initial "connecting..." screen
  Paint_DrawString_EN(148, 13, "UO Lab Status", &Font16, WHITE, BLACK);
  Paint_DrawString_EN(148, 30, "Connecting...", &Font12, WHITE, BLACK);
  EPD_2IN9_V2_Display_Partial(BlackImage);

  Serial.println("e-Paper display initialized");
}

void updateDisplay(float temperature, float pressure, bool wifiConnected) {
  if (BlackImage == NULL) return;

  // Convert values to strings
  String presStr = String(pressure, 1);
  String tempStr = String(temperature, 1);

  // Clear and redraw
  Paint_Clear(WHITE);

  // Header
  Paint_DrawString_EN(148, 15, "UO Lab Status", &Font16, WHITE, BLACK);

  // Sensor values
  Paint_DrawString_EN(148, 30, "Pressure(mmHg):", &Font12, WHITE, BLACK);
  Paint_DrawString_EN(148, 50, "Temperature(C):", &Font12, WHITE, BLACK);
  Paint_DrawString_EN(253, 30, presStr.c_str(), &Font12, WHITE, BLACK);
  Paint_DrawString_EN(253, 50, tempStr.c_str(), &Font12, WHITE, BLACK);

  // WiFi status line
  if (wifiConnected) {
    Paint_DrawString_EN(148, 70, "WiFi: Connected", &Font12, WHITE, BLACK);
  } else {
    Paint_DrawString_EN(148, 70, "WiFi: Offline", &Font12, WHITE, BLACK);
  }

  // Partial refresh (fast, no full screen flash)
  EPD_2IN9_V2_Display_Partial(BlackImage);
}

void sleepDisplay() {
  if (BlackImage == NULL) return;

  // Clear screen before sleeping
  EPD_2IN9_V2_Init();
  EPD_2IN9_V2_Clear();
  EPD_2IN9_V2_Sleep();

  free(BlackImage);
  BlackImage = NULL;

  Serial.println("e-Paper display sleeping");
}

// ─── WIFI (eduroam WPA2-Enterprise) ─────────────────────────────

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  Serial.print("Connecting to eduroam");

  WiFi.disconnect(true);
  WiFi.mode(WIFI_STA);

  // Configure WPA2-Enterprise (EAP-PEAP with MSCHAPv2)
  esp_wifi_sta_wpa2_ent_set_identity((uint8_t*)EAP_IDENTITY, strlen(EAP_IDENTITY));
  esp_wifi_sta_wpa2_ent_set_username((uint8_t*)EAP_IDENTITY, strlen(EAP_IDENTITY));
  esp_wifi_sta_wpa2_ent_set_password((uint8_t*)EAP_PASSWORD, strlen(EAP_PASSWORD));
  esp_wifi_sta_wpa2_ent_enable();

  WiFi.begin(WIFI_SSID);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.print("WiFi connected. IP: ");
    Serial.println(WiFi.localIP());
    consecutiveFailures = 0;
  } else {
    Serial.println();
    Serial.println("WiFi connection failed!");
  }
}

// ─── POST TO PI SERVER ──────────────────────────────────────────

bool postToServer(float temperature, float pressure) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi not connected, skipping POST");
    return false;
  }

  HTTPClient http;
  http.begin(PI_SERVER_URL);
  http.addHeader("Content-Type", "application/json");

  // Build plain JSON payload (Pi server expects simple fields)
  JsonDocument doc;
  doc["device_id"] = DEVICE_ID;
  doc["temperature"] = temperature;
  doc["pressure"] = pressure;
  doc["unit_temp"] = "Celsius";
  doc["unit_pressure"] = "mmHg";

  // Include ISO 8601 timestamp from NTP-synced clock
  struct tm timeinfo;
  char timeBuf[30];
  if (getLocalTime(&timeinfo)) {
    strftime(timeBuf, sizeof(timeBuf), "%Y-%m-%dT%H:%M:%SZ", &timeinfo);
  } else {
    strcpy(timeBuf, "1970-01-01T00:00:00Z");
  }
  doc["timestamp"] = timeBuf;

  String payload;
  serializeJson(doc, payload);

  Serial.print("POST to Pi server... ");
  int httpCode = http.POST(payload);

  bool success = (httpCode == 200 || httpCode == 201);

  if (success) {
    Serial.println("OK (" + String(httpCode) + ")");
    consecutiveFailures = 0;
  } else {
    Serial.println("FAILED (" + String(httpCode) + ")");
    String response = http.getString();
    Serial.println("Response: " + response);
    consecutiveFailures++;
  }

  http.end();
  return success;
}

// ─── SETUP ──────────────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println();
  Serial.println("=== UO Lab Pulse — ESP32 Sensor ===");
  Serial.print("Device ID: ");
  Serial.println(DEVICE_ID);
  Serial.print("Post interval: ");
  Serial.print(POST_INTERVAL_MS);
  Serial.println("ms");
  Serial.println();

  // Initialize the e-Paper display first (shows "Connecting..." while WiFi connects)
  initDisplay();

  // MAX6675 needs a brief stabilization period after power-on
  delay(500);

  connectWiFi();

  // Sync NTP time (required for accurate timestamps)
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  Serial.print("Syncing NTP time");
  struct tm timeinfo;
  int ntpAttempts = 0;
  while (!getLocalTime(&timeinfo) && ntpAttempts < 20) {
    Serial.print(".");
    delay(500);
    ntpAttempts++;
  }
  Serial.println();
  if (ntpAttempts < 20) {
    Serial.println("NTP time synced");
  } else {
    Serial.println("NTP sync failed — timestamps may be inaccurate");
  }
}

// ─── LOOP ───────────────────────────────────────────────────────

void loop() {
  // Check stop button — clear display and enter deep sleep
  if (analogRead(STOP_BUTTON) * (3.3 / 4095.0) > 1.0) {
    Serial.println("Stop button pressed, shutting down...");
    sleepDisplay();
    esp_deep_sleep_start();
  }

  // Reconnect WiFi if dropped
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi disconnected, reconnecting...");
    connectWiFi();
  }

  // Safety: restart ESP32 after too many consecutive failures
  if (consecutiveFailures >= MAX_FAILURES_BEFORE_RESTART) {
    Serial.println("Too many failures, restarting ESP32...");
    ESP.restart();
  }

  unsigned long now = millis();
  if (now - lastPostTime >= POST_INTERVAL_MS) {
    lastPostTime = now;

    float temperature, pressure;

    if (readSensor(temperature, pressure)) {
      Serial.print("Temp: ");
      Serial.print(temperature, 2);
      Serial.print(" °C | Pressure: ");
      Serial.print(pressure, 2);
      Serial.println(" mmHg");

      // Update the e-Paper display with current values
      updateDisplay(temperature, pressure, WiFi.status() == WL_CONNECTED);

      // Post to Pi server (which stores in SQLite + forwards to Firestore)
      postToServer(temperature, pressure);
    } else {
      Serial.println("Sensor read failed, skipping this cycle");
    }
  }

  // Small delay to prevent watchdog timeout
  delay(10);
}
