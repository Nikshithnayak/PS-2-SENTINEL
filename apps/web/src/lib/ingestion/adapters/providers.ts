import type { ActivityContext, MetricType, ProviderSource, VitalSampleInput } from '@sentinel/shared';

export interface AdapterHealth {
  configured: boolean;
  provider: ProviderSource;
  status: 'ready' | 'unconfigured' | 'error';
  message: string;
}

export interface ProviderAdapter {
  readonly id: ProviderSource;
  readonly displayName: string;
  healthCheck(): AdapterHealth;
  fetchRecentSamples(params: {
    externalUserId: string;
    startIso: string;
    endIso: string;
    accessToken?: string;
  }): Promise<VitalSampleInput[]>;
}

/**
 * Adapter for `the-momentum/open-wearables` self-hosted unified wearable API.
 * Never imports Open Wearables internals directly; communicates over REST.
 */
export class OpenWearablesAdapter implements ProviderAdapter {
  readonly id: ProviderSource = 'open_wearables';
  readonly displayName = 'Open Wearables (Self-Hosted Unified API)';

  private baseUrl = process.env.OPEN_WEARABLES_URL ?? '';
  private apiKey = process.env.OPEN_WEARABLES_API_KEY ?? '';

  healthCheck(): AdapterHealth {
    if (!this.baseUrl || !this.apiKey) {
      return {
        configured: false,
        provider: this.id,
        status: 'unconfigured',
        message: 'Set OPEN_WEARABLES_URL and OPEN_WEARABLES_API_KEY (see docs/SETUP-NEEDED.md).',
      };
    }
    return {
      configured: true,
      provider: this.id,
      status: 'ready',
      message: `Connected to ${this.baseUrl}`,
    };
  }

  async fetchRecentSamples(params: {
    externalUserId: string;
    startIso: string;
    endIso: string;
  }): Promise<VitalSampleInput[]> {
    if (!this.baseUrl || !this.apiKey) {
      throw new Error('Open Wearables adapter not configured');
    }

    const url = new URL(`/api/v1/users/${encodeURIComponent(params.externalUserId)}/timeseries`, this.baseUrl);
    url.searchParams.set('start_time', params.startIso);
    url.searchParams.set('end_time', params.endIso);

    const res = await fetch(url, {
      headers: { 'x-open-wearables-api-key': this.apiKey },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      throw new Error(`Open Wearables upstream HTTP ${res.status}`);
    }

    const payload = (await res.json()) as {
      data?: Array<{
        type?: string;
        value?: number;
        unit?: string;
        timestamp?: string;
        source?: string;
      }>;
    };

    const typeMap: Record<string, VitalSampleInput['metricType']> = {
      heart_rate: 'heart_rate',
      resting_heart_rate: 'resting_heart_rate',
      heart_rate_variability_rmssd: 'hrv_rmssd',
      oxygen_saturation: 'spo2',
      respiratory_rate: 'respiratory_rate',
      skin_temperature_deviation: 'skin_temp_deviation',
      steps: 'steps',
    };

    const mapped: VitalSampleInput[] = [];
    for (const item of payload.data ?? []) {
      const metricType = item.type ? typeMap[item.type] : undefined;
      if (!metricType || typeof item.value !== 'number' || !item.timestamp) continue;
      mapped.push({
        metricType,
        value: item.value,
        unit: item.unit ?? 'bpm',
        recordedAt: new Date(item.timestamp).toISOString(),
        context: 'unknown',
        source: 'open_wearables',
        deviceModel: item.source ?? 'open-wearables',
        isSynthetic: false,
      });
    }
    return mapped;
  }
}

function fitPointValue(point: {
  value?: Array<{ fpVal?: number; intVal?: number }>;
}): number | null {
  const first = point.value?.[0];
  if (!first) return null;
  if (typeof first.fpVal === 'number' && Number.isFinite(first.fpVal)) return first.fpVal;
  if (typeof first.intVal === 'number' && Number.isFinite(first.intVal)) return first.intVal;
  return null;
}

function fitNanosToIso(nanosRaw: string | number | undefined): string | null {
  if (nanosRaw === undefined || nanosRaw === null) return null;
  const s = String(nanosRaw).trim();
  if (!/^\d+$/.test(s)) return null;
  const ms = Number(BigInt(s) / 1_000_000n);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString();
}

/**
 * Direct REST adapter for Google Fit (`fitness.googleapis.com/fitness/v1`) using
 * per-user OAuth tokens (Heart Rate, Steps, SpO2, Body Temperature, BP, Glucose, Sleep).
 */
export class GoogleFitAdapter implements ProviderAdapter {
  readonly id: ProviderSource = 'google_fit';
  readonly displayName = 'Google Fit Cloud Sync (OAuth 2.0)';

  private clientId =
    process.env.GOOGLE_CLIENT_ID?.trim() || process.env.GOOGLE_HEALTH_CLIENT_ID?.trim() || '';
  private clientSecret =
    process.env.GOOGLE_CLIENT_SECRET?.trim() ||
    process.env.GOOGLE_HEALTH_CLIENT_SECRET?.trim() ||
    '';

