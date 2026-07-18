import { getAdminFirestore, getAdminAuth } from "@/lib/firebase/admin";
import { sanitizeForFirestore } from "@/lib/firestore/sanitize";
import { nowIso } from "@/lib/utils/dates";
import {
  categorizeAiOperation,
  emptyCategoryTotals,
} from "@/lib/ai-usage/categories";
import type {
  AiUsageCall,
  AiUsageCategory,
  AiUsageCategoryTotals,
  AiUsageRecord,
  AiUsageAdminOverview,
  AiUsageAccountSummary,
  GeminiUsageMetadata,
} from "@/lib/types/ai-usage";

export type { AiUsageAdminOverview, AiUsageAccountSummary };

const COLLECTION = "aiUsage";

// Gemini 2.5 Flash approximate pricing (USD per 1M tokens)
const INPUT_COST_PER_M = 0.075;
const OUTPUT_COST_PER_M = 0.3;

function estimateCost(promptTokens: number, completionTokens: number): number {
  return (
    (promptTokens / 1_000_000) * INPUT_COST_PER_M +
    (completionTokens / 1_000_000) * OUTPUT_COST_PER_M
  );
}

export function extractUsageMetadata(
  metadata: GeminiUsageMetadata | undefined
): { promptTokens: number; completionTokens: number; totalTokens: number } {
  const promptTokens = metadata?.promptTokenCount ?? 0;
  const completionTokens = metadata?.candidatesTokenCount ?? 0;
  const totalTokens =
    metadata?.totalTokenCount ?? promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalTokens };
}

function bumpCategory(
  byCategory: Record<AiUsageCategory, AiUsageCategoryTotals>,
  category: AiUsageCategory,
  promptTokens: number,
  completionTokens: number,
  totalTokens: number,
  cost: number
) {
  const bucket = byCategory[category];
  bucket.promptTokens += promptTokens;
  bucket.completionTokens += completionTokens;
  bucket.totalTokens += totalTokens;
  bucket.requestCount += 1;
  bucket.estimatedCostUsd += cost;
}

export async function recordAiUsage(
  userId: string,
  operation: string,
  model: string,
  metadata: GeminiUsageMetadata | undefined
): Promise<void> {
  const { promptTokens, completionTokens, totalTokens } =
    extractUsageMetadata(metadata);
  if (totalTokens === 0) return;

  const cost = estimateCost(promptTokens, completionTokens);
  const category = categorizeAiOperation(operation);
  const db = getAdminFirestore();
  const ref = db.collection(COLLECTION).doc(userId);
  const snap = await ref.get();

  const call: AiUsageCall = {
    operation,
    category,
    model,
    promptTokens,
    completionTokens,
    totalTokens,
    estimatedCostUsd: cost,
    at: nowIso(),
  };

  const existing = snap.exists ? (snap.data() as AiUsageRecord) : null;
  const recentCalls = [call, ...(existing?.recentCalls ?? [])].slice(0, 20);

  const byCategory = emptyCategoryTotals();
  if (existing?.byCategory) {
    for (const key of Object.keys(byCategory) as AiUsageCategory[]) {
      const stored = existing.byCategory[key];
      if (stored) byCategory[key] = { ...stored };
    }
  }
  bumpCategory(byCategory, category, promptTokens, completionTokens, totalTokens, cost);

  const updated: AiUsageRecord = {
    userId,
    totalTokens: (existing?.totalTokens ?? 0) + totalTokens,
    promptTokens: (existing?.promptTokens ?? 0) + promptTokens,
    completionTokens: (existing?.completionTokens ?? 0) + completionTokens,
    requestCount: (existing?.requestCount ?? 0) + 1,
    estimatedCostUsd: (existing?.estimatedCostUsd ?? 0) + cost,
    lastUpdatedAt: nowIso(),
    recentCalls,
    byCategory,
  };

  await ref.set(sanitizeForFirestore(updated));
}

export async function getAiUsage(userId: string): Promise<AiUsageRecord | null> {
  const snap = await getAdminFirestore().collection(COLLECTION).doc(userId).get();
  return snap.exists ? (snap.data() as AiUsageRecord) : null;
}

export async function listAllAiUsage(): Promise<AiUsageAdminOverview> {
  const db = getAdminFirestore();
  const [usageSnap, profilesSnap] = await Promise.all([
    db.collection(COLLECTION).get(),
    db.collection("profiles").get(),
  ]);

  const profileByUserId = new Map<
    string,
    { email?: string; name?: string }
  >();
  for (const doc of profilesSnap.docs) {
    const data = doc.data() as { email?: string; name?: string };
    profileByUserId.set(doc.id, data);
  }

  const accounts: AiUsageAccountSummary[] = await Promise.all(
    usageSnap.docs.map(async (doc) => {
      const record = doc.data() as AiUsageRecord;
      const profile = profileByUserId.get(doc.id);
      let email = profile?.email ?? null;
      let name = profile?.name ?? null;

      if (!email) {
        try {
          const authUser = await getAdminAuth().getUser(doc.id);
          email = authUser.email ?? null;
          name = name ?? authUser.displayName ?? null;
        } catch {
          // Auth user may have been deleted
        }
      }

      return {
        ...record,
        userId: record.userId ?? doc.id,
        email,
        name,
      };
    })
  );

  accounts.sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);

  const totals = accounts.reduce(
    (acc, a) => {
      acc.totalTokens += a.totalTokens ?? 0;
      acc.promptTokens += a.promptTokens ?? 0;
      acc.completionTokens += a.completionTokens ?? 0;
      acc.requestCount += a.requestCount ?? 0;
      acc.estimatedCostUsd += a.estimatedCostUsd ?? 0;
      return acc;
    },
    {
      totalTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      requestCount: 0,
      estimatedCostUsd: 0,
      accountCount: accounts.length,
    }
  );

  return { accounts, totals };
}
