import type { Agent } from "@/agents/core/agent";
import type { AgentContext, AgentResult } from "@/agents/core/context";
import { extractResumeText } from "@/agents/tools/resume-text-extract";
import { extractResumeData } from "@/agents/tools/profile-extract";
import { saveResume, getProfile, saveProfile } from "@/services/firestore";
import { emptyResumeExtracted } from "@/lib/candidate/context";
import { nowIso } from "@/lib/utils/dates";
import type { ResumeData } from "@/lib/types";

export interface ResumeAgentInput {
  storagePath: string;
  fileName: string;
}

export interface ResumeAgentResult {
  data: ResumeData;
  rawTextSaved: boolean;
  structuredExtraction: "complete" | "failed" | "skipped";
  structuredError?: string;
}

/** Phase A: Always save raw text. Structured extraction is best-effort only. */
export const resumeAgent: Agent<ResumeAgentInput, ResumeAgentResult> = {
  name: "resume-agent",
  async execute(
    input: ResumeAgentInput,
    ctx: AgentContext
  ): Promise<AgentResult<ResumeAgentResult>> {
    try {
      const rawText = await extractResumeText(
        input.storagePath,
        input.fileName,
        ctx.userId
      );
      if (!rawText.trim()) {
        throw new Error("Could not extract text from resume file");
      }

      const base: ResumeData = {
        userId: ctx.userId,
        rawText,
        extracted: emptyResumeExtracted(),
        processedAt: nowIso(),
        version: 1,
      };
      await saveResume(base);

      let structuredExtraction: ResumeAgentResult["structuredExtraction"] = "skipped";
      let structuredError: string | undefined;

      try {
        const extracted = await extractResumeData(rawText, ctx.userId);
        base.extracted = extracted;
        structuredExtraction = "complete";
        await saveResume(base);

        if (extracted.phoneNumber) {
          const profile = await getProfile(ctx.userId);
          if (profile && !profile.phoneNumber) {
            await saveProfile({
              ...profile,
              phoneNumber: extracted.phoneNumber,
              updatedAt: nowIso(),
            });
          }
        }
      } catch (e) {
        structuredExtraction = "failed";
        structuredError = e instanceof Error ? e.message : "Structured extraction failed";
        console.warn("[Resume agent] Structured extraction failed (raw text saved):", structuredError);
      }

      return {
        success: true,
        data: {
          data: base,
          rawTextSaved: true,
          structuredExtraction,
          structuredError,
        },
      };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : "Resume ingest failed",
      };
    }
  },
};
