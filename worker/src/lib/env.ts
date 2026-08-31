// Full Worker environment (bindings + secrets). Shared by index.ts (the fetch handler,
// which needs the DO namespace + static asset binding) and agent.ts (the CfoAgent class,
// which the Agents SDK requires to type against the same Env as its namespace binding).

import type { CfoAgent } from "../agent";
import type { CfoEnv } from "./supabase";

export interface Env extends CfoEnv {
  CFO_AGENT: DurableObjectNamespace<CfoAgent>;
  ASSETS: Fetcher;
}
