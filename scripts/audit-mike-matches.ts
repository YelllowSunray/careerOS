import { readFileSync } from "fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if (
    (v.startsWith("'") && v.endsWith("'")) ||
    (v.startsWith('"') && v.endsWith('"'))
  ) {
    v = v.slice(1, -1);
  }
  process.env[m[1].trim()] = v;
}

async function main() {
  const { getAdminAuth } = await import("../lib/firebase/admin");
  const {
    getJobs,
    getJobMatches,
    getProfile,
    getCandidateProfile,
  } = await import("../services/firestore");
  const { normalizeWorkPreferences } = await import(
    "../lib/job-search/work-preference"
  );

  const auth = getAdminAuth();
  const user = await auth.getUserByEmail("mike@gmail.com");
  console.log("uid", user.uid);

  const [profile, candidate, jobs, matches] = await Promise.all([
    getProfile(user.uid),
    getCandidateProfile(user.uid),
    getJobs(user.uid),
    getJobMatches(user.uid),
  ]);

  const matchMap = new Map(matches.map((m) => [m.jobId, m]));
  console.log("\n=== PROFILE ===");
  console.log(
    JSON.stringify(
      {
        name: profile?.name,
        languages: profile?.languagesSpoken,
        home: profile?.homeLocation,
        commuteMode: profile?.commuteMode,
        commuteMax: profile?.commuteMaxMinutes,
        prefs: profile?.jobPreferences,
        workPref: normalizeWorkPreferences(profile ?? {}),
        country: profile?.preferredCountries,
      },
      null,
      2
    )
  );

  console.log("\n=== LADDER / INFERRED ===");
  console.log(
    JSON.stringify(
      {
        current: candidate?.careerLadder?.currentRole,
        summary: candidate?.careerLadder?.summary,
        next: candidate?.careerLadder?.nextRoles?.map((r) => ({
          title: r.title,
          branch: r.branch,
          gaps: r.gapsToClose,
          q: r.searchQuery,
        })),
        stretch: candidate?.careerLadder?.stretchRoles?.map((r) => ({
          title: r.title,
          branch: r.branch,
          gaps: r.gapsToClose,
          q: r.searchQuery,
        })),
        inferred: candidate?.inferredRoles,
        gaps: candidate?.gaps,
        level: candidate?.experienceLevel,
      },
      null,
      2
    )
  );

  console.log(
    "\n=== JOBS + MATCHES",
    jobs.length,
    "jobs",
    matches.length,
    "matches ==="
  );
  const sorted = [...jobs].sort(
    (a, b) =>
      (matchMap.get(b.id)?.fitScore ?? 0) - (matchMap.get(a.id)?.fitScore ?? 0)
  );
  for (const job of sorted) {
    const m = matchMap.get(job.id);
    console.log("\n---");
    console.log(
      JSON.stringify(
        {
          title: job.title,
          company: job.company,
          location: job.location,
          fit: m?.fitScore,
          path: m?.pathType,
          scope: m?.scopeIncrease,
          dest: m?.matchedDestination,
          C: m?.contributionScore,
          L: m?.learningScore,
          M: m?.moneyScore,
          skillMet: m?.skillRequirementMet,
          skillNotes: m?.skillNotes,
          commuteMet: m?.commuteRequirementMet,
          commuteNotes: m?.commuteNotes,
          commuteMin: m?.estimatedCommuteMinutes,
          prefsMatch: m?.preferencesMatch,
          apply: m?.applyRecommendation,
          hardGaps: m?.missingSkills
            ?.filter((s) => s.isHardRequirement)
            .map((s) => s.skill),
          softGaps: m?.missingSkills
            ?.filter((s) => !s.isHardRequirement)
            .map((s) => s.skill),
          reasoning: m?.reasoning?.slice(0, 320),
        },
        null,
        2
      )
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
