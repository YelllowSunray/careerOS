/**
 * Load mike@gmail.com jobs + matches for match-quality calibration.
 * Usage: npx tsx scripts/calibrate-mike.ts
 */
import { readFileSync } from "fs";
import { resolve } from "path";

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    let val = m[2].trim();
    if (
      (val.startsWith("'") && val.endsWith("'")) ||
      (val.startsWith('"') && val.endsWith('"'))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvLocal();

async function main() {
  const { getAdminAuth } = await import("@/lib/firebase/admin");
  const {
    getJobs,
    getJobMatches,
    getCandidateProfile,
    getProfile,
    getResume,
  } = await import("@/services/firestore");

  const auth = getAdminAuth();
  const user = await auth.getUserByEmail("mike@gmail.com");
  const userId = user.uid;
  console.log("userId:", userId);

  const [profile, resume, candidate, jobs, matches] = await Promise.all([
    getProfile(userId),
    getResume(userId),
    getCandidateProfile(userId),
    getJobs(userId),
    getJobMatches(userId),
  ]);

  console.log("\n=== PROFILE ===");
  console.log({
    name: profile?.name,
    home: profile?.homeLocation,
    commute: `${profile?.commuteMode} / ${profile?.commuteMaxMinutes}`,
    languages: profile?.languagesSpoken,
    prefs: profile?.jobPreferences?.slice(0, 200),
    country: profile?.preferredCountries,
  });

  console.log("\n=== LADDER / INFERRED ===");
  console.log("current:", candidate?.careerLadder?.currentRole);
  console.log(
    "next:",
    candidate?.careerLadder?.nextRoles?.map((r) => `${r.title} (${r.branch})`)
  );
  console.log(
    "stretch:",
    candidate?.careerLadder?.stretchRoles?.map(
      (r) => `${r.title} (${r.branch})`
    )
  );
  console.log(
    "inferred:",
    candidate?.inferredRoles?.map((r) => `${r.role} ${r.confidence}`)
  );
  console.log("level:", candidate?.experienceLevel);
  console.log("gaps:", candidate?.gaps?.slice(0, 10));

  const byJob = new Map(matches.map((m) => [m.jobId, m]));
  const sorted = [...jobs].sort((a, b) => {
    const ma = byJob.get(a.id);
    const mb = byJob.get(b.id);
    return (mb?.fitScore ?? 0) - (ma?.fitScore ?? 0);
  });

  console.log(`\n=== JOBS (${jobs.length}) / MATCHES (${matches.length}) ===\n`);
  for (const job of sorted) {
    const m = byJob.get(job.id);
    console.log("---");
    console.log(`${job.title} @ ${job.company}`);
    console.log(`loc: ${job.location ?? "?"} | ${job.applicationUrl}`);
    if (!m) {
      console.log("(no match)");
      continue;
    }
    console.log(
      `fit=${m.fitScore} C=${m.contributionScore} L=${m.learningScore} M=${m.moneyScore} S=${m.scopeIncrease} path=${m.pathType} dest=${m.matchedDestination ?? "-"}`
    );
    console.log(
      `skillMet=${m.skillRequirementMet} commuteMet=${m.commuteRequirementMet} langMet=${m.languageRequirementMet} prefs=${m.preferencesMatch} apply=${m.applyRecommendation}`
    );
    console.log(`commute: ${m.commuteNotes ?? "-"} | est=${m.estimatedCommuteMinutes ?? "?"}`);
    console.log(`skillNotes: ${m.skillNotes ?? "-"}`);
    console.log(`reasoning: ${(m.reasoning ?? "").slice(0, 280)}`);
    const hard = (m.missingSkills ?? []).filter((s) => s.isHardRequirement);
    const soft = (m.missingSkills ?? []).filter((s) => !s.isHardRequirement);
    console.log(
      `hard gaps (${hard.length}): ${hard.map((s) => s.skill).join("; ") || "—"}`
    );
    console.log(
      `soft gaps (${soft.length}): ${soft.map((s) => s.skill).join("; ") || "—"}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
