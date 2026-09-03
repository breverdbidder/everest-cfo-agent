// Writes CFO chat Q/A to public.finance_ops_log (issue #19764 build step 1: "Log Q/A to
// finance_ops_log"). cfo_agent_ro is otherwise a strictly read-only role (see
// worker/docs/PORTING_NOTES.md); this Worker's deploy added one narrow additive grant +
// RLS policy (`cfo_agent_ro_insert` on public.finance_ops_log only -- a public-schema ops
// log, not a finance.* business table) so chat activity is auditable without widening read
// access to anything else. Never throws -- a logging failure must not break the chat answer.

import type { SupabaseClient } from "@supabase/supabase-js";

export async function logChatQuery(
  client: SupabaseClient,
  params: { entity: string; question: string; sql: string; refused: boolean; rowCount: number },
): Promise<void> {
  try {
    await client.from("finance_ops_log").insert({
      dispatch_id: "19764",
      entity: params.entity,
      task: "cfo_chat_query",
      status: params.refused ? "SKIPPED" : "VERIFIED",
      evidence: { question: params.question, sql: params.sql, row_count: params.rowCount },
      severity: "info",
    });
  } catch {
    // best-effort telemetry only
  }
}
