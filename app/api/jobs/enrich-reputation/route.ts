import { NextRequest } from "next/server";
import { verifyAuth, jsonError, jsonOk, AuthError } from "@/lib/api/auth";
import {
  getOrFetchCompanyReputation,
  normalizeCompanyKey,
  reputationNeedsRefresh,
} from "@/agents/tools/company-reputation";
import { getJobs, saveJob } from "@/services/firestore";
import { supportsPlaywright } from "@/lib/runtime/capabilities";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_COMPANIES_PER_REQUEST = 8;

/**
 * Background Indeed company-reputation enrichment for saved jobs.
 * Does not run on the find-jobs critical path.
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await verifyAuth(request);

    if (!supportsPlaywright()) {
      return jsonOk({
        skipped: true,
        reason: "playwright_unavailable",
        updated: 0,
        checked: 0,
      });
    }

    const jobs = (await getJobs(userId)).filter((j) => j.status !== "archived");

    // Unique companies that need a refresh, preserving job order.
    const companies: string[] = [];
    const seen = new Set<string>();
    for (const job of jobs) {
      const key = normalizeCompanyKey(job.company);
      if (!key || seen.has(key)) continue;
      if (!reputationNeedsRefresh(job.companyReputation)) continue;
      seen.add(key);
      companies.push(job.company.trim());
      if (companies.length >= MAX_COMPANIES_PER_REQUEST) break;
    }

    if (companies.length === 0) {
      return jsonOk({ updated: 0, checked: 0, remaining: 0 });
    }

    const byKey = new Map<
      string,
      Awaited<ReturnType<typeof getOrFetchCompanyReputation>>
    >();

    let checked = 0;
    for (const company of companies) {
      checked++;
      const rep = await getOrFetchCompanyReputation(company);
      byKey.set(normalizeCompanyKey(company), rep);
      console.log(
        `[Jobs reputation] ${company}: ${rep.status}` +
          (rep.rating != null ? ` ${rep.rating}` : "") +
          (rep.reviewCount != null ? ` (${rep.reviewCount} reviews)` : "")
      );
    }

    let updated = 0;
    for (const job of jobs) {
      const key = normalizeCompanyKey(job.company);
      const rep = byKey.get(key);
      if (!rep) continue;
      await saveJob({ ...job, companyReputation: rep });
      updated++;
    }

    const stillNeed = jobs.filter((j) =>
      reputationNeedsRefresh(
        byKey.get(normalizeCompanyKey(j.company)) ?? j.companyReputation
      )
    ).length;

    return jsonOk({
      checked,
      updated,
      remaining: stillNeed,
      skipped: false,
    });
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.message, 401);
    console.error("[Jobs reputation]", e);
    return jsonError(
      e instanceof Error ? e.message : "Failed to enrich company reputation",
      500
    );
  }
}
