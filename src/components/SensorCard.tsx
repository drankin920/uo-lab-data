import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface SensorCardProps {
  label: string;
  value: string;
  unit: string;
  variant: "pressure" | "temperature";
  icon: React.ReactNode;
  lastUpdated?: Date | null;
  previousValue?: number | null;
  currentValue?: number | null;
  unitSelector?: React.ReactNode;
}

function getRelativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function SensorCard({
  label,
  value,
  unit,
  variant,
  icon,
  lastUpdated,
  previousValue,
  currentValue,
  unitSelector,
}: SensorCardProps) {
  const trend =
    previousValue != null && currentValue != null
      ? currentValue > previousValue
        ? "up"
        : currentValue < previousValue
          ? "down"
          : "flat"
      : null;

  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-5 shadow-sm transition-shadow hover:shadow-md"
      )}
    >
      <div className="flex items-center gap-3 mb-3">
        <div
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-lg",
            variant === "pressure"
              ? "bg-chart-pressure/10 text-chart-pressure"
              : "bg-chart-temperature/10 text-chart-temperature"
          )}
        >
          {icon}
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-medium text-muted-foreground">
            {label}
          </span>
          {lastUpdated && (
            <span className="text-xs text-muted-foreground/70">
              {getRelativeTime(lastUpdated)}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-3xl font-semibold font-mono tracking-tight text-foreground">
          {value}
        </span>
        {unitSelector ? (
          unitSelector
        ) : (
          <span className="text-sm text-muted-foreground">{unit}</span>
        )}
        {trend && (
          <span className="ml-auto">
            {trend === "up" && (
              <TrendingUp className="h-4 w-4 text-chart-temperature" />
            )}
            {trend === "down" && (
              <TrendingDown className="h-4 w-4 text-chart-pressure" />
            )}
            {trend === "flat" && (
              <Minus className="h-4 w-4 text-muted-foreground" />
            )}
          </span>
        )}
      </div>
    </div>
  );
}
