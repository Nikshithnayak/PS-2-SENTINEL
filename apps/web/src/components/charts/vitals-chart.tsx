'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import * as echarts from 'echarts';
import { SyntheticBadge } from '@/components/health/status-badge';

export interface VitalsChartPoint {
  timestamp: string;
  value: number;
  minVal: number;
  maxVal: number;
  confidence: number;
  context: string;
  isSynthetic?: boolean;
}

export interface VitalsChartProps {
  title: string;
  unit: string;
  points: VitalsChartPoint[];
  bandLow?: number | null;
  bandHigh?: number | null;
  medianVal?: number | null;
  changePoints?: string[];
  alertTimestamps?: string[];
  medMarkers?: Array<{ timestamp: string; medName: string; status: string }>;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  baselineStage?: string | null;
  validDays?: number | null;
  isSynthetic?: boolean;
  compact?: boolean;
  emptyHint?: string;
}

export function VitalsChart({
  title,
  unit,
  points,
  bandLow,
  bandHigh,
  medianVal,
  changePoints = [],
  alertTimestamps = [],
  medMarkers = [],
  loading = false,
  error = null,
  onRetry,
  baselineStage,
  validDays,
  isSynthetic = false,
  compact = false,
  emptyHint,
}: VitalsChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  const hasBand = typeof bandLow === 'number' && typeof bandHigh === 'number';
  const latestPoint = points.length > 0 ? points[points.length - 1] : null;
  const anySynthetic = isSynthetic || points.some((p) => p.isSynthetic);
  const outsideBand =
    hasBand &&
    latestPoint &&
    (latestPoint.value < bandLow! || latestPoint.value > bandHigh!);

  useEffect(() => {
    if (loading || error || points.length === 0 || !containerRef.current) {
      return;
    }

    const instance = echarts.init(containerRef.current, undefined, { renderer: 'canvas' });
    chartRef.current = instance;

    const times = points.map((p) => p.timestamp);
    const values = points.map((p) => p.value);
    const baselineSeries =
      typeof medianVal === 'number' ? points.map(() => medianVal) : undefined;

    const markLineData: Array<Record<string, unknown>> = [];
    if (typeof medianVal === 'number') {
      markLineData.push({
        name: 'Personal Median',
        yAxis: medianVal,
        lineStyle: { color: '#3b8a97', type: 'dashed', width: 1.5 },
        label: {
          position: 'insideEndTop',
          formatter: `Normal ${medianVal}${unit ? ` ${unit}` : ''}`,
          color: '#164e63',
          fontSize: 11,
        },
      });
    }

    for (const cp of changePoints) {
      const nearest = times.find((t) => t.slice(0, 13) === cp.slice(0, 13));
      if (nearest) {
        markLineData.push({
          name: 'Change Point',
          xAxis: nearest,
          lineStyle: { color: '#b45309', type: 'dotted', width: 2 },
          label: { formatter: 'Shift', color: '#b45309', fontSize: 11 },
        });
      }
    }

    for (const med of medMarkers.slice(0, 6)) {
      const nearest = times.find((t) => t.slice(0, 13) === med.timestamp.slice(0, 13));
      if (nearest) {
        markLineData.push({
          name: `${med.medName} (${med.status})`,
          xAxis: nearest,
          lineStyle: { color: '#0369a1', type: 'solid', width: 1.5 },
          label: { formatter: `Rx:${med.status}`, color: '#0369a1', fontSize: 11 },
        });
      }
    }

    const markPointData = alertTimestamps
      .map((ts) => {
        const idx = times.findIndex((t) => t.slice(0, 13) === ts.slice(0, 13));
        if (idx < 0) return null;
        return {
          name: 'Alert Triggered',
          coord: [times[idx], values[idx]],
          itemStyle: { color: '#b91c1c' },
        };
      })
      .filter((x): x is { name: string; coord: [string, number]; itemStyle: { color: string } } => x !== null);

    // Highlight individual readings outside the personal normal band
    const seriesData = points.map((p) => {
      const isOut = hasBand && (p.value < bandLow! || p.value > bandHigh!);
      return isOut
        ? {
          value: p.value,
          itemStyle: { color: '#b45309', borderColor: '#ffffff', borderWidth: 1.5 },
          symbolSize: 7,
        }
        : p.value;
    });

    const option: echarts.EChartsOption = {
      animation: false,
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(27, 60, 83, 0.96)',
        borderColor: '#3b8a97',
        textStyle: { color: '#f8fafc', fontSize: 12 },
        valueFormatter: (val) => `${val}${unit ? ` ${unit}` : ''}`,
      },
      grid: { left: 48, right: 20, top: 32, bottom: compact ? 36 : 64 },
      xAxis: {
        type: 'category',
        data: times,
        axisLine: { lineStyle: { color: '#c4dde2' } },
        axisLabel: {
          color: '#3b586a',
          fontSize: 11,
          formatter: (val: string) => {
            const d = new Date(val);
            return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}h`;
          },
        },
      },
      yAxis: {
        type: 'value',
        scale: true,
        name: unit,
        nameTextStyle: { color: '#3b586a', fontSize: 11 },
        splitLine: { lineStyle: { color: 'rgba(27, 60, 83, 0.08)' } },
        axisLabel: { color: '#3b586a', fontSize: 11 },
      },
      dataZoom: compact
        ? [{ type: 'inside', start: 0, end: 100 }]
        : [
          { type: 'inside', start: 0, end: 100 },
          { type: 'slider', start: 0, end: 100, height: 22, bottom: 8 },
        ],
      series: [
        {
          name: `Actual ${title}`,
          type: 'line',
          smooth: 0.28,
          showSymbol: points.length <= 48,
          symbolSize: points.length <= 3 ? 10 : 6,
          data: seriesData,
          lineStyle: { color: '#1b3c53', width: 2.5 },
          itemStyle: { color: '#1b3c53' },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(59, 138, 151, 0.22)' },
              { offset: 1, color: 'rgba(59, 138, 151, 0.01)' },
            ]),
          },
          markArea: hasBand
            ? {
              silent: true,
              itemStyle: { color: 'rgba(82, 163, 158, 0.14)' },
              data: [[{ yAxis: bandLow! }, { yAxis: bandHigh! }]],
            }
            : undefined,
          markLine: markLineData.length > 0 ? { data: markLineData as never } : undefined,
          markPoint: markPointData.length > 0 ? { data: markPointData as never } : undefined,
        },
        ...(baselineSeries
          ? [
            {
              name: 'Personal Normal',
              type: 'line' as const,
              showSymbol: false,
              data: baselineSeries,
              lineStyle: { color: '#4b9a9b', width: 1.75, type: 'dashed' as const },
              itemStyle: { color: '#4b9a9b' },
              silent: true,
            },
          ]
          : []),
      ],
    };

    instance.setOption(option);

    const ro = new ResizeObserver(() => instance.resize());
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      instance.dispose();
      chartRef.current = null;
    };
  }, [
    alertTimestamps,
    bandHigh,
    bandLow,
    changePoints,
    compact,
    error,
    hasBand,
    loading,
    medMarkers,
    medianVal,
    points,
    title,
    unit,
  ]);

  if (loading) {
    return (
      <div
        role="status"
        aria-label={`Loading ${title} chart`}
        className="flex h-[280px] items-center justify-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-base)] text-sm text-[var(--text-muted)]"
      >
        Loading physiological trajectory...
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="flex h-[280px] flex-col items-center justify-center gap-3 rounded-2xl border border-[var(--status-urgent)] bg-[var(--status-urgent-bg)] p-4 text-center"
      >
        <p className="text-sm font-medium text-[var(--status-urgent)]">{error}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="min-h-11 rounded-xl bg-[var(--brand-primary)] px-4 text-xs font-semibold text-[var(--brand-primary-fg)] cursor-pointer"
          >
            Retry Chart Load
          </button>
        )}
      </div>
    );
  }

  if (points.length === 0) {
    return (
      <div className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-base)] p-6 text-center text-sm text-[var(--text-muted)]">
        <p className="font-semibold text-[var(--text-primary)]">
          No {title} samples recorded in this window yet.
        </p>
        <p className="mt-1.5 max-w-md text-xs leading-relaxed">
          {emptyHint ??
            'Sync Google Fit, pair your Android Health Connect phone bridge / smartwatch, or import Apple Health XML / CSV readings on Data Import.'}
        </p>
        <Link
          href="/ingest"
          className="mt-4 inline-flex min-h-10 items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 text-xs font-semibold text-[var(--brand-primary)] hover:bg-[var(--bg-elevated)]"
        >
          Open Google Fit &amp; Data Import →
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Accessible Legend + Personal Baseline Comparison Summary */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-3" aria-label="Chart legend">
          <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
            <span className="inline-block h-0.5 w-4 rounded bg-[var(--brand-rail-active)]" aria-hidden="true" />
            Actual Readings
          </span>
          {hasBand && (
            <span className="inline-flex items-center gap-1.5 font-medium text-[var(--text-muted)]">
              <span className="inline-block h-3 w-3 rounded bg-[var(--status-stable-bg)] border border-[var(--status-stable)]" aria-hidden="true" />
              Personal Normal ({bandLow}–{bandHigh}{unit ? ` ${unit}` : ''})
            </span>
          )}
          {changePoints.length > 0 && (
            <span className="inline-flex items-center gap-1.5 font-medium text-[var(--status-watch)]">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--status-watch)]" aria-hidden="true" />
              Unusual Shift
            </span>
          )}
          {alertTimestamps.length > 0 && (
            <span className="inline-flex items-center gap-1.5 font-medium text-[var(--status-urgent)]">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--status-urgent)]" aria-hidden="true" />
              Alert Marker
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {anySynthetic && <SyntheticBadge />}
          {baselineStage && (
            <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2.5 py-0.5 font-semibold text-[var(--text-muted)]">
              Baseline: {baselineStage} ({validDays ?? 0}d)
            </span>
          )}
        </div>
      </div>

      {latestPoint && (
        <p className="rounded-xl bg-[var(--bg-elevated)] px-3.5 py-2 text-xs text-[var(--text-muted)]">
          Latest reading at{' '}
          <span className="font-[family-name:var(--font-mono)] font-semibold text-[var(--text-primary)]">
            {latestPoint.timestamp.slice(0, 16).replace('T', ' ')} UTC
          </span>
          :{' '}
          <strong className="font-[family-name:var(--font-mono)] text-[var(--text-primary)]">
            {latestPoint.value}
            {unit ? ` ${unit}` : ''}
          </strong>
          {hasBand &&
            (outsideBand
              ? ` — outside your ${bandLow}–${bandHigh}${unit ? ` ${unit}` : ''} personal normal corridor.`
              : ` — inside your ${bandLow}–${bandHigh}${unit ? ` ${unit}` : ''} personal normal corridor.`)}
        </p>
      )}

      <div
        ref={containerRef}
        role="img"
        data-testid="echarts-vitals-canvas"
        aria-label={`${title} physiological trend chart comparing actual readings to personal baseline`}
        className={`${compact ? 'h-[250px]' : 'h-[320px]'} w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2`}
      />

      <details className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 text-xs">
        <summary className="cursor-pointer font-semibold">
          Accessible Tabular Data View ({points.length} hourly points)
        </summary>
        <div
          tabIndex={0}
          role="region"
          aria-label={`${title} data table`}
          className="mt-2 max-h-48 overflow-auto"
        >
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] text-[var(--text-muted)]">
                <th className="py-1.5 pr-3">Hour (UTC)</th>
                <th className="py-1.5 pr-3">Actual ({unit || 'val'})</th>
                <th className="py-1.5 pr-3">Range</th>
                <th className="py-1.5 pr-3">Context</th>
                <th className="py-1.5">Confidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)] font-[family-name:var(--font-mono)]">
              {points.slice(-16).map((p) => (
                <tr key={p.timestamp}>
                  <td className="py-1.5 pr-3">{p.timestamp.slice(0, 16).replace('T', ' ')}</td>
                  <td className="py-1.5 pr-3 font-semibold">{p.value}</td>
                  <td className="py-1.5 pr-3">
                    {p.minVal}–{p.maxVal}
                  </td>
                  <td className="py-1.5 pr-3 font-sans">{p.context}</td>
                  <td className="py-1.5">{p.confidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
