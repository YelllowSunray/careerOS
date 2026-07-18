import type { AgentContext, AgentResult } from "./context";

export interface Agent<TInput, TOutput> {
  name: string;
  execute(input: TInput, ctx: AgentContext): Promise<AgentResult<TOutput>>;
}
