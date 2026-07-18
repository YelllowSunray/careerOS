import type { Agent } from "@/agents/core/agent";
import type { AgentContext, AgentResult } from "@/agents/core/context";
import { synthesizeCandidateProfile } from "@/agents/tools/profile-extract";
import { buildCandidateContext } from "@/lib/candidate/context";
import { saveCandidateProfile } from "@/services/firestore";
import { nowIso } from "@/lib/utils/dates";
import type { CandidateProfile, CandidateProject } from "@/lib/types";

/** Phase A: Optional structured cache — uses raw text as primary input. */
export const candidateProfileAgent: Agent<void, CandidateProfile> = {
  name: "candidate-profile-agent",
  async execute(
    _input: void,
    ctx: AgentContext
  ): Promise<AgentResult<CandidateProfile>> {
    try {
      const context = await buildCandidateContext(ctx.userId);
      if (!context.hasRawSources) {
        return {
          success: false,
          error: "No resume, portfolio, or LinkedIn content to summarize",
        };
      }

      const resumeInput = context.resumeRawText
        ? `RAW RESUME TEXT:\n${context.resumeRawText.slice(0, 15000)}`
        : "No resume text";
      const structuredSupplement = context.resumeStructured
        ? `\n\nPARSED RESUME (supplement):\n${JSON.stringify(context.resumeStructured)}`
        : "";
      const portfolioSupplement = context.portfolioStructured
        ? `\n\nPARSED PORTFOLIO (supplement):\n${JSON.stringify(context.portfolioStructured)}`
        : "";

      const synthesized = await synthesizeCandidateProfile(
        {
          resumeJson: resumeInput + structuredSupplement,
          portfolioContent:
            context.portfolioRawText.slice(0, 15000) + portfolioSupplement,
          linkedInContent: context.linkedInRawText.slice(0, 15000),
        },
        ctx.userId
      );

      const projects: CandidateProject[] = synthesized.projects.map((p) => ({
        ...p,
        source: p.source as CandidateProject["source"],
      }));

      const profile: CandidateProfile = {
        userId: ctx.userId,
        skills: synthesized.skills,
        technologies: synthesized.technologies,
        projects,
        inferredRoles: synthesized.inferredRoles.map((r) => ({
          ...r,
          approved: true,
        })),
        experienceLevel: synthesized.experienceLevel,
        strengths: synthesized.strengths,
        gaps: synthesized.gaps,
        sources: {
          resume: context.resumeRawText.length > 0,
          portfolio: context.portfolioRawText.length > 0,
          linkedin: context.linkedInRawText.length > 0,
          github: false,
        },
        lastGeneratedAt: nowIso(),
        version: 1,
      };

      await saveCandidateProfile(profile);
      return { success: true, data: profile };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : "Profile summary failed",
      };
    }
  },
};
