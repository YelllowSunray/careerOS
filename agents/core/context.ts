import * as gemini from "@/lib/gemini/client";

export interface AgentContext {
  userId: string;
  gemini: typeof gemini;
}

export interface AgentResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  paused?: boolean;
  metadata?: Record<string, unknown>;
}

export function createContext(userId: string): AgentContext {
  return {
    userId,
    gemini,
  };
}
