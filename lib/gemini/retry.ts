const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1500;

function isRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /503|502|429|500|504|unavailable|overloaded|rate limit|resource exhausted|deadline exceeded|internal error/i.test(
    message
  );
}

export function geminiDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry transient Gemini API failures (503, 429, etc.) with exponential backoff. */
export async function withGeminiRetry<T>(
  fn: () => Promise<T>,
  label = "request"
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === MAX_RETRIES || !isRetryableError(error)) {
        throw error;
      }
      const waitMs = BASE_DELAY_MS * 2 ** attempt;
      console.warn(
        `[Gemini] ${label} failed (${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${waitMs}ms:`,
        error instanceof Error ? error.message : error
      );
      await geminiDelay(waitMs);
    }
  }

  throw lastError;
}
