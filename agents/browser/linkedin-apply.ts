import type { BrowserContext, Page } from "playwright";
import {
  isLinkedInAuthWall,
  isOffsiteApplicationUrl,
  resolveApplicationDestination,
} from "@/lib/job-search/linkedin-urls";

/** LinkedIn job posting or guest view URL */
export function isLinkedInJobUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host.includes("linkedin.com") && /\/jobs\//.test(url);
  } catch {
    return /linkedin\.com\/jobs\//i.test(url);
  }
}

function isLinkedInJobViewPage(url: string): boolean {
  return /linkedin\.com\/jobs\/view\//i.test(url);
}

/** Final submit on application form — NOT the entry "Solliciteren" on job page */
export function isLinkedInSubmitButton(text: string): boolean {
  const t = text.trim().toLowerCase();
  return (
    /\b(submit|verzend|verstuur|indien|send|done)\b/.test(t) &&
    !/^solliciteren$/.test(t)
  ) || /\b(submit application|verstuur sollicitatie|sollicitatie verzenden|review and submit)\b/i.test(
    text
  );
}

const APPLY_BUTTON_PATTERN =
  /^(solliciteren|easy apply|apply now|apply|continue applying|nu solliciteren)$/i;

/** Job detail panel — guest + logged-in layouts */
const JOB_DETAIL_ROOT =
  ".jobs-details, .jobs-details__main-content, .jobs-unified-top-card, .job-details-jobs-unified-top-card__container, .scaffold-layout__main";

const AUTH_MODAL_TEXT =
  /word lid|meld u aan|sign in|join linkedin|doorgaan met google|aanmelden met e-mail/i;

const APPLY_LINK_SELECTORS = [
  'a[data-tracking-control-name="public_jobs_apply-link-offsite"]',
  'a[data-tracking-control-name="jobdetails_topcard_inapply"]',
  'a[data-tracking-control-name="jobs_apply-link-offsite"]',
  "#jobs-apply-button-id",
  ".jobs-apply-button--top-card",
  "a.jobs-apply-button",
  'a.jobs-apply-button[href]',
  ".jobs-s-apply a.jobs-apply-button",
  ".jobs-s-apply .jobs-apply-button",
];

function isEntryApplyLabel(text: string): boolean {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return false;
  if (APPLY_BUTTON_PATTERN.test(clean)) return true;
  return /\beasy apply\b/i.test(clean) || /^solliciteren\b/i.test(clean);
}

function jobDetailRoot(page: Page) {
  return page.locator(JOB_DETAIL_ROOT).first();
}

async function closeBlankTabs(context: BrowserContext, keep: Page): Promise<void> {
  for (const p of context.pages()) {
    if (p === keep) continue;
    const url = p.url();
    if (!url || url === "about:blank") {
      await p.close().catch(() => undefined);
    }
  }
}

async function isAuthModalVisible(page: Page): Promise<boolean> {
  const modal = page.locator(
    '[role="dialog"], .artdeco-modal, .contextual-sign-in-modal, .jobs-apply-modal'
  );
  if (!(await modal.first().isVisible().catch(() => false))) return false;
  return modal
    .first()
    .getByText(AUTH_MODAL_TEXT)
    .first()
    .isVisible()
    .catch(() => false);
}

/** Dismiss cookie banner and sign-in modal that block Solliciteren on guest pages. */
export async function dismissLinkedInOverlays(page: Page): Promise<void> {
  await page.bringToFront();

  const cookieLabels = [/accepteren/i, /accept all/i, /^accept$/i, /alle cookies/i];
  for (const pattern of cookieLabels) {
    const btn = page.getByRole("button", { name: pattern });
    if (await btn.first().isVisible().catch(() => false)) {
      await btn.first().click({ timeout: 5000 }).catch(() => undefined);
      console.log("[LinkedIn Apply] Dismissed cookie banner");
      await page.waitForTimeout(600);
      break;
    }
  }

  for (let attempt = 0; attempt < 4; attempt++) {
    if (!(await isAuthModalVisible(page))) break;

    console.log("[LinkedIn Apply] Closing sign-in modal…");

    const closeSelectors = [
      "button.artdeco-modal__dismiss",
      '[data-test-modal-close-btn]',
      '[aria-label="Dismiss"]',
      '[aria-label="Sluiten"]',
      '[aria-label="Close"]',
      ".artdeco-modal__dismiss",
      ".contextual-sign-in-modal__close-btn",
    ];

    let closed = false;
    for (const selector of closeSelectors) {
      const close = page.locator(selector).first();
      if (await close.isVisible().catch(() => false)) {
        await close.click({ timeout: 3000 }).catch(() => undefined);
        closed = true;
        break;
      }
    }

    if (!closed) {
      const dialog = page.locator('[role="dialog"], .artdeco-modal').first();
      const headerBtn = dialog.locator("button").first();
      if (await headerBtn.isVisible().catch(() => false)) {
        await headerBtn.click({ timeout: 3000 }).catch(() => undefined);
        closed = true;
      }
    }

    if (!closed) {
      await page.keyboard.press("Escape").catch(() => undefined);
    }

    await page.waitForTimeout(700);
  }
}

