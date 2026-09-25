"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  CircleAlert,
  Cpu,
  DollarSign,
  Gauge,
  Info,
  TriangleAlert,
  X,
} from "lucide-react";

import { MetricCard } from "@/components/dashboard/metric-card";
import { MockApiStatus } from "@/components/dashboard/mock-api-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "@/components/charts/dynamic-recharts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useBillingUsage,
  useDeployments,
  useGpuMetrics,
  useGpuSummary,
  useInferenceMetrics,
  useModelRegistry,
} from "@/hooks";
import { cn } from "@/lib/utils";
import type { BillingUsage, Deployment, GpuMetric, Model, TimeRange } from "@/types/api";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 1,
  notation: "compact",
  style: "currency",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

const gpuIntervals: Record<TimeRange, number> = {
  "24h": 30,
  "7d": 360,
  "30d": 1440,
};

const costBreakdownColors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-4)"];
const chartAnimation = {
  barDuration: 800,
  duration: 1100,
  pieDuration: 900,
};

const activeTrainingJobs = [
  {
    eta: "18 min",
    id: "train_4096",
    model: "Reflect LLM 70B",
    owner: "Maya Chen",
    progress: 78,
    stage: "Evaluation",
  },
  {
    eta: "42 min",
    id: "train_4097",
    model: "Atlas Vision 12B",
    owner: "Priya Nair",
    progress: 54,
    stage: "Fine-tuning",
  },
  {
    eta: "1h 12m",
    id: "train_4098",
    model: "Vector Embed 8B",
    owner: "Noah Kim",
    progress: 31,
    stage: "Data validation",
  },
];

type SystemAlert = {
  id: string;
  message: string;
  severity: "critical" | "info" | "warning";
  title: string;
};

const initialAlerts: SystemAlert[] = [
  {
    id: "alert_capacity",
    message: "Primary H100 pool is above 90% scheduled capacity.",
    severity: "critical",
    title: "GPU capacity pressure",
  },
  {
    id: "alert_training_queue",
    message: "Training queue latency is above the weekly baseline.",
    severity: "warning",
    title: "Training queue elevated",
  },
  {
    id: "alert_endpoints",
    message: "All production inference endpoints are healthy.",
    severity: "info",
    title: "Serving fleet healthy",
  },
];

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "--";
  }

  return `${Math.round(value)}%`;
}

function average(values: number[]) {
  if (!values.length) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function getGpuTrend(metrics: GpuMetric[] = []) {
  const midpoint = Math.floor(metrics.length / 2);
  const previousAverage = average(
    metrics.slice(0, midpoint).map((metric) => metric.utilizationPercent),
  );
  const currentAverage = average(
    metrics.slice(midpoint).map((metric) => metric.utilizationPercent),
  );

  return currentAverage - previousAverage;
}

function getModelDeploymentStatus(models: Model[] = []) {
  return models.reduce(
    (totals, model) => {
      const deployments = model.deployments.filter((deployment) =>
        ["production", "staging"].includes(deployment.environment),
      );

      deployments.forEach((deployment) => {
        if (deployment.status === "healthy") {
          totals.healthy += 1;
        } else if (deployment.status === "degraded") {
          totals.degraded += 1;
        } else if (deployment.status === "failed") {
          totals.failed += 1;
        }
      });

      return totals;
    },
    { degraded: 0, failed: 0, healthy: 0 },
  );
}

function getBudgetPercent(usage: BillingUsage | null | undefined) {
  if (!usage?.budgetUsd) {
    return 0;
  }

  return (usage.totalCostUsd / usage.budgetUsd) * 100;
}

function formatTimeLabel(timestamp: string, range: TimeRange = "24h") {
  const date = new Date(timestamp);

  if (range === "24h") {
    return timeFormatter.format(date);
  }

  return dateFormatter.format(date);
}

function getGpuUtilizationSeries(metrics: GpuMetric[] = [], range: TimeRange) {
  const utilizationByTimestamp = new Map<string, number[]>();

  metrics.forEach((metric) => {
    const values = utilizationByTimestamp.get(metric.timestamp) ?? [];

    values.push(metric.utilizationPercent);
    utilizationByTimestamp.set(metric.timestamp, values);
  });

  return Array.from(utilizationByTimestamp.entries()).map(([timestamp, values]) => ({
    label: formatTimeLabel(timestamp, range),
    utilization: Math.round(average(values)),
  }));
}

function getDeploymentActivity(deployments: Deployment[] = []) {
  const days = Array.from({ length: 14 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (13 - index));

    return date;
  });

  const deploymentsByDay = deployments.reduce((totals, deployment) => {
    const key = new Date(deployment.startedAt).toISOString().slice(0, 10);
    totals.set(key, (totals.get(key) ?? 0) + 1);

    return totals;
  }, new Map<string, number>());

  return days.map((date) => {
    const key = date.toISOString().slice(0, 10);

    return {
      date: dateFormatter.format(date),
      deployments: deploymentsByDay.get(key) ?? 0,
    };
  });
}

