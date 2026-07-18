import { z } from "zod";

/** Convert a Zod object schema to a JSON schema description for Gemini prompts. */
export function zodToJsonSchema(schema: z.ZodType): string {
  // Gemini structured output uses responseMimeType: application/json;
  // Zod validates the response. Return shape hints for the prompt.
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(shape)) {
      fields[key] = describeZodType(value as z.ZodType);
    }
    return JSON.stringify(fields, null, 2);
  }
  return "{}";
}

function describeZodType(schema: z.ZodType): string {
  if (schema instanceof z.ZodString) return "string";
  if (schema instanceof z.ZodNumber) return "number";
  if (schema instanceof z.ZodBoolean) return "boolean";
  if (schema instanceof z.ZodArray) {
    return `array of ${describeZodType(schema.element as z.ZodType)}`;
  }
  if (schema instanceof z.ZodEnum) return `enum: ${schema.options.join(" | ")}`;
  if (schema instanceof z.ZodOptional) {
    return `optional ${describeZodType(schema.unwrap() as z.ZodType)}`;
  }
  if (schema instanceof z.ZodObject) return "object";
  return "unknown";
}