async function waitForApplyButton(page: Page): Promise<void> {
  const root = jobDetailRoot(page);
  const scope = (await root.count()) > 0 ? root : page.locator("body");

  const apply = scope.locator(APPLY_LINK_SELECTORS.join(", "));
  await apply
    .first()
    .waitFor({ state: "visible", timeout: 30000 })
    .catch(() => undefined);

  // Logged-in pages sometimes render the button slightly later
  const roleApply = scope.getByRole("link", { name: /^solliciteren$/i });
  await roleApply
    .first()
    .waitFor({ state: "visible", timeout: 10000 })
    .catch(() => undefined);

  await page.waitForTimeout(500);
}

function isRealApplicationPage(url: string): boolean {
  if (!url || url === "about:blank") return false;
  if (isLinkedInAuthWall(url)) return false;
  if (isLinkedInJobViewPage(url)) return false;
  if (url.includes("linkedin.com/checkpoint")) return false;
  if (url.includes("linkedin.com/login")) return false;
  if (url.includes("linkedin.com")) return false;
  return true;
}

async function resolveExternalApplyUrl(
  page: Page,
  scope: ReturnType<Page["locator"]>
): Promise<string | null> {
  for (const selector of APPLY_LINK_SELECTORS) {
    const link = scope.locator(selector).first();
    if ((await link.count()) === 0) continue;

    const href =
      (await link.getAttribute("href").catch(() => null)) ??
      (await link.evaluate((el) => (el as HTMLAnchorElement).href).catch(() => null));

    if (!href || href === "#" || href.startsWith("javascript:")) continue;

    try {
      const absolute = new URL(href, page.url()).href;
      const destination = resolveApplicationDestination(absolute);
      console.log(`[LinkedIn Apply] Apply href: ${absolute}`);
      if (isOffsiteApplicationUrl(destination)) {
        console.log(`[LinkedIn Apply] Offsite destination: ${destination}`);
        return destination;
      }
    } catch {
      continue;
    }
  }

  const fromDom = await scope.evaluate((root) => {
    const selectors = [
      'a[data-tracking-control-name="public_jobs_apply-link-offsite"]',
      'a[data-tracking-control-name="jobdetails_topcard_inapply"]',
      'a[data-tracking-control-name="jobs_apply-link-offsite"]',
      "#jobs-apply-button-id",
      "a.jobs-apply-button",
      ".jobs-apply-button--top-card",
    ];
    for (const sel of selectors) {
      const el = root.querySelector<HTMLAnchorElement>(sel);
      if (el?.href) return el.href;
    }
    const links = [...root.querySelectorAll<HTMLAnchorElement>("a")];
    const apply = links.find((a) => /^solliciteren$/i.test(a.innerText.trim()));
    return apply?.href ?? null;
  });

  if (fromDom) {
    const destination = resolveApplicationDestination(fromDom);
    if (isOffsiteApplicationUrl(destination)) {
      console.log(`[LinkedIn Apply] Offsite destination (DOM): ${destination}`);
      return destination;
    }
  }

  return null;
}

async function openUrlInNewTab(
  context: BrowserContext,
  jobPage: Page,
  url: string
): Promise<{ formPage: Page; openedNewTab: boolean }> {
  await closeBlankTabs(context, jobPage);

  const formPage = await context.newPage();
  await formPage.bringToFront();
  console.log(`[LinkedIn Apply] Opening application directly: ${url}`);
  await formPage.goto(url, { waitUntil: "load", timeout: 60000 });
  await closeBlankTabs(context, formPage);
  return { formPage, openedNewTab: true };
}

