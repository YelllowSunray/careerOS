import type { Agent } from "@/agents/core/agent";
import type { AgentContext, AgentResult } from "@/agents/core/context";
import { crawlPortfolioSite } from "@/agents/tools/portfolio-crawl";
import {
  extractPortfolioData,
  toPortfolioProjects,
} from "@/agents/tools/portfolio-extract";
import { savePortfolioSite } from "@/services/firestore";
import { normalizeUrl } from "@/lib/utils/url";
import { nowIso } from "@/lib/utils/dates";
import type { PortfolioSite } from "@/lib/types";

export interface PortfolioAgentInput {
  url: string;
  siteId: string;
}

/** Crawl portfolio site, then AI-extract skills, technologies, and projects. */
export const portfolioAgent: Agent<PortfolioAgentInput, PortfolioSite> = {
  name: "portfolio-agent",
  async execute(
    input: PortfolioAgentInput,
    ctx: AgentContext
  ): Promise<AgentResult<PortfolioSite>> {
    const site: PortfolioSite = {
      id: input.siteId,
      userId: ctx.userId,
      url: normalizeUrl(input.url),
      status: "crawling",
      pagesCrawled: 0,
      pageTexts: [],
      structuredProjects: [],
    };

    try {
      await savePortfolioSite(site);
      const pages = await crawlPortfolioSite(site.url);
      site.pageTexts = pages.map((p) => ({
        url: p.url,
        title: p.title,
        text: p.text,
      }));
      site.pagesCrawled = pages.length;

      if (site.pageTexts.length > 0) {
        try {
          const extracted = await extractPortfolioData(site.pageTexts, ctx.userId);
          site.structuredProjects = toPortfolioProjects(extracted);
          site.extracted = {
            skills: extracted.skills,
            technologies: extracted.technologies,
            summary: extracted.summary,
          };
        } catch (e) {
          console.warn(
            "[Portfolio agent] AI extraction failed (page text saved):",
            e instanceof Error ? e.message : e
          );
        }
      }

      site.status = "complete";
      site.completedAt = nowIso();
      await savePortfolioSite(site);

      return { success: true, data: site };
    } catch (e) {
      site.status = "failed";
      site.error = e instanceof Error ? e.message : "Portfolio crawl failed";
      await savePortfolioSite(site);
      return { success: false, error: site.error, data: site };
    }
  },
};