function getCostBreakdown(usage: BillingUsage | null | undefined) {
  return [
    { name: "Training", value: usage?.trainingCostUsd ?? 0 },
    { name: "Inference", value: usage?.inferenceCostUsd ?? 0 },
    { name: "Storage", value: usage?.storageCostUsd ?? 0 },
  ];
}

function formatRelativeTime(timestamp: string) {
  const startedAt = new Date(timestamp);
  const diffMs = Date.now() - startedAt.getTime();
  const diffMinutes = Math.max(1, Math.round(diffMs / 60_000));

  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);

  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  return `${Math.round(diffHours / 24)}d ago`;
}

function getDeploymentBadgeVariant(status: Deployment["status"]) {
  if (status === "failed" || status === "canceled") {
    return "destructive" as const;
  }

  if (status === "succeeded") {
    return "secondary" as const;
  }

  return "outline" as const;
}

function getAlertTone(severity: SystemAlert["severity"]) {
  if (severity === "critical") {
    return {
      className:
        "border-destructive/30 bg-destructive/10 text-destructive dark:border-destructive/40",
      icon: CircleAlert,
    };
  }

  if (severity === "warning") {
    return {
      className:
        "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100",
      icon: TriangleAlert,
    };
  }

  return {
    className:
      "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100",
    icon: Info,
  };
}

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);

    updatePreference();
    mediaQuery.addEventListener("change", updatePreference);

    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  return prefersReducedMotion;
}

function AnimatedProgressBar({
  className,
  value,
}: {
  className?: string;
  value: number;
}) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [displayValue, setDisplayValue] = useState(prefersReducedMotion ? value : 0);

  useEffect(() => {
    if (prefersReducedMotion) {
      return;
    }

    const animationFrame = window.requestAnimationFrame(() => setDisplayValue(value));

    return () => window.cancelAnimationFrame(animationFrame);
  }, [prefersReducedMotion, value]);

  return (
    <div
      className={cn(
        "h-full rounded-full transition-[width] duration-1000 ease-out motion-reduce:transition-none",
        className,
      )}
      style={{ width: `${prefersReducedMotion ? value : displayValue}%` }}
    />
  );
}

function CountUpNumber({
  suffix = "",
  value,
}: {
  suffix?: string;
  value: number;
}) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [displayValue, setDisplayValue] = useState(value);

  useEffect(() => {
    if (prefersReducedMotion) {
      return;
    }

    let animationFrame = 0;
    let startTime: number | undefined;
    const duration = 800;

    const tick = (timestamp: number) => {
      startTime ??= timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const easedProgress = 1 - (1 - progress) ** 3;

      setDisplayValue(Math.round(value * easedProgress));

      if (progress < 1) {
        animationFrame = window.requestAnimationFrame(tick);
      } else {
        setDisplayValue(value);
      }
    };

    animationFrame = window.requestAnimationFrame(tick);

    return () => window.cancelAnimationFrame(animationFrame);
  }, [prefersReducedMotion, value]);

  return (
    <span aria-label={`${value}${suffix}`} className="tabular-nums">
      {prefersReducedMotion ? value : displayValue}
      {suffix}
    </span>
  );
}

