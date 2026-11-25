import type { ProviderSource, VitalSampleInput } from '@sentinel/shared';

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

/**
 * Adapter for Google Health API v4 (successor to the retired Fitbit Web API turned off Nov 2026).
 */
export class GoogleHealthAdapter implements ProviderAdapter {
  readonly id: ProviderSource = 'google_health_api';
  readonly displayName = 'Google Health API v4';

  private clientId = process.env.GOOGLE_HEALTH_CLIENT_ID ?? '';
  private clientSecret = process.env.GOOGLE_HEALTH_CLIENT_SECRET ?? '';

  healthCheck(): AdapterHealth {
    if (!this.clientId || !this.clientSecret) {
      return {
        configured: false,
        provider: this.id,
        status: 'unconfigured',
        message:
          'Legacy Fitbit Web API retired Nov 2026. Set GOOGLE_HEALTH_CLIENT_ID/SECRET after Google partner verification.',
      };
    }
    return {
      configured: true,
      provider: this.id,
      status: 'ready',
      message: 'Google Health API v4 credentials configured',
    };
  }

  async fetchRecentSamples(params: {
    externalUserId: string;
    startIso: string;
    endIso: string;
    accessToken?: string;
  }): Promise<VitalSampleInput[]> {
    if (!params.accessToken) {
      throw new Error('Google Health API requires an end-user OAuth access token');
    }

    const dataTypes: Array<{ apiType: string; metric: VitalSampleInput['metricType']; unit: string }> = [
      { apiType: 'heart-rate', metric: 'heart_rate', unit: 'bpm' },
      { apiType: 'resting-heart-rate', metric: 'resting_heart_rate', unit: 'bpm' },
      { apiType: 'oxygen-saturation', metric: 'spo2', unit: '%' },
      { apiType: 'respiratory-rate', metric: 'respiratory_rate', unit: 'breaths/min' },
    ];

    const out: VitalSampleInput[] = [];
    for (const dt of dataTypes) {
      const url = new URL(`https://health.googleapis.com/v4/users/me/dataTypes/${dt.apiType}/dataPoints`);
      url.searchParams.set('interval.startTime', params.startIso);
      url.searchParams.set('interval.endTime', params.endIso);
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${params.accessToken}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
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
          context: 'unknown',
          source: 'google_health_api',
          isSynthetic: false,
        });
      }
    }
    return out;
  }
}
