import type { CommuteMode } from "@/lib/types";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "CareerOS/1.0 (commute-estimate)";

type LatLng = { lat: number; lng: number };

const geocodeCache = new Map<string, LatLng | null>();

async function geocode(place: string): Promise<LatLng | null> {
  const key = place.trim().toLowerCase();
  if (!key) return null;
  if (geocodeCache.has(key)) return geocodeCache.get(key) ?? null;

  try {
    const params = new URLSearchParams({
      q: place.trim(),
      format: "json",
      limit: "1",
    });
    const res = await fetch(`${NOMINATIM_URL}?${params}`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      geocodeCache.set(key, null);
      return null;
    }
    const data = (await res.json()) as { lat?: string; lon?: string }[];
    const hit = data[0];
    if (!hit?.lat || !hit?.lon) {
      geocodeCache.set(key, null);
      return null;
    }
    const coords = { lat: Number(hit.lat), lng: Number(hit.lon) };
    geocodeCache.set(key, coords);
    return coords;
  } catch {
    geocodeCache.set(key, null);
    return null;
  }
}

const ORS_PROFILE: Record<Exclude<CommuteMode, "public_transit">, string> = {
  car: "driving-car",
  bike: "cycling-regular",
  walk: "foot-walking",
};

async function estimateWithOpenRouteService(
  from: LatLng,
  to: LatLng,
  mode: Exclude<CommuteMode, "public_transit">
): Promise<number | null> {
  const apiKey = process.env.ORS_API_KEY?.trim();
  if (!apiKey) return null;

  const profile = ORS_PROFILE[mode];
  try {
    const res = await fetch(
      `https://api.openrouteservice.org/v2/directions/${profile}`,
      {
        method: "POST",
        headers: {
          Authorization: apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          coordinates: [
            [from.lng, from.lat],
            [to.lng, to.lat],
          ],
        }),
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      routes?: { summary?: { duration?: number } }[];
    };
    const seconds = data.routes?.[0]?.summary?.duration;
    if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
    return Math.round(seconds / 60);
  } catch {
    return null;
  }
}

async function estimateWithGoogle(
  from: LatLng,
  to: LatLng,
  mode: CommuteMode
): Promise<number | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!apiKey) return null;

  const modeParam =
    mode === "car"
      ? "driving"
      : mode === "bike"
        ? "bicycling"
        : mode === "walk"
          ? "walking"
          : "transit";

  try {
    const params = new URLSearchParams({
      origins: `${from.lat},${from.lng}`,
      destinations: `${to.lat},${to.lng}`,
      mode: modeParam,
      key: apiKey,
    });
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/distancematrix/json?${params}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      rows?: { elements?: { status?: string; duration?: { value?: number } }[] }[];
    };
    const el = data.rows?.[0]?.elements?.[0];
    if (el?.status !== "OK" || typeof el.duration?.value !== "number") return null;
    return Math.round(el.duration.value / 60);
  } catch {
    return null;
  }
}

/** Best-effort one-way commute minutes; null when routing unavailable. */
export async function estimateCommuteMinutes(
  homeLocation: string,
  jobLocation: string,
  mode: CommuteMode
): Promise<{ minutes: number; source: "google" | "openrouteservice" } | null> {
  const home = homeLocation.trim();
  const dest = jobLocation.trim();
  if (!home || !dest) return null;
  if (/remote|anywhere|distributed|wfh/i.test(dest)) return null;

  const [from, to] = await Promise.all([geocode(home), geocode(dest)]);
  if (!from || !to) return null;

  const google = await estimateWithGoogle(from, to, mode);
  if (google != null) return { minutes: google, source: "google" };

  if (mode !== "public_transit") {
    const ors = await estimateWithOpenRouteService(from, to, mode);
    if (ors != null) return { minutes: ors, source: "openrouteservice" };
  }

  return null;
}

export function isLikelyRemoteJob(
  location?: string,
  postingText?: string
): boolean {
  const loc = (location ?? "").toLowerCase();
  if (
    loc.includes("remote") ||
    loc.includes("anywhere") ||
    loc.includes("distributed") ||
    loc === "unknown"
  ) {
    return true;
  }
  const snippet = (postingText ?? "").slice(0, 4000).toLowerCase();
  return /\b(fully remote|100% remote|work from anywhere|remote-first|fully distributed)\b/.test(
    snippet
  );
}
