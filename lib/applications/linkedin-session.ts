import type { BrowserContext, Page } from "playwright";
import { isLinkedInAuthWall } from "@/lib/job-search/linkedin-urls";

const LOGIN_POLL_MS = 2000;

export async function isLinkedInLoggedIn(context: BrowserContext): Promise<boolean> {
  const cookies = await context.cookies([
    "https://www.linkedin.com",
    "https://nl.linkedin.com",
  ]);
  return cookies.some((c) => c.name === "li_at" && Boolean(c.value));
}

/**
 * Wait until the user signs into LinkedIn in the open Chrome window.
 * Works on authwall / login pages — session is saved in the persistent profile.
 */
export async function waitForLinkedInLogin(
  page: Page,
  context: BrowserContext,
  timeoutMs = 10 * 60 * 1000
): Promise<boolean> {
  if (await isLinkedInLoggedIn(context)) return true;

  console.log("[LinkedIn Apply] ─────────────────────────────────────────────");
  console.log("[LinkedIn Apply] Sign in required in the Chrome window that opened.");
  console.log("[LinkedIn Apply] 1. Click「Aanmelden」(Sign in) on the authwall page");
  console.log("[LinkedIn Apply] 2. Log in with your LinkedIn account");
  console.log("[LinkedIn Apply] 3. Apply will continue automatically once logged in");
  console.log("[LinkedIn Apply]    (saved in .data/linkedin-browser for next time)");
  console.log("[LinkedIn Apply] ─────────────────────────────────────────────");

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await isLinkedInLoggedIn(context)) {
      console.log("[LinkedIn Apply] Login detected — continuing apply…");
      return true;
    }

    const url = page.url();
    if (
      !isLinkedInAuthWall(url) &&
      !url.includes("linkedin.com/login") &&
      !url.includes("linkedin.com/uas/login") &&
      url.includes("linkedin.com")
    ) {
      console.log("[LinkedIn Apply] Left login page — continuing apply…");
      return true;
    }

    await page.waitForTimeout(LOGIN_POLL_MS);
  }

  console.warn("[LinkedIn Apply] Login wait timed out");
  return false;
}
