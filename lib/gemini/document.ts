import { GoogleGenerativeAI } from "@google/generative-ai";
import { recordAiUsage } from "@/services/ai-usage";
import { withGeminiRetry } from "@/lib/gemini/retry";
import type { GeminiOptions } from "./client";

const MODEL = "gemini-2.5-flash";

function getClient(): GoogleGenerativeAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }
  return new GoogleGenerativeAI(apiKey);
}

/** Extract plain text from a document buffer using Gemini multimodal. */
export async function generateTextFromDocument(
  buffer: Buffer,
  mimeType: string,
  prompt: string,
  options?: GeminiOptions
): Promise<string> {
  const model = getClient().getGenerativeModel({ model: MODEL });
  const result = await withGeminiRetry(
    () =>
      model.generateContent([
        {
          inlineData: {
            mimeType,
            data: buffer.toString("base64"),
          },
        },
        { text: prompt },
      ]),
    options?.operation ?? "document_extraction"
  );
  if (options?.userId) {
    try {
      await recordAiUsage(
        options.userId,
        options.operation ?? "document_extraction",
        MODEL,
        result.response.usageMetadata
      );
    } catch (e) {
      console.error("[Gemini] Failed to record usage:", e);
    }
  }
  return result.response.text().trim();
}