export default function DashboardPage() {
  const [gpuRange, setGpuRange] = useState<TimeRange>("24h");
  const [visibleAlerts, setVisibleAlerts] = useState(initialAlerts);
  const prefersReducedMotion = usePrefersReducedMotion();
  const isChartAnimationActive = !prefersReducedMotion;
  const gpuSummaryQuery = useGpuSummary();
  const gpuMetricsQuery = useGpuMetrics(gpuRange, gpuIntervals[gpuRange]);
  const inferenceMetricsQuery = useInferenceMetrics();
  const modelRegistryQuery = useModelRegistry({ limit: 100, status: "deployed" });
  const deploymentsQuery = useDeployments({ limit: 100 });
  const billingUsageQuery = useBillingUsage();

  const inferenceMetrics = inferenceMetricsQuery.data ?? [];
  const gpuTrend = getGpuTrend(gpuMetricsQuery.data?.metrics);
  const latestInferenceMetric = inferenceMetricsQuery.data?.at(-1);
  const previousInferenceMetric = inferenceMetricsQuery.data?.at(-2);
  const deployedModels = modelRegistryQuery.data?.data ?? [];
  const modelDeploymentStatus = getModelDeploymentStatus(deployedModels);
  const gpuUtilizationSeries = useMemo(
    () => getGpuUtilizationSeries(gpuMetricsQuery.data?.metrics ?? [], gpuRange),
    [gpuMetricsQuery.data?.metrics, gpuRange],
  );
  const deploymentActivity = useMemo(
    () => getDeploymentActivity(deploymentsQuery.data?.data ?? []),
    [deploymentsQuery.data?.data],
  );
  const costBreakdown = useMemo(
    () => getCostBreakdown(billingUsageQuery.data),
    [billingUsageQuery.data],
  );
  const recentDeployments = useMemo(() => {
    return [...(deploymentsQuery.data?.data ?? [])]
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, 5);
  }, [deploymentsQuery.data?.data]);
  const latencyDelta =
    latestInferenceMetric && previousInferenceMetric
      ? latestInferenceMetric.p95LatencyMs - previousInferenceMetric.p95LatencyMs
      : 0;
  const budgetPercent = getBudgetPercent(billingUsageQuery.data);
  const clampedBudgetPercent = Math.min(Math.max(budgetPercent, 0), 100);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Phase 3</Badge>
            <MockApiStatus />
          </div>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight">Cluster overview</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Live mock metrics for GPU capacity, model serving health, inference performance, and
            monthly platform spend.
          </p>
        </div>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          animateValue
          description="avg cluster load"
          icon={Gauge}
          isLoading={gpuSummaryQuery.isLoading}
          label="GPU Utilization"
          tone="text-primary"
          trend={{
            direction: gpuTrend >= 0 ? "up" : "down",
            label: `${gpuTrend >= 0 ? "+" : ""}${gpuTrend.toFixed(1)}% vs earlier`,
            positive: gpuTrend < 5,
          }}
          value={formatPercent(gpuSummaryQuery.data?.utilization)}
        />

        <MetricCard
          animateValue
          description="deployed models"
          icon={Cpu}
          isLoading={modelRegistryQuery.isLoading}
          label="Active Models"
          tone="text-emerald-600 dark:text-emerald-400"
          trend={{
            direction: modelDeploymentStatus.failed > 0 ? "up" : "flat",
            label:
              modelDeploymentStatus.failed > 0
                ? `${modelDeploymentStatus.failed} failed`
                : `${modelDeploymentStatus.healthy} healthy`,
            positive: modelDeploymentStatus.failed === 0,
          }}
          value={`${modelRegistryQuery.data?.meta.total ?? 0}`}
        >
          <div className="flex min-h-8 items-center gap-2 text-xs">
            <Badge className="h-6 rounded-md px-2" variant="secondary">
              <CountUpNumber value={modelDeploymentStatus.healthy} /> healthy
            </Badge>
            <Badge className="h-6 rounded-md px-2" variant="outline">
              <CountUpNumber value={modelDeploymentStatus.degraded} /> degraded
            </Badge>
          </div>
        </MetricCard>

        <MetricCard
          animateValue
          description="current p95"
          icon={Activity}
          isLoading={inferenceMetricsQuery.isLoading}
          label="Inference Latency (p95)"
          tone="text-amber-600 dark:text-amber-400"
          trend={{
            direction: latencyDelta <= 0 ? "down" : "up",
            label: `${latencyDelta >= 0 ? "+" : ""}${Math.round(latencyDelta)} ms`,
            positive: latencyDelta <= 0,
          }}
          value={
            latestInferenceMetric ? `${Math.round(latestInferenceMetric.p95LatencyMs)} ms` : "--"
          }
        >
          <ChartContainer
            className="h-12 w-full"
            config={{
              latency: {
                color: "var(--chart-3)",
                label: "p95 latency",
              },
            }}
            initialDimension={{ height: 48, width: 220 }}
          >
            <LineChart
              accessibilityLayer
              data={inferenceMetricsQuery.data ?? []}
              margin={{ bottom: 2, left: 0, right: 0, top: 2 }}
            >
              <XAxis dataKey="timestamp" hide />
              <YAxis domain={["dataMin - 20", "dataMax + 20"]} hide />
              <ChartTooltip content={<ChartTooltipContent hideLabel />} cursor={false} />
              <Line
                animationBegin={150}
                animationDuration={chartAnimation.duration}
                dataKey="p95LatencyMs"
                dot={false}
                isAnimationActive={isChartAnimationActive}
                name="latency"
                stroke="var(--color-latency)"
                strokeWidth={2}
                type="monotone"
              />
            </LineChart>
          </ChartContainer>
        </MetricCard>

        <MetricCard
          animateValue
          description={`${Math.round(budgetPercent)}% of budget`}
          icon={DollarSign}
          isLoading={billingUsageQuery.isLoading}
          label="Monthly Compute Cost"
          tone="text-rose-600 dark:text-rose-400"
          trend={{
            direction: budgetPercent > 85 ? "up" : "flat",
            label: billingUsageQuery.data
              ? `${currencyFormatter.format(billingUsageQuery.data.budgetUsd)} budget`
              : "--",
            positive: budgetPercent <= 85,
          }}
          value={
            billingUsageQuery.data
              ? currencyFormatter.format(billingUsageQuery.data.totalCostUsd)
              : "--"
          }
        >
          <div className="space-y-2">
            <div
              aria-label={`Monthly compute cost is ${Math.round(budgetPercent)} percent of budget`}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={Math.round(clampedBudgetPercent)}
              className="h-2 overflow-hidden rounded-full bg-muted"
              role="progressbar"
            >
              <AnimatedProgressBar
                className={budgetPercent > 85 ? "bg-rose-500" : "bg-emerald-500"}
                value={clampedBudgetPercent}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                Training {currencyFormatter.format(billingUsageQuery.data?.trainingCostUsd ?? 0)}
              </span>
              <span>
                Inference {currencyFormatter.format(billingUsageQuery.data?.inferenceCostUsd ?? 0)}
              </span>
            </div>
          </div>
        </MetricCard>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>GPU Utilization Over Time</CardTitle>
            <Tabs value={gpuRange} onValueChange={(value) => setGpuRange(value as TimeRange)}>
              <TabsList>
                <TabsTrigger value="24h">24h</TabsTrigger>
                <TabsTrigger value="7d">7d</TabsTrigger>
                <TabsTrigger value="30d">30d</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent>
            <ChartContainer
              className="h-72 w-full"
              config={{
                utilization: {
                  color: "var(--chart-1)",
                  label: "GPU utilization",
                },
              }}
            >
              <LineChart
                accessibilityLayer
                data={gpuUtilizationSeries}
                margin={{ bottom: 0, left: 0, right: 12, top: 12 }}
              >
                <CartesianGrid vertical={false} />
                <XAxis
                  axisLine={false}
                  dataKey="label"
                  minTickGap={28}
                  tickLine={false}
                  tickMargin={8}
                />
                <YAxis
                  axisLine={false}
                  domain={[0, 100]}
                  tickFormatter={(value) => `${value}%`}
                  tickLine={false}
                  tickMargin={8}
                  width={42}
                />
                <ChartTooltip content={<ChartTooltipContent />} cursor={false} />
                <Line
                  animationBegin={150}
                  animationDuration={chartAnimation.duration}
                  dataKey="utilization"
                  dot={false}
                  isAnimationActive={isChartAnimationActive}
                  name="utilization"
                  stroke="var(--color-utilization)"
                  strokeWidth={2.5}
                  type="monotone"
                />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Inference Latency Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer
              className="h-72 w-full"
              config={{
                p50LatencyMs: {
                  color: "var(--chart-2)",
                  label: "p50",
                },
                p95LatencyMs: {
                  color: "var(--chart-3)",
                  label: "p95",
                },
                p99LatencyMs: {
                  color: "var(--chart-4)",
                  label: "p99",
                },
              }}
            >
              <AreaChart
                accessibilityLayer
                data={inferenceMetrics.map((metric) => ({
                  ...metric,
                  label: formatTimeLabel(metric.timestamp),
                }))}
                margin={{ bottom: 0, left: 0, right: 12, top: 12 }}
              >
                <CartesianGrid vertical={false} />
                <XAxis
                  axisLine={false}
                  dataKey="label"
                  minTickGap={28}
                  tickLine={false}
                  tickMargin={8}
                />
                <YAxis
                  axisLine={false}
                  tickFormatter={(value) => `${value}ms`}
                  tickLine={false}
                  tickMargin={8}
                  width={52}
                />
                <ChartTooltip content={<ChartTooltipContent />} cursor={false} />
                <Area
                  animationBegin={300}
                  animationDuration={chartAnimation.duration}
                  dataKey="p99LatencyMs"
                  fill="var(--color-p99LatencyMs)"
                  fillOpacity={0.12}
                  isAnimationActive={isChartAnimationActive}
                  name="p99LatencyMs"
                  stroke="var(--color-p99LatencyMs)"
                  strokeWidth={1.5}
                  type="monotone"
                />
                <Area
                  animationBegin={180}
                  animationDuration={chartAnimation.duration}
                  dataKey="p95LatencyMs"
                  fill="var(--color-p95LatencyMs)"
                  fillOpacity={0.18}
                  isAnimationActive={isChartAnimationActive}
                  name="p95LatencyMs"
                  stroke="var(--color-p95LatencyMs)"
                  strokeWidth={1.5}
                  type="monotone"
                />
                <Area
                  animationBegin={60}
                  animationDuration={chartAnimation.duration}
                  dataKey="p50LatencyMs"
                  fill="var(--color-p50LatencyMs)"
                  fillOpacity={0.24}
                  isAnimationActive={isChartAnimationActive}
                  name="p50LatencyMs"
                  stroke="var(--color-p50LatencyMs)"
                  strokeWidth={2}
                  type="monotone"
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Model Deployment Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer
              className="h-72 w-full"
              config={{
                deployments: {
                  color: "var(--chart-2)",
                  label: "deployments",
                },
              }}
            >
              <BarChart
                accessibilityLayer
                data={deploymentActivity}
                margin={{ bottom: 0, left: 0, right: 12, top: 12 }}
              >
                <CartesianGrid vertical={false} />
                <XAxis
                  axisLine={false}
                  dataKey="date"
                  minTickGap={18}
                  tickLine={false}
                  tickMargin={8}
                />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tickMargin={8} />
                <ChartTooltip content={<ChartTooltipContent />} cursor={false} />
                <Bar
                  animationBegin={100}
                  animationDuration={chartAnimation.barDuration}
                  dataKey="deployments"
                  fill="var(--color-deployments)"
                  isAnimationActive={isChartAnimationActive}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cost Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer
              className="h-72 w-full"
              config={{
                Inference: {
                  color: "var(--chart-2)",
                  label: "Inference",
                },
                Storage: {
                  color: "var(--chart-4)",
                  label: "Storage",
                },
                Training: {
                  color: "var(--chart-1)",
                  label: "Training",
                },
              }}
            >
              <PieChart accessibilityLayer margin={{ bottom: 8, left: 8, right: 8, top: 8 }}>
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      hideLabel
                      formatter={(value, name) => (
                        <>
                          <span className="text-muted-foreground">{name}</span>
                          <span className="font-mono font-medium tabular-nums text-foreground">
                            {currencyFormatter.format(Number(value))}
                          </span>
                        </>
                      )}
                    />
                  }
                />
                <Pie
                  animationBegin={120}
                  animationDuration={chartAnimation.pieDuration}
                  data={costBreakdown}
                  dataKey="value"
                  innerRadius={58}
                  isAnimationActive={isChartAnimationActive}
                  nameKey="name"
                  outerRadius={96}
                  paddingAngle={3}
                >
                  {costBreakdown.map((entry, index) => (
                    <Cell key={entry.name} fill={costBreakdownColors[index]} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              {costBreakdown.map((item, index) => (
                <div key={item.name} className="flex items-center gap-2">
                  <span
                    className="size-2.5 rounded-sm"
                    style={{ backgroundColor: costBreakdownColors[index] }}
                  />
                  <span className="truncate text-muted-foreground">{item.name}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_1.35fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Active Training Jobs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {activeTrainingJobs.map((job) => (
              <div key={job.id} className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{job.model}</div>
                    <div className="text-xs text-muted-foreground">
                      {job.stage} by {job.owner}
                    </div>
                  </div>
                  <div className="text-right text-xs tabular-nums text-muted-foreground">
                    <div>
                      <CountUpNumber suffix="%" value={job.progress} />
                    </div>
                    <div>{job.eta}</div>
                  </div>
                </div>
                <div
                  aria-label={`${job.model} training progress`}
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={job.progress}
                  className="h-2 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                >
                  <AnimatedProgressBar className="bg-primary" value={job.progress} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Deployments</CardTitle>
          </CardHeader>
          <CardContent>
            <Table aria-label="Recent deployments">
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead>Environment</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Started</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentDeployments.map((deployment) => (
                  <TableRow key={deployment.id}>
                    <TableCell className="max-w-52 truncate font-medium">
                      {deployment.modelName}
                    </TableCell>
                    <TableCell className="capitalize">{deployment.environment}</TableCell>
                    <TableCell>
                      <Badge
                        className="rounded-md capitalize"
                        variant={getDeploymentBadgeVariant(deployment.status)}
                      >
                        {deployment.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {formatRelativeTime(deployment.startedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>System Alerts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {visibleAlerts.length ? (
              visibleAlerts.map((alert) => {
                const tone = getAlertTone(alert.severity);
                const AlertIcon = tone.icon;

                return (
                  <div
                    key={alert.id}
                    className={cn("rounded-md border p-3 text-sm", tone.className)}
                  >
                    <div className="flex gap-3">
                      <AlertIcon className="mt-0.5 size-4 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{alert.title}</div>
                        <div className="mt-1 text-xs opacity-85">{alert.message}</div>
                      </div>
                      <Button
                        aria-label={`Dismiss ${alert.title}`}
                        className="-mr-1 -mt-1"
                        onClick={() =>
                          setVisibleAlerts((currentAlerts) =>
                            currentAlerts.filter((item) => item.id !== alert.id),
                          )
                        }
                        size="icon-xs"
                        type="button"
                        variant="ghost"
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                No active alerts.
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
