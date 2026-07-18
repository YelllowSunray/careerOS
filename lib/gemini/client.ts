import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";
import { recordAiUsage } from "@/services/ai-usage";
import { withGeminiRetry } from "@/lib/gemini/retry";

const MODEL = "gemini-2.5-flash";

export interface GeminiOptions {
  userId?: string;
  operation?: string;
}

function getClient(): GoogleGenerativeAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }
  return new GoogleGenerativeAI(apiKey);
}

async function trackUsage(
  options: GeminiOptions | undefined,
  response: { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } }
) {
  if (!options?.userId) return;
  try {
    await recordAiUsage(
      options.userId,
      options.operation ?? "generate",
      MODEL,
      response.usageMetadata
    );
  } catch (e) {
    console.error("[Gemini] Failed to record usage:", e);
  }
}

export async function generateJson(
  prompt: string,
  options?: GeminiOptions
): Promise<unknown> {
  const model = getClient().getGenerativeModel({
    model: MODEL,
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  });

  const result = await withGeminiRetry(
    () => model.generateContent(prompt),
    options?.operation ?? "generateJson"
  );
  await trackUsage(options, result.response);
  return parseJsonResponse(result.response.text());
}

export async function generateText(
  prompt: string,
  options?: GeminiOptions
): Promise<string> {
  const model = getClient().getGenerativeModel({ model: MODEL });
  const result = await withGeminiRetry(
    () => model.generateContent(prompt),
    options?.operation ?? "generateText"
  );
  await trackUsage(options, result.response);
  return result.response.text();
}

function parseJsonResponse(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = fenced ? fenced[1].trim() : trimmed;
  return JSON.parse(jsonStr);
}

export { parseJsonResponse };

export async function generateStructured<T>(
  prompt: string,
  schema: z.ZodType<T>,
  options?: GeminiOptions
): Promise<T> {
  const model = getClient().getGenerativeModel({
    model: MODEL,
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  });

  try {
    const result = await withGeminiRetry(
      () => model.generateContent(prompt),
      options?.operation ?? "generateStructured"
    );
    await trackUsage(options, result.response);
    const text = result.response.text();
    const parsed = parseJsonResponse(text);
    const validated = schema.safeParse(parsed);
    if (!validated.success) {
      console.error("[Gemini] Schema validation failed. Raw response:", parsed);
      console.error("[Gemini] Validation errors:", validated.error.flatten());
      throw validated.error;
    }
    return validated.data;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Gemini request failed";
    throw new Error(`AI extraction failed: ${message}`);
  }
}
