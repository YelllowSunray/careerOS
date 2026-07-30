/**
 * Dump current jobs + matches for review (uses FIREBASE_SERVICE_ACCOUNT_JSON).
 * Usage: npx tsx scripts/dump-matches.ts [userId]
 */
import { readFileSync } from "fs";
import { resolve } from "path";

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if (
      (v.startsWith("'") && v.endsWith("'")) ||
      (v.startsWith('"') && v.endsWith('"'))
    ) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}

loadEnvLocal();

async function main() {
  const { getJobs, getJobMatches, getCandidateProfile, getProfile } =
    await import("../services/firestore");
  const { getAdminFirestore } = await import("../lib/firebase/admin");

  let userId = process.argv[2];
  if (!userId) {
    const db = getAdminFirestore();
    const snap = await db.collection("jobs").limit(80).get();
    const byUser = new Map<string, number>();
    for (const d of snap.docs) {
      const uid = String(d.data().userId ?? "");
      if (uid) byUser.set(uid, (byUser.get(uid) ?? 0) + 1);
    }
    console.error("Users with jobs:", Object.fromEntries(byUser));
    userId = [...byUser.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  }
  if (!userId) {
    console.error("No userId found");
    process.exit(1);
  }

  const [profile, candidate, jobs, matches] = await Promise.all([
    getProfile(userId),
    getCandidateProfile(userId),
    getJobs(userId),
    getJobMatches(userId),
  ]);

  const matchByJob = new Map(matches.map((m) => [m.jobId, m]));

  console.log(
    JSON.stringify(
      {
        userId,
        profile: profile
          ? {
              name: profile.name,
              homeLocation: profile.homeLocation,
              commuteMode: profile.commuteMode,
              commuteMaxMinutes: profile.commuteMaxMinutes,
              jobPreferences: profile.jobPreferences,
              languagesSpoken: profile.languagesSpoken,
              preferredCountries: profile.preferredCountries,
            }
          : null,
        ladder: candidate?.careerLadder ?? null,
        inferredRoles: candidate?.inferredRoles ?? [],
        experienceLevel: candidate?.experienceLevel,
        jobs: jobs
          .map((j) => {
            const m = matchByJob.get(j.id);
            return {
              title: j.title,
              company: j.company,
              location: j.location,
              url: j.applicationUrl,
              fitScore: m?.fitScore,
              pathType: m?.pathType,
              scopeIncrease: m?.scopeIncrease,
              contributionScore: m?.contributionScore,
              learningScore: m?.learningScore,
              moneyScore: m?.moneyScore,
              preferencesMatch: m?.preferencesMatch,
              commuteRequirementMet: m?.commuteRequirementMet,
              commuteNotes: m?.commuteNotes,
              estimatedCommuteMinutes: m?.estimatedCommuteMinutes,
              skillRequirementMet: m?.skillRequirementMet,
              skillNotes: m?.skillNotes,
              applyRecommendation: m?.applyRecommendation,
              matchedDestination: m?.matchedDestination,
              ladderPath: m?.ladderPath,
              reasoning: m?.reasoning,
              preferenceAlignment: m?.preferenceAlignment,
              strengths: m?.strengths,
              missingSkills: m?.missingSkills,
            };
          })
          .sort((a, b) => (b.fitScore ?? 0) - (a.fitScore ?? 0)),
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