async function waitForApplicationSurface(
  context: BrowserContext,
  jobPage: Page
): Promise<{ formPage: Page; openedNewTab: boolean } | null> {
  const deadline = Date.now() + 20000;

  while (Date.now() < deadline) {
    if (await isAuthModalVisible(jobPage)) {
      console.log("[LinkedIn Apply] Sign-in modal appeared after click — closing");
      await dismissLinkedInOverlays(jobPage);
      return null;
    }

    for (const p of context.pages()) {
      const url = p.url();
      if (url !== "about:blank" && p !== jobPage && isRealApplicationPage(url)) {
        await p.waitForLoadState("domcontentloaded", { timeout: 45000 }).catch(() => undefined);
        await p.bringToFront();
        await closeBlankTabs(context, p);
        console.log(`[LinkedIn Apply] Form opened in new tab: ${url}`);
        return { formPage: p, openedNewTab: true };
      }
    }

    const easyApply = jobPage.locator(".jobs-easy-apply-modal, [data-test-modal='easy-apply-modal']");
    const easyVisible = await easyApply.first().isVisible().catch(() => false);
    if (easyVisible && !(await isAuthModalVisible(jobPage))) {
      const modalFields = await easyApply.locator("input, textarea, select").count();
      if (modalFields >= 1) {
        console.log("[LinkedIn Apply] Easy Apply modal opened");
        return { formPage: jobPage, openedNewTab: false };
      }
    }

    const jobUrl = jobPage.url();
    if (!isLinkedInJobViewPage(jobUrl) && isRealApplicationPage(jobUrl)) {
      console.log(`[LinkedIn Apply] Navigated to application: ${jobUrl}`);
      return { formPage: jobPage, openedNewTab: false };
    }

    await jobPage.waitForTimeout(400);
  }

  return null;
}

