// Ported from agents/health_score.py::calculate_health_score (daniel-st3/ai-cfo-agent).
// Component weights (30/20/20/15/15) and scoring thresholds preserved verbatim.
//
// DEVIATION: the Python source calls Anthropic's API directly (litellm, model=
// "anthropic/claude-haiku-3-5") for the 2-3 sentence reasoning text. Per this repo's
// CLAUDE.md ("primary: Claude (Max plan, never API)"), this Worker must not call the
// Anthropic API. Reasoning is generated via DeepSeek V3.2 (the sanctioned cheap-tier
// LLM) when DEEPSEEK_API_KEY is configured, with the same static-fallback-on-failure
// behavior as the Python source when it isn't.

import type { AnomalyRecord, FraudAlertRecord, HealthScoreResult, KPISnapshot } from "./types";

const FALLBACK_REASONING =
  "Financial metrics are within expected ranges. " +
  "Continue monitoring burn rate and MRR growth closely. " +
  "Ensure customer retention initiatives stay on track.";

const SYSTEM_PROMPT =
  "You are an experienced CFO giving a direct financial health assessment. " +
  "Write exactly 2-3 sentences. Be specific with numbers. " +
  "Identify the single most important concern or positive, then give one concrete action. " +
  "Do not use markdown, bullet points, or headers - plain prose only.";

function scoreRunway(months: number): number {
  if (months > 12) return 100;
  if (months >= 9) return 80;
  if (months >= 6) return 60;
  if (months >= 3) return 40;
  return 20;
}

function scoreBurn(wowPct: number): number {
  if (wowPct < 0) return 100;
  if (wowPct < 0.05) return 80;
  if (wowPct < 0.15) return 60;
  if (wowPct < 0.3) return 40;
  return 20;
}

function scoreMrr(momPct: number): number {
  if (momPct > 0.1) return 100;
  if (momPct > 0.05) return 80;
  if (momPct > 0) return 60;
  if (momPct === 0) return 40;
  return 20;
}

function scoreLtvCac(ratio: number): number {
  if (ratio > 3) return 100;
  if (ratio > 2) return 80;
  if (ratio > 1) return 60;
  return 40;
}

function scoreRisk(highCount: number): number {
  if (highCount === 0) return 100;
  if (highCount <= 2) return 70;
  if (highCount <= 5) return 40;
  return 20;
}

/** Mirrors compute_survival_analysis's cash-estimate formula (see survival.ts). */
function estimateRunway(snapshots: KPISnapshot[]): number {
  const latest = snapshots[snapshots.length - 1];
  const totalBurned = snapshots.reduce((a, s) => a + s.burnRate, 0);
  const mrr = latest.mrr || 1;
  const initialCash = Math.max(mrr * 18.0, totalBurned * 2.0);
  const currentCash = Math.max(initialCash - totalBurned, mrr * 2.0);
  const weeklyBurn = Math.max(latest.burnRate, 1.0);
  return currentCash / weeklyBurn / 4.33;
}

async function getReasoning(
  params: {
    runwayMonths: number;
    burnWowPct: number;
    mrrMomPct: number;
    ltvCac: number;
    anomaliesHigh: number;
    fraudHigh: number;
    score: number;
    status: string;
    mrr: number;
    burnRate: number;
  },
  deepseekApiKey: string | undefined,
): Promise<string> {
  if (!deepseekApiKey) return FALLBACK_REASONING;

  const userPrompt =
    `Financial health score: ${params.score}/100 (${params.status.toUpperCase()})\n\n` +
    `Current metrics:\n` +
    `- Runway: ${params.runwayMonths.toFixed(1)} months\n` +
    `- Weekly burn: $${params.burnRate.toLocaleString()} (WoW change: ${(params.burnWowPct * 100).toFixed(1)}%)\n` +
    `- Weekly MRR: $${params.mrr.toLocaleString()} (MoM change: ${(params.mrrMomPct * 100).toFixed(1)}%)\n` +
    `- LTV:CAC ratio: ${params.ltvCac.toFixed(1)}x\n` +
    `- High-severity issues: ${params.anomaliesHigh} anomalies, ${params.fraudHigh} fraud alerts\n\n` +
    "Write a 2-3 sentence assessment for the founder.";

  try {
    const resp = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${deepseekApiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        temperature: 0.3,
        max_tokens: 150,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    if (!resp.ok) return FALLBACK_REASONING;
    const data = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    return text || FALLBACK_REASONING;
  } catch {
    return FALLBACK_REASONING;
  }
}

export async function calculateHealthScore(
  snapshots: KPISnapshot[],
  anomalies: AnomalyRecord[],
  fraudAlerts: FraudAlertRecord[],
  deepseekApiKey: string | undefined,
): Promise<HealthScoreResult | null> {
  if (snapshots.length === 0) return null;

  const latest = snapshots[snapshots.length - 1];
  const runwayMonths = estimateRunway(snapshots);
  const burnWowPct = latest.wowDelta.burn_rate ?? 0;
  const mrrMomPct = latest.momDelta.mrr ?? 0;
  const ltvCac = latest.ltv / Math.max(latest.cac, 1.0);

  const anomalyHigh = anomalies.filter((a) => a.severity === "HIGH").length;
  const fraudHigh = fraudAlerts.filter((f) => f.severity === "HIGH").length;
  const totalRisk = anomalyHigh + fraudHigh;

  const sRunway = scoreRunway(runwayMonths);
  const sBurn = scoreBurn(burnWowPct);
  const sMrr = scoreMrr(mrrMomPct);
  const sLtvCac = scoreLtvCac(ltvCac);
  const sRisk = scoreRisk(totalRisk);

  let score = Math.round(sRunway * 0.3 + sBurn * 0.2 + sMrr * 0.2 + sLtvCac * 0.15 + sRisk * 0.15);
  score = Math.max(0, Math.min(100, score));

  const status: HealthScoreResult["status"] = score >= 80 ? "healthy" : score >= 60 ? "warning" : "critical";

  const reasoning = await getReasoning(
    {
      runwayMonths,
      burnWowPct,
      mrrMomPct,
      ltvCac,
      anomaliesHigh: anomalyHigh,
      fraudHigh,
      score,
      status,
      mrr: latest.mrr,
      burnRate: latest.burnRate,
    },
    deepseekApiKey,
  );

  return {
    score,
    status,
    reasoning,
    components: {
      runway: sRunway,
      burnStability: sBurn,
      revenueGrowth: sMrr,
      unitEconomics: sLtvCac,
      riskFactors: sRisk,
    },
    cached: false,
    timestamp: new Date().toISOString(),
  };
}
