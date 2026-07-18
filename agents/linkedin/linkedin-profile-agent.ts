import type { Agent } from "@/agents/core/agent";
import type { AgentContext, AgentResult } from "@/agents/core/context";
import { scrapeLinkedInProfile } from "@/agents/tools/linkedin-profile";
import { getProfile, saveLinkedInProfile } from "@/services/firestore";
import type { LinkedInProfileData } from "@/lib/types/integrations";

/** Crawl the user's LinkedIn /in/ profile into matching context. */
export const linkedInProfileAgent: Agent<void, LinkedInProfileData | null> = {
  name: "linkedin-profile-agent",
  async execute(
    _input: void,
    ctx: AgentContext
  ): Promise<AgentResult<LinkedInProfileData | null>> {
    try {
      const profile = await getProfile(ctx.userId);
      const url = profile?.linkedInUrl?.trim();
      if (!url) {
        return { success: true, data: null, metadata: { skipped: true } };
      }

      console.log(`[LinkedIn profile] Fetching ${url}`);
      const data = await scrapeLinkedInProfile(url, ctx.userId);
      data.userId = ctx.userId;
      await saveLinkedInProfile(data);

      if (data.status === "failed") {
        return {
          success: false,
          data,
          error: data.error ?? "LinkedIn profile fetch failed",
        };
      }

      console.log(
        `[LinkedIn profile] Saved ${data.rawText?.length ?? 0} chars, ${data.skills.length} skills, ${data.experience.length} roles`
      );
      return { success: true, data };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : "LinkedIn profile agent failed",
      };
    }
  },
};