  healthCheck(): AdapterHealth {
    if (!this.clientId || !this.clientSecret) {
      return {
        configured: false,
        provider: this.id,
        status: 'unconfigured',
        message: 'Set GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET to enable Google Fit OAuth connect.',
      };
    }
    return {
      configured: true,
      provider: this.id,
      status: 'ready',
      message: 'Google OAuth ready — connect Google Fit directly in 1 click.',
    };
  }

  async fetchRecentSamples(params: {
    externalUserId: string;
    startIso: string;
    endIso: string;
    accessToken?: string;
  }): Promise<VitalSampleInput[]> {
    if (!params.accessToken) {
      throw new Error('Google Fit requires connecting your Google account via OAuth first.');
    }

    const startMs = Date.parse(params.startIso);
    const endMs = Date.parse(params.endIso);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      return [];
    }

    const specs: ReadonlyArray<{
      dataTypeName: string;
      metricType: MetricType;
      unit: string;
      context: ActivityContext;
      bucketMillis: number;
    }> = [
      {
        dataTypeName: 'com.google.heart_rate.bpm',
        metricType: 'heart_rate',
        unit: 'bpm',
        context: 'rest',
        bucketMillis: 3600_000,
      },
      {
        dataTypeName: 'com.google.step_count.delta',
        metricType: 'steps',
        unit: 'count',
        context: 'light_activity',
        bucketMillis: 3600_000,
      },
      {
        dataTypeName: 'com.google.oxygen_saturation',
        metricType: 'spo2',
        unit: '%',
        context: 'rest',
        bucketMillis: 3600_000,
      },
      {
        dataTypeName: 'com.google.body.temperature',
        metricType: 'body_temperature',
        unit: 'degC',
        context: 'unknown',
        bucketMillis: 3600_000,
      },
      {
        dataTypeName: 'com.google.blood_pressure',
        metricType: 'systolic_bp',
        unit: 'mmHg',
        context: 'rest',
        bucketMillis: 3600_000,
      },
      {
        dataTypeName: 'com.google.blood_glucose',
        metricType: 'blood_glucose',
        unit: 'mmol/L',
        context: 'unknown',
        bucketMillis: 3600_000,
      },
      {
        dataTypeName: 'com.google.sleep.segment',
        metricType: 'sleep_duration_min',
        unit: 'min',
        context: 'sleep',
        bucketMillis: 86_400_000,
      },
    ];

    const out: VitalSampleInput[] = [];
    let apiErrorMessage: string | null = null;
    let succeededCount = 0;

    const results = await Promise.all(
      specs.map(async (spec) => {
        const res = await fetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${params.accessToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            aggregateBy: [{ dataTypeName: spec.dataTypeName }],
            bucketByTime: { durationMillis: spec.bucketMillis },
            startTimeMillis: startMs,
            endTimeMillis: endMs,
          }),
          signal: AbortSignal.timeout(8000),
        });

        if (!res.ok) {
          const errBody = (await res.json().catch(() => ({}))) as {
            error?: { message?: string; status?: string };
          };
          const msg = errBody.error?.message || `Google Fit HTTP ${res.status}`;
          return { spec, buckets: null, errorStatus: res.status, errorMessage: msg };
        }

        const payload = (await res.json()) as {
          bucket?: Array<{
            startTimeMillis?: string;
            endTimeMillis?: string;
            dataset?: Array<{
              dataSourceId?: string;
              point?: Array<{
                startTimeNanos?: string;
                endTimeNanos?: string;
                originDataSourceId?: string;
                value?: Array<{ fpVal?: number; intVal?: number }>;
              }>;
            }>;
          }>;
        };
        return { spec, buckets: payload.bucket ?? [], errorStatus: 200, errorMessage: null };
      }),
    );

    for (const r of results) {
      if (!r.buckets) {
        if ((r.errorStatus === 401 || r.errorStatus === 403 || r.errorStatus === 410) && r.errorMessage) {
          apiErrorMessage = r.errorMessage;
        }
        continue;
      }
      succeededCount++;

      for (const bucket of r.buckets) {
        const bucketIso =
          bucket.startTimeMillis && Number.isFinite(Number(bucket.startTimeMillis))
            ? new Date(Number(bucket.startTimeMillis)).toISOString()
            : params.endIso;

        if (r.spec.metricType === 'sleep_duration_min') {
          let asleepMs = 0;
          let latestEndIso = bucketIso;
          for (const ds of bucket.dataset ?? []) {
            for (const pt of ds.point ?? []) {
              const stageCode = fitPointValue(pt);
              // Google Fit sleep stage codes: 2 = awake, 3 = out-of-bed
              if (stageCode === 2 || stageCode === 3) continue;
              const sIso = fitNanosToIso(pt.startTimeNanos);
              const eIso = fitNanosToIso(pt.endTimeNanos);
              if (sIso && eIso) {
                const dur = Date.parse(eIso) - Date.parse(sIso);
                if (dur > 0) asleepMs += dur;
                latestEndIso = eIso;
              }
            }
          }
          const minutes = Math.round(asleepMs / 60_000);
          if (minutes > 0) {
            out.push({
              metricType: 'sleep_duration_min',
              value: Math.min(1440, minutes),
              unit: 'min',
              recordedAt: latestEndIso,
              context: 'sleep',
              source: 'google_fit',
              deviceModel: 'Google Fit Cloud',
              isSynthetic: false,
            });
          }
          continue;
        }

        for (const ds of bucket.dataset ?? []) {
          for (const pt of ds.point ?? []) {
            const val = fitPointValue(pt);
            if (val === null) continue;
            const recordedAt =
              fitNanosToIso(pt.startTimeNanos) ?? fitNanosToIso(pt.endTimeNanos) ?? bucketIso;
            out.push({
              metricType: r.spec.metricType,
              value: Number(val.toFixed(3)),
              unit: r.spec.unit,
              recordedAt,
              context: r.spec.context,
              source: 'google_fit',
              deviceModel: pt.originDataSourceId || ds.dataSourceId || 'Google Fit Cloud',
              isSynthetic: false,
            });
          }
        }
      }
    }

    if (succeededCount === 0 && apiErrorMessage) {
      throw new Error(apiErrorMessage);
    }

    return out;
  }
}

