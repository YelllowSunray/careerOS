/** Primary place label for grouping job cards (e.g. "Almere, NL" → "Almere"). */
export function locationClumpLabel(location: string | undefined | null): string {
  let s = (location ?? "").trim();
  if (!s) return "Unknown location";

  s = s.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();

  const primary = (s.split(/[,|·]/)[0] ?? s).trim();
  if (!primary) return "Unknown location";

  if (
    /^(remote|fully remote|work from home|wfh|anywhere|worldwide)$/i.test(
      primary
    )
  ) {
    return "Remote";
  }
  if (/^remote\b/i.test(primary) && primary.length < 48) {
    return "Remote";
  }

  const cleaned = primary
    .replace(/\s+(metropolitan\s+)?area$/i, "")
    .replace(/\s+region$/i, "")
    .replace(/\s+and\s+surroundings$/i, "")
    .trim();

  if (!cleaned) return "Unknown location";

  // Preserve existing casing when mixed; otherwise capitalize first letter.
  if (cleaned !== cleaned.toLowerCase()) return cleaned;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

const TRAILING_CLUMPS = new Set(["Remote", "Unknown location"]);

export function groupJobsByLocationClump<T extends { location: string }>(
  jobs: T[]
): { key: string; label: string; jobs: T[] }[] {
  const map = new Map<string, T[]>();
  for (const job of jobs) {
    const label = locationClumpLabel(job.location);
    const list = map.get(label);
    if (list) list.push(job);
    else map.set(label, [job]);
  }

  return [...map.entries()]
    .map(([label, groupJobs]) => ({
      key: label.toLowerCase(),
      label,
      jobs: groupJobs,
    }))
    .sort((a, b) => {
      const aTrail = TRAILING_CLUMPS.has(a.label) ? 1 : 0;
      const bTrail = TRAILING_CLUMPS.has(b.label) ? 1 : 0;
      if (aTrail !== bTrail) return aTrail - bTrail;
      return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
    });
}
