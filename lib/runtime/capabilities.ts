/**
 * Runtime capability flags for serverless vs local.
 * Playwright browsers are not available on Vercel serverless functions.
 */
export function supportsPlaywright(): boolean {
  if (process.env.DISABLE_PLAYWRIGHT === "1") return false;
  if (process.env.VERCEL === "1") return false;
  return true;
}
