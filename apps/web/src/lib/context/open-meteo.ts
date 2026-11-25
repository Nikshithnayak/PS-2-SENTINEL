import { eq, desc } from 'drizzle-orm';
import { withSystemDb } from '@/db';
import { environmentSnapshots, patientProfiles } from '@/db/schema';

export interface EnvironmentalContext {
  city: string;
  tempC: number;
  apparentTempC: number;
  humidityPct: number;
  pm25: number | null;
  heatRiskLevel: 'normal' | 'caution' | 'high';
  hydrationGuidance: string;
  fetchedAt: string;
  source: 'open-meteo' | 'cached';
}

/**
 * Strips all patient identifiers and rounds coordinates to 2 decimal places (~1.1-5km grid)
 * before querying Open-Meteo for heat stress & air-quality confounder telemetry.
 */
export function buildSanitizedOpenMeteoUrls(lat: number, lon: number): {
  weatherUrl: string;
  airUrl: string;
  roundedLat: number;
  roundedLon: number;
} {
  const roundedLat = Math.round(lat * 100) / 100;
  const roundedLon = Math.round(lon * 100) / 100;
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${roundedLat}&longitude=${roundedLon}&current=temperature_2m,relative_humidity_2m,apparent_temperature`;
  const airUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${roundedLat}&longitude=${roundedLon}&current=pm2_5`;
  return { weatherUrl, airUrl, roundedLat, roundedLon };
}

export function classifyHeatRisk(apparentTempC: number): {
  level: 'normal' | 'caution' | 'high';
  guidance: string;
} {
  if (apparentTempC >= 37) {
    return {
      level: 'high',
      guidance:
        'High heat index (>37°C apparent). Drink water regularly, rest in shade, and interpret mild RHR elevation alongside heat strain.',
    };
  }
  if (apparentTempC >= 32) {
    return {
      level: 'caution',
      guidance:
        'Warm humid conditions (>32°C apparent). Encourage extra hydration and light cotton clothing.',
    };
  }
  return {
    level: 'normal',
    guidance: 'Ambient thermal load is comfortable.',
  };
}

export async function refreshPatientEnvironment(
  patientId: string,
): Promise<EnvironmentalContext> {
  const profile = await withSystemDb((tx) =>
    tx
      .select({
        city: patientProfiles.city,
        regionLat: patientProfiles.regionLat,
        regionLon: patientProfiles.regionLon,
      })
      .from(patientProfiles)
      .where(eq(patientProfiles.id, patientId))
      .limit(1),
  );

  const city = profile[0]?.city ?? 'Mangaluru';
  const lat = profile[0]?.regionLat ?? 12.91;
  const lon = profile[0]?.regionLon ?? 74.86;
  const { weatherUrl, airUrl, roundedLat, roundedLon } = buildSanitizedOpenMeteoUrls(lat, lon);

  try {
    const [wRes, aRes] = await Promise.all([
      fetch(weatherUrl, { signal: AbortSignal.timeout(4000) }),
      fetch(airUrl, { signal: AbortSignal.timeout(4000) }).catch(() => null),
    ]);

    if (!wRes.ok) throw new Error(`Open-Meteo HTTP ${wRes.status}`);
    const wJson = (await wRes.json()) as {
      current?: {
        temperature_2m?: number;
        relative_humidity_2m?: number;
        apparent_temperature?: number;
      };
    };
    const aJson = aRes?.ok
      ? ((await aRes.json()) as { current?: { pm2_5?: number } })
      : null;

    const tempC = Number(wJson.current?.temperature_2m ?? 29.0);
    const humidityPct = Number(wJson.current?.relative_humidity_2m ?? 72);
    const apparentTempC = Number(wJson.current?.apparent_temperature ?? tempC + 2.5);
    const pm25 = typeof aJson?.current?.pm2_5 === 'number' ? aJson.current.pm2_5 : null;
    const heat = classifyHeatRisk(apparentTempC);

    const saved = await withSystemDb(async (tx) => {
      const inserted = await tx
        .insert(environmentSnapshots)
        .values({
          city,
          regionLat: roundedLat,
          regionLon: roundedLon,
          tempC,
          apparentTempC,
          humidityPct,
          pm25,
          heatRiskLevel: heat.level,
        })
        .returning();
      return inserted[0]!;
    });

    return {
      city,
      tempC: saved.tempC,
      apparentTempC: saved.apparentTempC,
      humidityPct: saved.humidityPct,
      pm25: saved.pm25,
      heatRiskLevel: heat.level,
      hydrationGuidance: heat.guidance,
      fetchedAt: saved.fetchedAt.toISOString(),
      source: 'open-meteo',
    };
  } catch {
    const cached = await withSystemDb((tx) =>
      tx
        .select()
        .from(environmentSnapshots)
        .where(eq(environmentSnapshots.city, city))
        .orderBy(desc(environmentSnapshots.fetchedAt))
        .limit(1),
    );
    if (cached[0]) {
      const heat = classifyHeatRisk(cached[0].apparentTempC);
      return {
        city: cached[0].city,
        tempC: cached[0].tempC,
        apparentTempC: cached[0].apparentTempC,
        humidityPct: cached[0].humidityPct,
        pm25: cached[0].pm25,
        heatRiskLevel: heat.level,
        hydrationGuidance: heat.guidance,
        fetchedAt: cached[0].fetchedAt.toISOString(),
        source: 'cached',
      };
    }
    throw new Error('Open-Meteo unreachable and no cached environment snapshot exists');
  }
}
