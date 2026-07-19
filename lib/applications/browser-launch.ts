import fs from "fs";
import os from "os";
import path from "path";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { BROWSER_UA } from "@/lib/job-search/linkedin-urls";
import { isLinkedInLoggedIn } from "@/lib/applications/linkedin-session";

// turbopackIgnore: avoid Next NFT tracing the entire project from process.cwd().
const DEFAULT_PROFILE_DIR = path.join(
  process.env.VERCEL
    ? os.tmpdir()
    : /* turbopackIgnore: true */ process.cwd(),
  process.env.VERCEL ? "career-os-linkedin-browser" : ".data/linkedin-browser"
);
const COOKIES_PATH = path.join(DEFAULT_PROFILE_DIR, "linkedin-cookies.json");

const STEALTH_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--no-first-run",
  "--no-default-browser-check",
];

const PROFILE_LOCK_FILES = ["SingletonLock", "SingletonSocket", "SingletonCookie"];

export type DebugBrowser = {
  context: BrowserContext;
  browser: Browser | null;
  page: Awaited<ReturnType<BrowserContext["newPage"]>>;
  close: () => Promise<void>;
  profileDir: string;
  usesSystemChrome: boolean;
};

let activeClose: (() => Promise<void>) | null = null;
let launchChain: Promise<unknown> = Promise.resolve();

function expandHome(filePath: string): string {
  if (filePath.startsWith("~/")) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

function isProfileInUseError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /existing browser session|profile is already in use|SingletonLock/i.test(msg);
}

function clearProfileLocks(userDataDir: string): void {
  for (const file of PROFILE_LOCK_FILES) {
    try {
      fs.unlinkSync(path.join(userDataDir, file));
    } catch {
      // ignore
    }
  }
}

async function saveCookies(context: BrowserContext): Promise<void> {
  try {
    const cookies = await context.cookies();
    fs.mkdirSync(DEFAULT_PROFILE_DIR, { recursive: true });
    fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 0));
  } catch (e) {
    console.warn("[Apply Preview] Could not save cookies:", e);
  }
}

async function restoreCookies(context: BrowserContext): Promise<void> {
  if (!fs.existsSync(COOKIES_PATH)) return;
  try {
    const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, "utf8")) as Parameters<
      BrowserContext["addCookies"]
    >[0];
    if (cookies.length > 0) {
      await context.addCookies(cookies);
      console.log("[Apply Preview] Restored LinkedIn cookies from saved session.");
    }
  } catch (e) {
    console.warn("[Apply Preview] Could not restore cookies:", e);
  }
}

function resolveChromeProfile(): {
  userDataDir: string;
  extraArgs: string[];
  usesSystemChrome: boolean;
} {
  const userData = process.env.APPLY_CHROME_USER_DATA?.trim();
  if (userData) {
    const userDataDir = expandHome(userData);
    const profileName = process.env.APPLY_CHROME_PROFILE?.trim() || "Default";
    console.log(
      `[Apply Preview] Using your Chrome profile: ${userDataDir} (${profileName})`
    );
    console.log(
      "[Apply Preview] Quit Google Chrome completely before Apply (same profile cannot open twice)."
    );
    return {
      userDataDir,
      extraArgs: [`--profile-directory=${profileName}`],
      usesSystemChrome: true,
    };
  }

  fs.mkdirSync(DEFAULT_PROFILE_DIR, { recursive: true });
  return {
    userDataDir: DEFAULT_PROFILE_DIR,
    extraArgs: [],
    usesSystemChrome: false,
  };
}

async function configureContext(context: BrowserContext) {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });
}

async function singleFreshPage(context: BrowserContext) {
  await new Promise((r) => setTimeout(r, 300));
  for (const stale of [...context.pages()]) {
    await stale.close().catch(() => undefined);
  }
  const page = await context.newPage();
  await page.bringToFront();

  context.on("page", async (p) => {
    await p.waitForLoadState("domcontentloaded", { timeout: 3000 }).catch(() => undefined);
    if (p.url() === "about:blank" && context.pages().length > 2) {
      await p.close().catch(() => undefined);
    }
  });

  return page;
}

async function releasePreviousBrowser(): Promise<void> {
  if (!activeClose) return;
  console.log("[Apply Preview] Closing previous browser session…");
  try {
    await activeClose();
  } catch {
    // ignore
  }
  activeClose = null;
  await new Promise((r) => setTimeout(r, 1000));
}

function registerActive(close: () => Promise<void>) {
  activeClose = close;
}

