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
  const { candidateProfileAgent } = await import(
    "../agents/candidate-profile/candidate-profile-agent"
  );

  const auth = getAdminAuth();
  const user = await auth.getUserByEmail("mike@gmail.com");
  console.log("Re-synthesizing ladder for", user.uid);

  const result = await candidateProfileAgent.execute(undefined, {
    userId: user.uid,
  } as import("../agents/core/context").AgentContext);

  if (!result.success || !result.data) {
    throw new Error(result.error ?? "Synthesis failed");
  }

  const p = result.data;
  console.log(
    JSON.stringify(
      {
        level: p.experienceLevel,
        inferred: p.inferredRoles,
        current: p.careerLadder?.currentRole,
        summary: p.careerLadder?.summary,
        next: p.careerLadder?.nextRoles?.map((r) => ({
          title: r.title,
          branch: r.branch,
          q: r.searchQuery,
          gaps: r.gapsToClose,
        })),
        stretch: p.careerLadder?.stretchRoles?.map((r) => ({
          title: r.title,
          branch: r.branch,
          q: r.searchQuery,
          gaps: r.gapsToClose,
        })),
        gaps: p.gaps,
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
