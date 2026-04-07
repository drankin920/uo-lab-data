// Unit conversion utilities for UO Lab Pulse dashboard
// Raw data from ESP32 is in mmHg (pressure) and °C (temperature)

// ─── Pressure ───────────────────────────────────────────────────

export type PressureUnit = "mmHg" | "atm" | "psi" | "kPa" | "hPa" | "inHg" | "bar";

export const PRESSURE_UNITS: { value: PressureUnit; label: string }[] = [
  { value: "mmHg", label: "mmHg" },
  { value: "atm", label: "atm" },
  { value: "psi", label: "psi" },
  { value: "kPa", label: "kPa" },
  { value: "hPa", label: "hPa" },
  { value: "inHg", label: "inHg" },
  { value: "bar", label: "bar" },
];

/** Convert pressure from mmHg to the target unit */
export function convertPressure(mmHg: number, to: PressureUnit): number {
  switch (to) {
    case "mmHg":
      return mmHg;
    case "atm":
      return mmHg / 760;
    case "psi":
      return mmHg * 0.0193368;
    case "kPa":
      return mmHg * 0.133322;
    case "hPa":
      return mmHg * 1.33322;
    case "inHg":
      return mmHg * 0.0393701;
    case "bar":
      return mmHg * 0.00133322;
  }
}

/** Number of decimal places to display for each pressure unit */
export function pressureDecimals(unit: PressureUnit): number {
  switch (unit) {
    case "mmHg":
      return 1;
    case "atm":
      return 4;
    case "psi":
      return 2;
    case "kPa":
      return 2;
    case "hPa":
      return 1;
    case "inHg":
      return 2;
    case "bar":
      return 4;
  }
}

// ─── Temperature ────────────────────────────────────────────────

export type TemperatureUnit = "°C" | "°F" | "K" | "°R";

export const TEMPERATURE_UNITS: { value: TemperatureUnit; label: string }[] = [
  { value: "°C", label: "°C" },
  { value: "°F", label: "°F" },
  { value: "K", label: "K" },
  { value: "°R", label: "°R" },
];

/** Convert temperature from Celsius to the target unit */
export function convertTemperature(celsius: number, to: TemperatureUnit): number {
  switch (to) {
    case "°C":
      return celsius;
    case "°F":
      return celsius * 9 / 5 + 32;
    case "K":
      return celsius + 273.15;
    case "°R":
      return (celsius + 273.15) * 9 / 5;
  }
}

/** Number of decimal places to display for each temperature unit */
export function temperatureDecimals(unit: TemperatureUnit): number {
  switch (unit) {
    case "°C":
      return 1;
    case "°F":
      return 1;
    case "K":
      return 1;
    case "°R":
      return 1;
  }
}