async function launchPersistent(
  userDataDir: string,
  launchOpts: Parameters<typeof chromium.launchPersistentContext>[1],
  usesSystemChrome: boolean
): Promise<DebugBrowser> {
  const context = await chromium.launchPersistentContext(userDataDir, launchOpts);
  await configureContext(context);
  const page = await singleFreshPage(context);

  if (await isLinkedInLoggedIn(context)) {
    console.log("[Apply Preview] LinkedIn session found — already logged in.");
  } else if (!usesSystemChrome) {
    console.log(
      "[Apply Preview] Not logged into LinkedIn yet — sign in once in the Chrome window; session is saved."
    );
  }

  const close = async () => {
    await saveCookies(context);
    await context.close();
    if (activeClose === close) activeClose = null;
  };
  registerActive(close);

  return {
    context,
    browser: null,
    page,
    profileDir: userDataDir,
    usesSystemChrome,
    close,
  };
}

async function launchEphemeralFallback(
  usesSystemChrome: boolean
): Promise<DebugBrowser> {
  console.log("[Apply Preview] Using ephemeral browser with saved cookies (profile was locked).");

  const launchOpts = {
    headless: false as const,
    args: STEALTH_ARGS,
    ignoreDefaultArgs: ["--enable-automation"],
  };

  let browser: Browser;
  try {
    browser = await chromium.launch({ ...launchOpts, channel: "chrome" });
  } catch {
    browser = await chromium.launch(launchOpts);
  }

  const context = await browser.newContext({
    userAgent: BROWSER_UA,
    viewport: { width: 1400, height: 900 },
    locale: "nl-NL",
  });
  await configureContext(context);
  await restoreCookies(context);
  const page = await context.newPage();

  const close = async () => {
    await saveCookies(context);
    await context.close();
    await browser.close();
    if (activeClose === close) activeClose = null;
  };
  registerActive(close);

  return {
    context,
    browser,
    page,
    profileDir: DEFAULT_PROFILE_DIR,
    usesSystemChrome,
    close,
  };
}

async function launchDebugBrowserInner(): Promise<DebugBrowser> {
  await releasePreviousBrowser();

  const { userDataDir, extraArgs, usesSystemChrome } = resolveChromeProfile();
  clearProfileLocks(userDataDir);

  const launchOpts = {
    headless: false as const,
    viewport: { width: 1400, height: 900 } as const,
    locale: "nl-NL",
    userAgent: BROWSER_UA,
    args: [...STEALTH_ARGS, ...extraArgs],
    ignoreDefaultArgs: ["--enable-automation"],
  };

  const tryLaunch = (channel?: "chrome") =>
    launchPersistent(
      userDataDir,
      { ...launchOpts, ...(channel ? { channel } : {}) },
      usesSystemChrome
    );

  try {
    return await tryLaunch("chrome");
  } catch (e) {
    if (isProfileInUseError(e)) {
      console.warn("[Apply Preview] Chrome profile locked — clearing locks and retrying…");
      clearProfileLocks(userDataDir);
      await new Promise((r) => setTimeout(r, 1200));
      try {
        return await tryLaunch("chrome");
      } catch (e2) {
        if (isProfileInUseError(e2)) {
          return launchEphemeralFallback(usesSystemChrome);
        }
        throw e2;
      }
    }
    console.warn("[Apply Preview] Chrome channel unavailable, using Chromium:", e);
    try {
      return await tryLaunch();
    } catch (e2) {
      if (isProfileInUseError(e2)) {
        clearProfileLocks(userDataDir);
        return launchEphemeralFallback(usesSystemChrome);
      }
      throw e2;
    }
  }
}

/** Visible Chrome with persisted cookies so LinkedIn login survives between applies. */
export async function launchDebugBrowser(): Promise<DebugBrowser> {
  const result = launchChain.then(() => launchDebugBrowserInner());
  launchChain = result.then(() => undefined, () => undefined);
  return result;
}

export async function launchHeadlessBrowser(): Promise<DebugBrowser> {
  const browser = await chromium.launch({
    headless: true,
    args: STEALTH_ARGS,
    ignoreDefaultArgs: ["--enable-automation"],
  });
  const context = await browser.newContext({ userAgent: BROWSER_UA });
  await configureContext(context);
  await restoreCookies(context);
  const page = await context.newPage();
  return {
    context,
    browser,
    page,
    profileDir: DEFAULT_PROFILE_DIR,
    usesSystemChrome: false,
    close: async () => {
      await saveCookies(context);
      await context.close();
      await browser.close();
    },
  };
}
