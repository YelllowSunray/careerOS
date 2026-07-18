import { z } from "zod";
import { generateJson } from "@/lib/gemini/client";
import { formatContextForPrompt } from "@/lib/candidate/context";
import type { CandidateContext } from "@/lib/types/candidate-context";

const actionSchema = z.object({
  action: z.enum([
    "fill",
    "click",
    "select",
    "upload",
    "navigate",
    "wait",
    "done",
    "pause",
  ]),
  selector: z.string().optional(),
  value: z.string().optional(),
  reasoning: z.string().optional(),
});

export type BrowserAction = z.infer<typeof actionSchema>;

export interface PageObservation {
  url: string;
  title: string;
  fields: { selector: string; type: string; label: string; name?: string }[];
  buttons: { selector: string; text: string }[];
  textSnippet: string;
}

function parseActionPlan(raw: unknown): BrowserAction[] {
  const items = Array.isArray(raw) ? raw : [raw];
  const validated = z.array(actionSchema).safeParse(items);
  if (!validated.success) {
    console.error("[Apply] Action plan validation failed:", raw);
    throw validated.error;
  }
  return validated.data;
}

export async function decideBrowserActions(
  observation: PageObservation,
  goal: string,
  context: CandidateContext,
  previousActions: string[],
  debugPreview = false,
  linkedIn = false
): Promise<BrowserAction[]> {
  const candidateBlock = formatContextForPrompt(context, 8000);

  const debugNote = debugPreview
    ? linkedIn
      ? "\nIMPORTANT: DEBUG PREVIEW on LinkedIn — Solliciteren/Easy Apply already done. Never click final Submit/Verzenden. You may click Next/Volgende between steps. End with action \"done\" when fields are filled."
      : "\nIMPORTANT: DEBUG PREVIEW — never click Submit/Apply/Send/Verzenden. End with action \"done\" when fields are filled."
    : "";

  const prompt = `You are a browser automation agent filling out a job application form.

Return a JSON ARRAY of actions to execute in order. Example:
[
  { "action": "fill", "selector": "#email", "value": "user@example.com" },
  { "action": "upload", "selector": "input[type=file]", "value": "resume" },
  { "action": "done" }
]

Include ALL empty fields in one batch. Use selectors from the PAGE lists below.
For fill/select include "value" from the candidate profile when possible.
For uploads: "value": "resume" or "cover_letter".
If you see a CAPTCHA, return [{ "action": "pause" }].
${debugNote}

GOAL: ${goal}

CANDIDATE SOURCES:
${candidateBlock}

PREVIOUS ACTIONS: ${previousActions.join(" → ") || "none"}

PAGE:
URL: ${observation.url}
Title: ${observation.title}
Fields: ${JSON.stringify(observation.fields.slice(0, 40))}
Buttons: ${JSON.stringify(observation.buttons.slice(0, 25))}
Text: ${observation.textSnippet.slice(0, 3000)}`;

  const raw = await generateJson(prompt, {
    userId: context.userId,
    operation: "browser_action",
  });

  const actions = parseActionPlan(raw);

  if (actions.length > 1) {
    console.log(`[Apply] AI returned ${actions.length} actions — executing batch`);
  }

  return actions;
}
