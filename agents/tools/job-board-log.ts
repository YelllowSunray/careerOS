type JobBoardName = "linkedin" | "indeed";

export function logBoardInfo(board: JobBoardName, message: string, data?: unknown) {
  if (data !== undefined) {
    console.log(`[${board}] ${message}`, data);
    return;
  }
  console.log(`[${board}] ${message}`);
}

export function logBoardWarn(board: JobBoardName, message: string, error?: unknown) {
  if (error !== undefined) {
    console.warn(`[${board}] ${message}`, formatError(error));
    return;
  }
  console.warn(`[${board}] ${message}`);
}

export function logBoardError(board: JobBoardName, message: string, error?: unknown) {
  if (error !== undefined) {
    console.error(`[${board}] ${message}`, formatError(error));
    return;
  }
  console.error(`[${board}] ${message}`);
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  if (error && typeof error === "object") {
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}
