'use client';

import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

export interface VitalsChartPoint {
  timestamp: string;
  value: number;
  minVal: number;
  maxVal: number;
  confidence: number;
  context: string;
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
}: VitalsChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (loading || error || points.length === 0 || !containerRef.current) {
      return;
    }

    const instance = echarts.init(containerRef.current, undefined, { renderer: 'canvas' });
    chartRef.current = instance;

    const times = points.map((p) => p.timestamp);
    const values = points.map((p) => p.value);

    const markLineData: Array<Record<string, unknown>> = [];
    if (typeof medianVal === 'number') {
      markLineData.push({
        name: 'Personal Median',
        yAxis: medianVal,
        lineStyle: { color: '#0f766e', type: 'dashed', width: 1.5 },
        label: { position: 'insideEndTop', formatter: `Normal ${medianVal} ${unit}` },
      });
    }

    for (const cp of changePoints) {
      const nearest = times.find((t) => t.slice(0, 13) === cp.slice(0, 13));
      if (nearest) {
        markLineData.push({
          name: 'Change Point',
          xAxis: nearest,
          lineStyle: { color: '#b45309', type: 'dotted', width: 2 },
          label: { formatter: 'Shift' },
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
          label: { formatter: `Rx:${med.status}` },
        });
      }
    }

    const markPointData = alertTimestamps
      .map((ts) => {
        const idx = times.findIndex((t) => t.slice(0, 13) === ts.slice(0, 13));
        if (idx < 0) return null;
        return {
          name: 'Alert Fired',
          coord: [times[idx], values[idx]],
          itemStyle: { color: '#b91c1c' },
        };
      })
      .filter((x): x is { name: string; coord: [string, number]; itemStyle: { color: string } } => x !== null);

    const option: echarts.EChartsOption = {
      animation: false,
      tooltip: {
        trigger: 'axis',
        valueFormatter: (val) => `${val} ${unit}`,
      },
      grid: { left: 48, right: 20, top: 36, bottom: 64 },
      xAxis: {
        type: 'category',
        data: times,
        axisLabel: {
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
      },
      dataZoom: [
        { type: 'inside', start: 0, end: 100 },
        { type: 'slider', start: 0, end: 100, height: 22, bottom: 8 },
      ],
      series: [
        {
          name: title,
          type: 'line',
          smooth: 0.2,
          showSymbol: points.length <= 48,
          data: values,
          lineStyle: { color: '#0f766e', width: 2.5 },
          itemStyle: { color: '#0f766e' },
          markArea:
            typeof bandLow === 'number' && typeof bandHigh === 'number'
              ? {
                  silent: true,
                  itemStyle: { color: 'rgba(15, 118, 110, 0.11)' },
                  data: [[{ yAxis: bandLow }, { yAxis: bandHigh }]],
                }
              : undefined,
          markLine: markLineData.length > 0 ? { data: markLineData as never } : undefined,
          markPoint: markPointData.length > 0 ? { data: markPointData as never } : undefined,
        },
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
    error,
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
        className="flex h-[320px] items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] text-sm text-[var(--text-muted)]"
      >
        Loading physiological trajectory...
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="flex h-[320px] flex-col items-center justify-center gap-3 rounded-xl border border-[var(--status-urgent)] bg-[var(--status-urgent-bg)] p-4 text-center"
      >
        <p className="text-sm font-medium text-[var(--status-urgent)]">{error}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="min-h-11 rounded-lg bg-[var(--brand-primary)] px-4 text-xs font-semibold text-[var(--brand-primary-fg)] cursor-pointer"
          >
            Retry Chart Load
          </button>
        )}
      </div>
    );
  }

  if (points.length === 0) {
    return (
      <div className="flex h-[320px] flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-base)] p-6 text-center text-sm text-[var(--text-muted)]">
        <p className="font-semibold">No {title} samples recorded in this window yet.</p>
        <p className="mt-1 text-xs">Import Apple Health XML, CSV, or run Synthetic Scenario Mode.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
        <span>
          Personal normal band:{' '}
          {typeof bandLow === 'number' && typeof bandHigh === 'number'
            ? `${bandLow}–${bandHigh} ${unit}`
            : 'Learning warm-up'}
        </span>
        {baselineStage && (
          <span className="rounded-full border border-[var(--border-subtle)] px-2.5 py-0.5 font-semibold">
            Baseline: {baselineStage} ({validDays ?? 0}d)
          </span>
        )}
      </div>

      <div
        ref={containerRef}
        role="img"
        data-testid="echarts-vitals-canvas"
        aria-label={`${title} longitudinal chart`}
        className="h-[320px] w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2"
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
                <th className="py-1 pr-3">Hour (UTC)</th>
                <th className="py-1 pr-3">Median ({unit})</th>
                <th className="py-1 pr-3">Range</th>
                <th className="py-1">Confidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)] font-[family-name:var(--font-mono)]">
              {points.slice(-16).map((p) => (
                <tr key={p.timestamp}>
                  <td className="py-1 pr-3">{p.timestamp.slice(0, 16).replace('T', ' ')}</td>
                  <td className="py-1 pr-3">{p.value}</td>
                  <td className="py-1 pr-3">
                    {p.minVal}–{p.maxVal}
                  </td>
                  <td className="py-1">{p.confidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
