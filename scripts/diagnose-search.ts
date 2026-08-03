/**
 * Diagnose empty job search for a user by email.
 * Usage: npx tsx scripts/diagnose-search.ts malaiyer8@gmail.com
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
  const email = process.argv[2] || "malaiyer8@gmail.com";
  const { getAdminAuth } = await import("../lib/firebase/admin");
  const {
    getProfile,
    getCandidateProfile,
    getJobs,
    getJobMatches,
    getFeedbackPreferenceState,
    getLatestWorkflow,
  } = await import("../services/firestore");
  const {
    getLaneQueries,
    resolveNeverList,
    shouldUseStrategyLanes,
  } = await import("../lib/job-search/strategy");
  const { getEnabledTargetSearchQueries } = await import(
    "../lib/job-search/target-roles"
  );

  const user = await getAdminAuth().getUserByEmail(email);
  const uid = user.uid;
  const [profile, candidate, jobs, matches, feedback, workflow] =
    await Promise.all([
      getProfile(uid),
      getCandidateProfile(uid),
      getJobs(uid),
      getJobMatches(uid),
      getFeedbackPreferenceState(uid),
      getLatestWorkflow(uid, "find_jobs"),
    ]);

  const never = profile ? resolveNeverList(profile) : [];
  const lanes = profile
    ? getLaneQueries(profile, { emptyFunnel: false, language: "en" })
    : [];
  const lanesEmpty = profile
    ? getLaneQueries(profile, { emptyFunnel: true, language: "en" })
    : [];

  console.log(
    JSON.stringify(
      {
        uid,
        email,
        name: profile?.name,
        jobPreferences: profile?.jobPreferences,
        languagesSpoken: profile?.languagesSpoken,
        preferredCountries: profile?.preferredCountries,
        homeLocation: profile?.homeLocation,
        commuteMode: profile?.commuteMode,
        commuteMaxMinutes: profile?.commuteMaxMinutes,
        targetRoles: profile?.targetRoles,
        careerIntent: profile?.careerIntent,
        searchStrategy: profile?.searchStrategy,
        showStretchTargets: profile?.settings?.showStretchTargets,
        jobSearchLanguage: profile?.settings?.jobSearchLanguage,
        inferredRoles: candidate?.inferredRoles,
        experienceLevel: candidate?.experienceLevel,
        ladderCurrent: candidate?.careerLadder?.currentRole,
        ladderNext: candidate?.careerLadder?.nextRoles?.map((r) => r.title),
        enabledTargetQueries: profile
          ? getEnabledTargetSearchQueries(profile)
          : [],
        shouldUseStrategyLanes: profile
          ? shouldUseStrategyLanes(profile)
          : false,
        neverListResolved: never,
        laneQueries: lanes,
        emptyFunnelLaneQueries: lanesEmpty,
        jobsCount: jobs.length,
        matchesCount: matches.length,
        jobTitlesSample: jobs
          .slice(0, 20)
          .map((j) => `${j.title} @ ${j.company} [${j.status}]`),
        feedbackConstraints: feedback?.learnedConstraints,
        feedbackGuidance: feedback?.guidanceSummary,
        experienceCeiling: feedback?.experienceCeiling,
        hiddenJobIds: feedback?.hiddenJobIds?.length ?? 0,
        workflowStatus: workflow?.status,
        workflowConfig: workflow
          ? {
              round: workflow.config?.round,
              roundsWithoutSave: workflow.config?.roundsWithoutSave,
              emptyFunnelActive: workflow.config?.emptyFunnelActive,
              searchPlan: workflow.config?.searchPlan,
              lastRoundDiscovered: workflow.config?.lastRoundDiscovered,
              evaluatedCount: Array.isArray(
                workflow.config?.evaluatedListingKeys
              )
                ? workflow.config.evaluatedListingKeys.length
                : 0,
            }
          : null,
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