async function clickApplyElement(
  page: Page,
  el: ReturnType<Page["locator"]>,
  label: string
): Promise<{ formPage: Page; openedNewTab: boolean } | null> {
  const text = (await el.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
  console.log(`[LinkedIn Apply] Clicking: "${label}"${text ? ` (${text})` : ""}`);

  const context = page.context();
  const pagesBefore = new Set(context.pages());

  const popupPromise = context.waitForEvent("page", { timeout: 20000 }).catch(() => null);

  try {
    await el.click({ timeout: 12000 });
  } catch {
    await el.click({ timeout: 12000, force: true }).catch(() => undefined);
  }

  const popup = await popupPromise;
  if (popup) {
    await popup.waitForLoadState("domcontentloaded", { timeout: 45000 }).catch(() => undefined);
    const popupUrl = popup.url();
    if (popupUrl === "about:blank") {
      await popup.waitForLoadState("load", { timeout: 15000 }).catch(() => undefined);
    }
    if (isRealApplicationPage(popup.url())) {
      await popup.bringToFront();
      console.log(`[LinkedIn Apply] Popup tab: ${popup.url()}`);
      return { formPage: popup, openedNewTab: true };
    }
  }

  const result = await waitForApplicationSurface(context, page);
  if (result) return result;

  const newPages = context.pages().filter((p) => !pagesBefore.has(p));
  for (const p of newPages) {
    const url = p.url();
    if (url === "about:blank") {
      await p.waitForTimeout(1500);
      if (p.url() === "about:blank") {
        await p.close().catch(() => undefined);
        continue;
      }
    }
    if (isRealApplicationPage(p.url())) {
      await p.waitForLoadState("domcontentloaded", { timeout: 45000 }).catch(() => undefined);
      await p.bringToFront();
      console.log(`[LinkedIn Apply] New tab after click: ${p.url()}`);
      return { formPage: p, openedNewTab: true };
    }
  }

  return null;
}

async function tryClickLocator(
  page: Page,
  locator: ReturnType<Page["locator"]>,
  label: string
): Promise<{ formPage: Page; openedNewTab: boolean } | null> {
  const count = await locator.count();
  console.log(`[LinkedIn Apply] Trying "${label}" (${count} match${count === 1 ? "" : "es"})`);

  for (let i = 0; i < count; i++) {
    const el = locator.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;

    const box = await el.boundingBox().catch(() => null);
    if (!box || box.width < 8 || box.height < 8) continue;

    const text = (await el.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    if (text && !isEntryApplyLabel(text) && !/solliciteren/i.test(text)) {
      continue;
    }

    await dismissLinkedInOverlays(page);
    await el.scrollIntoViewIfNeeded().catch(() => undefined);
    await page.waitForTimeout(300);

    const result = await clickApplyElement(page, el, label);
    if (result) return result;

    if (await isAuthModalVisible(page)) {
      await dismissLinkedInOverlays(page);
    }
  }

  return null;
}

function assertLeftJobPosting(
  result: { formPage: Page; openedNewTab: boolean },
  jobPage: Page
): Promise<void> {
  return (async () => {
    const url = result.formPage.url();
    if (isLinkedInJobViewPage(url)) {
      throw new Error(
        `Still on LinkedIn job page after apply (${url}) — Solliciteren did not open the application form`
      );
    }
    if (result.formPage === jobPage && !result.openedNewTab) {
      const easyApply = result.formPage.locator(".jobs-easy-apply-modal");
      const easyOpen = await easyApply.first().isVisible().catch(() => false);
      if (!easyOpen) {
        throw new Error("Apply click did not open Easy Apply modal or external form");
      }
    }
  })();
}

/**
 * On a LinkedIn job posting, click Solliciteren / Easy Apply / Apply
 * and return the page that contains the application form (same tab or new tab).
 */
export async function openLinkedInApplicationForm(
  page: Page
): Promise<{ formPage: Page; openedNewTab: boolean }> {
  console.log("[LinkedIn Apply] Preparing job posting…");
  await page.bringToFront();
  await closeBlankTabs(page.context(), page);
  await dismissLinkedInOverlays(page);
  await waitForApplyButton(page);

  let scope = jobDetailRoot(page);
  if ((await scope.count()) === 0) {
    console.warn("[LinkedIn Apply] Job detail root not found — using full page scope");
    scope = page.locator("body");
  }

  const externalUrl = await resolveExternalApplyUrl(page, scope);
  if (externalUrl && isOffsiteApplicationUrl(externalUrl)) {
    try {
      const result = await openUrlInNewTab(page.context(), page, externalUrl);
      await assertLeftJobPosting(result, page);
      return result;
    } catch (e) {
      console.warn("[LinkedIn Apply] Direct URL open failed, falling back to click:", e);
    }
  }

  const targetedSelectors = [
    { locator: scope.locator("#jobs-apply-button-id"), label: "Solliciteren (id)" },
    { locator: scope.locator(".jobs-apply-button--top-card"), label: "Solliciteren (class)" },
    {
      locator: scope.locator('a[data-tracking-control-name="jobdetails_topcard_inapply"]'),
      label: "Solliciteren (logged-in)",
    },
    {
      locator: scope.locator('a[data-tracking-control-name="jobs_apply-link-offsite"]'),
      label: "Solliciteren (offsite)",
    },
    {
      locator: scope.locator('a[data-tracking-control-name="public_jobs_apply-link-offsite"]'),
      label: "Solliciteren (guest offsite)",
    },
    {
      locator: scope.locator(".jobs-s-apply .jobs-apply-button, .jobs-s-apply a"),
      label: "Solliciteren (sidebar)",
    },
    {
      locator: scope.locator("a.jobs-apply-button, button.jobs-apply-button, .jobs-apply-button"),
      label: "Solliciteren (jobs-apply-button)",
    },
    {
      locator: scope.getByRole("link", { name: /^solliciteren$/i }),
      label: "Solliciteren link",
    },
    {
      locator: scope.getByRole("button", { name: /^solliciteren$/i }),
      label: "Solliciteren button",
    },
    {
      locator: scope.getByRole("button", { name: /easy apply/i }),
      label: "Easy Apply",
    },
    {
      locator: scope.getByRole("link", { name: /easy apply/i }),
      label: "Easy Apply link",
    },
  ];

  for (const { locator, label } of targetedSelectors) {
    const result = await tryClickLocator(page, locator, label);
    if (result) {
      await assertLeftJobPosting(result, page);
      return result;
    }
    await dismissLinkedInOverlays(page);
  }

  // Last resort: first visible Solliciteren anywhere in job details
  const fallback = scope.getByRole("link", { name: /solliciteren/i }).first();
  if (await fallback.isVisible().catch(() => false)) {
    const result = await clickApplyElement(page, fallback, "Solliciteren (fallback link)");
    if (result) {
      await assertLeftJobPosting(result, page);
      return result;
    }
  }

  const fallbackBtn = scope.getByRole("button", { name: /solliciteren/i }).first();
  if (await fallbackBtn.isVisible().catch(() => false)) {
    const result = await clickApplyElement(page, fallbackBtn, "Solliciteren (fallback button)");
    if (result) {
      await assertLeftJobPosting(result, page);
      return result;
    }
  }

  if (externalUrl && isOffsiteApplicationUrl(externalUrl)) {
    const result = await openUrlInNewTab(page.context(), page, externalUrl);
    await assertLeftJobPosting(result, page);
    return result;
  }

  throw new Error(
    "Could not click Solliciteren — click it manually in the Chrome window, then the AI will try to fill the form."
  );
}
