export interface NearbyHospital {
  name: string;
  distanceKm: number;
  city: string;
  source: 'openstreetmap_overpass' | 'coastal_karnataka_reference';
  lat: number;
  lon: number;
}

const REFERENCE_HOSPITALS: Array<{ name: string; city: string; lat: number; lon: number }> = [
  {
    name: 'Justice K.S. Hegde Charitable Hospital (Nitte / Deralakatte)',
    city: 'Mangaluru',
    lat: 12.8117,
    lon: 74.8891,
  },
  {
    name: 'KMC Hospital, Ambedkar Circle',
    city: 'Mangaluru',
    lat: 12.8716,
    lon: 74.8433,
  },
  {
    name: 'Wenlock District Government Hospital',
    city: 'Mangaluru',
    lat: 12.8644,
    lon: 74.8397,
  },
  {
    name: 'Father Muller Medical College Hospital',
    city: 'Mangaluru',
    lat: 12.8624,
    lon: 74.8559,
  },
];

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return Number((2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(1));
}

/**
 * Looks up nearest hospitals via OpenStreetMap Overpass API using district-rounded
 * coordinates ONLY (zero patient identity or health telemetry leaves SENTINEL).
 */
export async function findNearbyHospitals(
  regionLat: number,
  regionLon: number,
  city = 'Mangaluru',
): Promise<NearbyHospital[]> {
  const lat = Number(regionLat.toFixed(2));
  const lon = Number(regionLon.toFixed(2));

  try {
    const query = `[out:json][timeout:4];(node["amenity"="hospital"](around:12000,${lat},${lon});way["amenity"="hospital"](around:12000,${lat},${lon}););out center 6;`;
    const resp = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(3500),
    });

    if (resp.ok) {
      const json = (await resp.json()) as {
        elements?: Array<{
          lat?: number;
          lon?: number;
          center?: { lat: number; lon: number };
          tags?: { name?: string };
        }>;
      };
      const items = (json.elements ?? [])
        .map((el) => {
          const elLat = el.lat ?? el.center?.lat;
          const elLon = el.lon ?? el.center?.lon;
          const name = el.tags?.name;
          if (!name || elLat === undefined || elLon === undefined) return null;
          return {
            name,
            city,
            distanceKm: haversineKm(lat, lon, elLat, elLon),
            source: 'openstreetmap_overpass',
            lat: elLat,
            lon: elLon,
          } satisfies NearbyHospital as NearbyHospital;
        })
        .filter((x): x is NearbyHospital => x !== null)
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, 4);

      if (items.length > 0) return items;
    }
  } catch {
    // Graceful reference fallback when offline / sandboxed
  }

  return REFERENCE_HOSPITALS.map((h) => ({
    name: h.name,
    city: h.city,
    distanceKm: haversineKm(lat, lon, h.lat, h.lon),
    source: 'coastal_karnataka_reference' as const,
    lat: h.lat,
    lon: h.lon,
  })).sort((a, b) => a.distanceKm - b.distanceKm);
}
