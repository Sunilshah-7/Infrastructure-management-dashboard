"use client";

import { useEffect, useMemo, useState } from "react";
import type * as React from "react";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type MetricCardProps = {
  animateValue?: boolean;
  children?: React.ReactNode;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  isLoading?: boolean;
  label: string;
  tone: string;
  trend?: {
    direction: "down" | "flat" | "up";
    label: string;
    positive?: boolean;
  };
  value: string;
};

function getNumericParts(value: string) {
  const match = /^(?<prefix>[^\d-]*)(?<number>-?\d[\d,]*(?:\.\d+)?)(?<suffix>.*)$/.exec(value);

  if (!match?.groups) {
    return null;
  }

  const rawNumber = match.groups.number;
  if (!rawNumber) {
    return null;
  }

  const numericValue = Number(rawNumber.replaceAll(",", ""));

  if (Number.isNaN(numericValue)) {
    return null;
  }

  return {
    decimals: rawNumber.includes(".") ? rawNumber.split(".")[1]?.length ?? 0 : 0,
    number: numericValue,
    prefix: match.groups.prefix,
    suffix: match.groups.suffix,
    usesGrouping: rawNumber.includes(","),
  };
}

function AnimatedMetricValue({ isActive = false, value }: { isActive?: boolean; value: string }) {
  const parts = useMemo(() => getNumericParts(value), [value]);
  const [displayValue, setDisplayValue] = useState(value);

  useEffect(() => {
    if (!isActive || !parts || !window.requestAnimationFrame) {
      return;
    }

    const prefersReducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReducedMotion) {
      const animationFrame = window.requestAnimationFrame(() => setDisplayValue(value));

      return () => window.cancelAnimationFrame(animationFrame);
    }

    let animationFrame = 0;
    let startTime: number | undefined;
    const duration = 900;
    const formatter = new Intl.NumberFormat("en-US", {
      maximumFractionDigits: parts.decimals,
      minimumFractionDigits: parts.decimals,
      useGrouping: parts.usesGrouping,
    });

    const tick = (timestamp: number) => {
      startTime ??= timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const easedProgress = 1 - (1 - progress) ** 3;
      const nextValue = parts.number * easedProgress;

      setDisplayValue(`${parts.prefix}${formatter.format(nextValue)}${parts.suffix}`);

      if (progress < 1) {
        animationFrame = window.requestAnimationFrame(tick);
      } else {
        setDisplayValue(value);
      }
    };

    animationFrame = window.requestAnimationFrame(tick);

    return () => window.cancelAnimationFrame(animationFrame);
  }, [isActive, parts, value]);

  return (
    <span aria-label={value} className="inline-block min-w-[3ch]">
      {isActive && parts ? displayValue : value}
    </span>
  );
}

function MetricCard({
  animateValue,
  children,
  description,
  icon: Icon,
  isLoading,
  label,
  tone,
  trend,
  value,
}: MetricCardProps) {
  const TrendIcon =
    trend?.direction === "down" ? TrendingDown : trend?.direction === "flat" ? Minus : TrendingUp;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className={cn("size-4", tone)} />
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <>
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-4 w-32" />
          </>
        ) : (
          <>
            <div className="text-2xl font-semibold tabular-nums">
              <AnimatedMetricValue isActive={animateValue} value={value} />
            </div>
            <div className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              {trend ? (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 font-medium",
                    trend.positive
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-muted-foreground",
                  )}
                >
                  <TrendIcon className="size-3.5" />
                  {trend.label}
                </span>
              ) : null}
              <span className="text-muted-foreground">{description}</span>
            </div>
          </>
        )}
        {children}
      </CardContent>
    </Card>
  );
}

export { MetricCard };
export type { MetricCardProps };