/**
 * Adapter for Google Health API v4 (`health.googleapis.com/v4`, successor to legacy Fit/Fitbit Web APIs).
 */
export class GoogleHealthAdapter implements ProviderAdapter {
  readonly id: ProviderSource = 'google_health_api';
  readonly displayName = 'Google Health API v4';

  private clientId =
    process.env.GOOGLE_HEALTH_CLIENT_ID?.trim() || process.env.GOOGLE_CLIENT_ID?.trim() || '';
  private clientSecret =
    process.env.GOOGLE_HEALTH_CLIENT_SECRET?.trim() ||
    process.env.GOOGLE_CLIENT_SECRET?.trim() ||
    '';

  healthCheck(): AdapterHealth {
    if (!this.clientId || !this.clientSecret) {
      return {
        configured: false,
        provider: this.id,
        status: 'unconfigured',
        message:
          'Set GOOGLE_HEALTH_CLIENT_ID/SECRET (or GOOGLE_CLIENT_ID/SECRET with Google Health API enabled).',
      };
    }
    return {
      configured: true,
      provider: this.id,
      status: 'ready',
      message: 'Google Health API v4 OAuth configured.',
    };
  }

  async fetchRecentSamples(params: {
    externalUserId: string;
    startIso: string;
    endIso: string;
    accessToken?: string;
  }): Promise<VitalSampleInput[]> {
    if (!params.accessToken) {
      throw new Error('Google Health API requires an authorized Google OAuth connection.');
    }

    const dataTypes: Array<{
      apiType: string;
      metric: MetricType;
      unit: string;
      context: ActivityContext;
    }> = [
      { apiType: 'heart-rate', metric: 'heart_rate', unit: 'bpm', context: 'rest' },
      {
        apiType: 'daily-resting-heart-rate',
        metric: 'resting_heart_rate',
        unit: 'bpm',
        context: 'sleep',
      },
      {
        apiType: 'heart-rate-variability',
        metric: 'hrv_rmssd',
        unit: 'ms',
        context: 'sleep',
      },
      { apiType: 'oxygen-saturation', metric: 'spo2', unit: '%', context: 'rest' },
      {
        apiType: 'respiratory-rate',
        metric: 'respiratory_rate',
        unit: 'breaths/min',
        context: 'rest',
      },
    ];

    const out: VitalSampleInput[] = [];
    let apiErrorMessage: string | null = null;
    let succeededCount = 0;

    for (const dt of dataTypes) {
      const url = new URL(`https://health.googleapis.com/v4/users/me/dataTypes/${dt.apiType}/dataPoints`);
      url.searchParams.set('interval.startTime', params.startIso);
      url.searchParams.set('interval.endTime', params.endIso);
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${params.accessToken}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        if ((res.status === 401 || res.status === 403 || res.status === 404) && errBody.error?.message) {
          apiErrorMessage = errBody.error.message;
        }
        continue;
      }
      succeededCount++;
      const body = (await res.json()) as {
        dataPoints?: Array<{ value?: number; interval?: { startTime?: string } }>;
      };
      for (const dp of body.dataPoints ?? []) {
        if (typeof dp.value !== 'number' || !dp.interval?.startTime) continue;
        out.push({
          metricType: dt.metric,
          value: dp.value,
          unit: dt.unit,
          recordedAt: new Date(dp.interval.startTime).toISOString(),
          context: dt.context,
          source: 'google_health_api',
          deviceModel: 'Google Health API v4',
          isSynthetic: false,
        });
      }
    }

    if (succeededCount === 0 && apiErrorMessage) {
      throw new Error(apiErrorMessage);
    }

    return out;
  }
}
