import { useMemo, useState } from "react";
import { useRealtimeReadings } from "@/hooks/useRealtimeReadings";
import { useExportCSV } from "@/hooks/useExportCSV";
import { SensorCard } from "@/components/SensorCard";
import { SensorChart } from "@/components/SensorChart";
import type { ChartDataPoint } from "@/components/SensorChart";
import type { TimeRange } from "@/hooks/useRealtimeReadings";
import {
  Gauge,
  Thermometer,
  Wifi,
  WifiOff,
  Download,
  Loader2,
  CalendarIcon,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  convertPressure,
  convertTemperature,
  pressureDecimals,
  temperatureDecimals,
  PRESSURE_UNITS,
  TEMPERATURE_UNITS,
  type PressureUnit,
  type TemperatureUnit,
} from "@/lib/units";
import { format } from "date-fns";

const TIME_RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "custom", label: "Custom" },
];

function formatTime(date: Date, range: TimeRange): string {
  if (range === "24h") {
    return date.toLocaleTimeString("en-US", { hour12: false });
  }
  if (range === "7d") {
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      hour12: false,
    });
  }
  if (range === "custom") {
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

const Index = () => {
  const {
    currentReading,
    historicalReadings,
    hourlyReadings,
    isLoading,
    error,
    timeRange,
    setTimeRange,
    customStart,
    customEnd,
    setCustomRange,
  } = useRealtimeReadings();

  const { exportCSV, isExporting } = useExportCSV();

  // Unit selection state
  const [pressureUnit, setPressureUnitRaw] = useState<PressureUnit>("mmHg");
  const [temperatureUnit, setTemperatureUnitRaw] = useState<TemperatureUnit>("°C");

  // Export date range state
  const [exportStartDate, setExportStartDate] = useState<Date | undefined>(undefined);
  const [exportEndDate, setExportEndDate] = useState<Date | undefined>(undefined);
  const [exportStartTime, setExportStartTime] = useState("00:00");
  const [exportEndTime, setExportEndTime] = useState("23:59");
  const [exportPopoverOpen, setExportPopoverOpen] = useState(false);

  // Custom chart date range state
  const [chartStartDate, setChartStartDate] = useState<Date | undefined>(undefined);
  const [chartEndDate, setChartEndDate] = useState<Date | undefined>(undefined);
  const [chartStartTime, setChartStartTime] = useState("00:00");
  const [chartEndTime, setChartEndTime] = useState("23:59");

  const handleApplyCustomRange = () => {
    if (!chartStartDate || !chartEndDate) return;
    const [startH, startM] = parseTime(chartStartTime);
    const start = new Date(chartStartDate);
    start.setHours(startH, startM, 0, 0);
    const [endH, endM] = parseTime(chartEndTime);
    const end = new Date(chartEndDate);
    end.setHours(endH, endM, 59, 999);
    setCustomRange(start, end);
  };

  // Y-axis override state
  const [pressureYMin, setPressureYMin] = useState<string>("");
  const [pressureYMax, setPressureYMax] = useState<string>("");
  const [tempYMin, setTempYMin] = useState<string>("");
  const [tempYMax, setTempYMax] = useState<string>("");

  // Wrap unit setters to reset Y-axis when units change
  const setPressureUnit = (u: PressureUnit) => {
    setPressureUnitRaw(u);
    setPressureYMin("");
    setPressureYMax("");
  };
  const setTemperatureUnit = (u: TemperatureUnit) => {
    setTemperatureUnitRaw(u);
    setTempYMin("");
    setTempYMax("");
  };

  const pressureYDomain: [number | "auto", number | "auto"] = [
    pressureYMin !== "" && !isNaN(Number(pressureYMin)) ? Number(pressureYMin) : "auto",
    pressureYMax !== "" && !isNaN(Number(pressureYMax)) ? Number(pressureYMax) : "auto",
  ];
  const tempYDomain: [number | "auto", number | "auto"] = [
    tempYMin !== "" && !isNaN(Number(tempYMin)) ? Number(tempYMin) : "auto",
    tempYMax !== "" && !isNaN(Number(tempYMax)) ? Number(tempYMax) : "auto",
  ];

  const handleExportLast24h = () => {
    const end = new Date();
    const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    setExportPopoverOpen(false);
    exportCSV(pressureUnit, temperatureUnit, start, end);
  };

  /** Parse "HH:MM" string, clamping to valid ranges. Returns [hour, minute]. */
  const parseTime = (val: string): [number, number] => {
    const parts = val.split(":");
    const h = Math.max(0, Math.min(23, parseInt(parts[0] || "0", 10) || 0));
    const m = Math.max(0, Math.min(59, parseInt(parts[1] || "0", 10) || 0));
    return [h, m];
  };

  /** Normalise a free-typed time string to "HH:MM" on blur */
  const normalizeTime = (val: string): string => {
    const [h, m] = parseTime(val);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };

  const handleExportDateRange = () => {
    if (!exportStartDate || !exportEndDate) return;
    const [startH, startM] = parseTime(exportStartTime);
    const start = new Date(exportStartDate);
    start.setHours(startH, startM, 0, 0);
    const [endH, endM] = parseTime(exportEndTime);
    const end = new Date(exportEndDate);
    end.setHours(endH, endM, 59, 999);
    setExportPopoverOpen(false);
    exportCSV(pressureUnit, temperatureUnit, start, end);
  };

  const isConnected = currentReading != null;

  const pDecimals = pressureDecimals(pressureUnit);
  const tDecimals = temperatureDecimals(temperatureUnit);

  // Build chart data with unit conversion applied
  const pressureChartData: ChartDataPoint[] = useMemo(() => {
    if (timeRange === "24h" || timeRange === "custom") {
      return historicalReadings.map((r) => ({
        time: formatTime(r.timestamp, timeRange),
        timestamp: r.timestamp.getTime(),
        value: convertPressure(r.pressure, pressureUnit),
      }));
    }
    return hourlyReadings.map((r) => ({
      time: formatTime(r.hour_start, timeRange),
      timestamp: r.hour_start.getTime(),
      value: convertPressure(r.pressure_avg, pressureUnit),
      min: convertPressure(r.pressure_min, pressureUnit),
      max: convertPressure(r.pressure_max, pressureUnit),
    }));
  }, [historicalReadings, hourlyReadings, timeRange, pressureUnit]);

  const temperatureChartData: ChartDataPoint[] = useMemo(() => {
    if (timeRange === "24h" || timeRange === "custom") {
      return historicalReadings.map((r) => ({
        time: formatTime(r.timestamp, timeRange),
        timestamp: r.timestamp.getTime(),
        value: convertTemperature(r.temperature, temperatureUnit),
      }));
    }
    return hourlyReadings.map((r) => ({
      time: formatTime(r.hour_start, timeRange),
      timestamp: r.hour_start.getTime(),
      value: convertTemperature(r.temp_avg, temperatureUnit),
      min: convertTemperature(r.temp_min, temperatureUnit),
      max: convertTemperature(r.temp_max, temperatureUnit),
    }));
  }, [historicalReadings, hourlyReadings, timeRange, temperatureUnit]);

  // Compute previous reading for trend indicator (convert to selected units)
  const previousReading =
    historicalReadings.length >= 2
      ? historicalReadings[historicalReadings.length - 2]
      : null;

  const currentPressure = currentReading
    ? convertPressure(currentReading.pressure, pressureUnit)
    : null;
  const previousPressure = previousReading
    ? convertPressure(previousReading.pressure, pressureUnit)
    : null;
  const currentTemperature = currentReading
    ? convertTemperature(currentReading.temperature, temperatureUnit)
    : null;
  const previousTemperature = previousReading
    ? convertTemperature(previousReading.temperature, temperatureUnit)
    : null;

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-3">
          <WifiOff className="h-10 w-10 text-destructive mx-auto" />
          <h2 className="text-lg font-semibold text-foreground">
            Connection Error
          </h2>
          <p className="text-sm text-muted-foreground max-w-md">{error}</p>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="container flex items-center justify-between h-16 px-4 md:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Gauge className="h-4 w-4" />
            </div>
            <h1 className="text-lg font-semibold text-foreground tracking-tight">
              UO Lab Data
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <Popover open={exportPopoverOpen} onOpenChange={setExportPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isExporting}
                  className="gap-2"
                >
                  {isExporting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  Export CSV
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[320px] p-0">
                <div className="p-4 space-y-4">
                  {/* Quick export: Last 24 Hours */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full gap-2 justify-start"
                    onClick={handleExportLast24h}
                    disabled={isExporting}
                  >
                    <Clock className="h-3.5 w-3.5" />
                    Last 24 Hours
                  </Button>

                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-popover px-2 text-muted-foreground">
                        or pick a date &amp; time range
                      </span>
                    </div>
                  </div>

                  {/* Start date & time */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      Start
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full justify-start text-left font-normal"
                          >
                            <CalendarIcon className="h-3.5 w-3.5 mr-2 shrink-0" />
                            <span className="truncate">
                              {exportStartDate
                                ? format(exportStartDate, "MMM d, yyyy")
                                : "Date"}
                            </span>
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={exportStartDate}
                            onSelect={setExportStartDate}
                            disabled={(date) => date > new Date()}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                      <div className="relative">
                        <Clock className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="00:00"
                          value={exportStartTime}
                          onChange={(e) => setExportStartTime(e.target.value)}
                          onBlur={(e) => setExportStartTime(normalizeTime(e.target.value))}
                          className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-2 text-sm tabular-nums ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        />
                      </div>
                    </div>
                  </div>

                  {/* End date & time */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      End
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full justify-start text-left font-normal"
                          >
                            <CalendarIcon className="h-3.5 w-3.5 mr-2 shrink-0" />
                            <span className="truncate">
                              {exportEndDate
                                ? format(exportEndDate, "MMM d, yyyy")
                                : "Date"}
                            </span>
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={exportEndDate}
                            onSelect={setExportEndDate}
                            disabled={(date) =>
                              date > new Date() ||
                              (exportStartDate ? date < exportStartDate : false)
                            }
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                      <div className="relative">
                        <Clock className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="23:59"
                          value={exportEndTime}
                          onChange={(e) => setExportEndTime(e.target.value)}
                          onBlur={(e) => setExportEndTime(normalizeTime(e.target.value))}
                          className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-2 text-sm tabular-nums ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Export button for date range */}
                  <Button
                    size="sm"
                    className="w-full gap-2"
                    onClick={handleExportDateRange}
                    disabled={!exportStartDate || !exportEndDate || isExporting}
                  >
                    {isExporting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                    Export Range
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
            <div className="flex items-center gap-1.5 text-sm">
              {isConnected ? (
                <>
                  <Wifi className="h-4 w-4 text-accent" />
                  <span className="text-accent font-medium hidden sm:inline">
                    ESP32 Connected
                  </span>
                </>
              ) : (
                <>
                  <WifiOff className="h-4 w-4 text-destructive" />
                  <span className="text-destructive font-medium hidden sm:inline">
                    {isLoading ? "Connecting..." : "No Data"}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="container px-4 md:px-6 py-6 space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Sensor Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <SensorCard
                label="Pressure"
                value={
                  currentPressure != null
                    ? currentPressure.toFixed(pDecimals)
                    : "\u2014"
                }
                unit={pressureUnit}
                variant="pressure"
                icon={<Gauge className="h-5 w-5" />}
                lastUpdated={currentReading?.timestamp}
                previousValue={previousPressure}
                currentValue={currentPressure}
                unitSelector={
                  <Select
                    value={pressureUnit}
                    onValueChange={(v) => setPressureUnit(v as PressureUnit)}
                  >
                    <SelectTrigger className="h-7 w-[80px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRESSURE_UNITS.map((u) => (
                        <SelectItem key={u.value} value={u.value}>
                          {u.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                }
              />
              <SensorCard
                label="Temperature"
                value={
                  currentTemperature != null
                    ? currentTemperature.toFixed(tDecimals)
                    : "\u2014"
                }
                unit={temperatureUnit}
                variant="temperature"
                icon={<Thermometer className="h-5 w-5" />}
                lastUpdated={currentReading?.timestamp}
                previousValue={previousTemperature}
                currentValue={currentTemperature}
                unitSelector={
                  <Select
                    value={temperatureUnit}
                    onValueChange={(v) =>
                      setTemperatureUnit(v as TemperatureUnit)
                    }
                  >
                    <SelectTrigger className="h-7 w-[68px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TEMPERATURE_UNITS.map((u) => (
                        <SelectItem key={u.value} value={u.value}>
                          {u.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                }
              />
            </div>

            {/* Time Range Picker */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground">
                  Historical Data
                </h2>
                <div className="flex items-center gap-1 rounded-lg border bg-card p-1">
                  {TIME_RANGE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => {
                        if (option.value !== "custom") {
                          setTimeRange(option.value);
                        } else if (chartStartDate && chartEndDate) {
                          handleApplyCustomRange();
                        } else {
                          setTimeRange("custom");
                        }
                      }}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                        timeRange === option.value
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom date range row (visible when Custom is selected) */}
              {timeRange === "custom" && (
                <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">
                      Start
                    </label>
                    <div className="flex items-center gap-1.5">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-[150px] justify-start text-left font-normal text-xs"
                          >
                            <CalendarIcon className="h-3.5 w-3.5 mr-1.5" />
                            {chartStartDate
                              ? format(chartStartDate, "MMM d, yyyy")
                              : "Start date"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={chartStartDate}
                            onSelect={setChartStartDate}
                            disabled={(date) => date > new Date()}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                      <div className="relative">
                        <Clock className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="00:00"
                          value={chartStartTime}
                          onChange={(e) => setChartStartTime(e.target.value)}
                          onBlur={(e) => setChartStartTime(normalizeTime(e.target.value))}
                          className="h-9 w-[80px] rounded-md border border-input bg-background pl-7 pr-2 text-xs tabular-nums ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">
                      End
                    </label>
                    <div className="flex items-center gap-1.5">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-[150px] justify-start text-left font-normal text-xs"
                          >
                            <CalendarIcon className="h-3.5 w-3.5 mr-1.5" />
                            {chartEndDate
                              ? format(chartEndDate, "MMM d, yyyy")
                              : "End date"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={chartEndDate}
                            onSelect={setChartEndDate}
                            disabled={(date) =>
                              date > new Date() ||
                              (chartStartDate ? date < chartStartDate : false)
                            }
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                      <div className="relative">
                        <Clock className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="23:59"
                          value={chartEndTime}
                          onChange={(e) => setChartEndTime(e.target.value)}
                          onBlur={(e) => setChartEndTime(normalizeTime(e.target.value))}
                          className="h-9 w-[80px] rounded-md border border-input bg-background pl-7 pr-2 text-xs tabular-nums ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        />
                      </div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={handleApplyCustomRange}
                    disabled={!chartStartDate || !chartEndDate}
                    className="text-xs"
                  >
                    Apply
                  </Button>
                  {customStart && customEnd && (
                    <span className="text-xs text-muted-foreground ml-auto self-center">
                      Showing {format(customStart, "MMM d, yyyy HH:mm")} &ndash;{" "}
                      {format(customEnd, "MMM d, yyyy HH:mm")}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 gap-6">
              <SensorChart
                data={pressureChartData}
                label="Pressure"
                unit={pressureUnit}
                color="hsl(var(--chart-pressure))"
                timeRange={timeRange}
                yDomain={pressureYDomain}
                yMin={pressureYMin}
                yMax={pressureYMax}
                onYMinChange={setPressureYMin}
                onYMaxChange={setPressureYMax}
              />
              <SensorChart
                data={temperatureChartData}
                label="Temperature"
                unit={temperatureUnit}
                color="hsl(var(--chart-temperature))"
                timeRange={timeRange}
                yDomain={tempYDomain}
                yMin={tempYMin}
                yMax={tempYMax}
                onYMinChange={setTempYMin}
                onYMaxChange={setTempYMax}
              />
            </div>

            {/* Footer info */}
            <p className="text-xs text-muted-foreground text-center pt-2">
              ESP32 sensor data &bull; Updates every 5s &bull; Real-time via
              Firebase
            </p>
          </>
        )}
      </main>
    </div>
  );
};

export default Index;
