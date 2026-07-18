import type { Page } from "playwright";
import { decideBrowserActions } from "./analyzer";
import type { BrowserAction } from "./analyzer";
import {
  dismissLinkedInOverlays,
  isLinkedInJobUrl,
  isLinkedInSubmitButton,
  openLinkedInApplicationForm,
} from "./linkedin-apply";
import {
  launchDebugBrowser,
  launchHeadlessBrowser,
} from "@/lib/applications/browser-launch";
import {
  isLinkedInAuthWall,
  toGuestLinkedInJobUrl,
} from "@/lib/job-search/linkedin-urls";
import { waitForLinkedInLogin } from "@/lib/applications/linkedin-session";
import {
  isCoverLetterUploadField,
  resolveApplicationFieldValue,
} from "./field-resolver";
import { buildCandidateContext } from "@/lib/candidate/context";
import { saveBrowserSession } from "@/services/firestore";
import { downloadBuffer } from "@/services/storage";
import { getResumeMimeType } from "@/lib/resume/files";
import { nowIso } from "@/lib/utils/dates";
import type {
  BrowserSession,
  BrowserStep,
  UserProfile,
  ApplicationMaterials,
} from "@/lib/types";

function extractTextSelector(selector: string): string | null {
  const match = selector.match(/\[text=["']([^"']+)["']\]/i);
  return match?.[1] ?? null;
}

async function executeClick(page: Page, selector: string): Promise<void> {
  const textHint = extractTextSelector(selector);
  if (textHint) {
    await page.getByRole("button", { name: new RegExp(textHint, "i") }).first().click({ timeout: 8000 });
    return;
  }
  await page.locator(selector).first().click({ timeout: 8000 });
}

function isCoverLetterUploadHint(value?: string, label?: string, name?: string): boolean {
  const hint = `${value ?? ""} ${label ?? ""} ${name ?? ""}`.toLowerCase();
  return /cover[\s_-]?letter|motivation|sollicitatiebrief/.test(hint);
}

function isResumeUploadHint(value?: string, label?: string, name?: string): boolean {
  const hint = `${value ?? ""} ${label ?? ""} ${name ?? ""}`.toLowerCase();
  return /resume|cv\b|curriculum/.test(hint);
}

const MAX_STEPS = 40;
const PREVIEW_BROWSER_MS = 90 * 1000;

const SUBMIT_BUTTON_PATTERN =
  /\b(submit|apply now|send application|complete application|submit application|apply for this job|verzend|verstuur|indien|sollicitatie verzenden)\b/i;

/** Allow Easy Apply multi-step Next — block only final submit */
const LINKEDIN_NEXT_PATTERN = /^(next|volgende|continue|review|doorgaan)$/i;

const ATS_SELECTORS: Record<string, Record<string, string>> = {
  greenhouse: {
    firstName: "#first_name",
    lastName: "#last_name",
    email: "#email",
    resume: "input[type='file']",
    submit: "#submit_app",
  },
  lever: {
    name: "input[name='name']",
    email: "input[name='email']",
    resume: "input[type='file']",
    submit: "button.template-btn-submit",
  },
};

function detectAts(url: string): string | null {
  if (url.includes("greenhouse.io") || url.includes("boards.greenhouse")) {
    return "greenhouse";
  }
  if (url.includes("lever.co") || url.includes("jobs.lever")) return "lever";
  if (url.includes("ashbyhq.com")) return "ashby";
  return null;
}

function isSubmitButton(text: string, linkedIn = false): boolean {
  if (linkedIn && isLinkedInSubmitButton(text)) return true;
  if (linkedIn && LINKEDIN_NEXT_PATTERN.test(text.trim())) return false;
  return SUBMIT_BUTTON_PATTERN.test(text);
}

async function observePage(page: Page) {
  const url = page.url();
  const title = await page.title();
  const fields = await page.evaluate(() => {
    const roots: Element[] = [document.body];
    const dialog = document.querySelector(
      '[role="dialog"], .jobs-easy-apply-modal, .artdeco-modal'
    );
    if (dialog) roots.unshift(dialog);

    const seen = new Set<Element>();
    const out: {
      selector: string;
      type: string;
      label: string;
      name?: string;
    }[] = [];

    for (const root of roots) {
      root
        .querySelectorAll("input, textarea, select")
        .forEach((el, i) => {
          if (seen.has(el)) return;
          seen.add(el);
          const input = el as HTMLInputElement;
          const id = el.id;
          const name = el.getAttribute("name");
          let label =
            el.getAttribute("aria-label") ||
            el.getAttribute("placeholder") ||
            name ||
            "";
          if (id) {
            const labelEl = document.querySelector(`label[for="${id}"]`);
            if (labelEl?.textContent) label = labelEl.textContent.trim();
          }
          out.push({
            selector: id
              ? `#${id}`
              : name
                ? `[name="${name}"]`
                : `${el.tagName.toLowerCase()}:nth-of-type(${i + 1})`,
            type: input.type || el.tagName.toLowerCase(),
            label: label.trim(),
            name: name || undefined,
          });
        });
    }
    return out;
  });
  const buttons = await page.evaluate(() => {
    const roots: Element[] = [document.body];
    const dialog = document.querySelector('[role="dialog"], .artdeco-modal');
    if (dialog) roots.unshift(dialog);

    const results: { selector: string; text: string }[] = [];
    const seen = new Set<string>();

    for (const root of roots) {
      root
        .querySelectorAll(
          'button, input[type="submit"], a[role="button"], .artdeco-button'
        )
        .forEach((el, i) => {
          const text = (el as HTMLElement).innerText?.trim().slice(0, 80) || "";
          if (!text || seen.has(text)) return;
          seen.add(text);
          results.push({
            selector: el.id
              ? `#${el.id}`
              : `button:nth-of-type(${i + 1})`,
            text,
          });
        });
    }
    return results;
  });
  const textSnippet = await page.evaluate(
    () => document.body?.innerText?.slice(0, 5000) ?? ""
  );
  return { url, title, fields, buttons, textSnippet };
}

export interface BrowserAgentInput {
  applicationId: string;
  applicationUrl: string;
  profile: UserProfile;
  userId: string;
  jobTitle: string;
  company: string;
  jobDescription?: string;
  resumePath?: string;
  materials?: ApplicationMaterials;
  sourcePlatform?: string;
  /** Debug: visible browser, fill form, do not submit */
  debugPreview?: boolean;
  coverLetterPdf?: Buffer;
}

function buildAgentGoal(input: BrowserAgentInput): string {
  const base = `Complete job application for ${input.jobTitle} at ${input.company}.
Upload resume PDF from profile. Fill every field using candidate resume, portfolio, and profile.
Use the pre-generated tailored cover letter for cover letter fields (textarea or file upload).
Answer open-ended questions with job-specific responses grounded in real experience.`;

  if (input.debugPreview) {
    return `${base}

DEBUG PREVIEW MODE:
- Fill ALL fields including cover letter uploads
- Do NOT click Submit, Verzenden, Sollicitatie verzenden, Send, or any final submission button
- On LinkedIn Easy Apply you may click Next/Volgende to reach all fields, but never the final submit
- Return action "done" once every visible field is filled`;
  }

  return base;
}

export async function runBrowserAgent(
  input: BrowserAgentInput
): Promise<BrowserSession> {
  const debugPreview = input.debugPreview ?? false;
  const isLinkedIn =
    input.sourcePlatform === "linkedin" ||
    isLinkedInJobUrl(input.applicationUrl);
  const sessionId = `session_${input.applicationId}_${Date.now()}`;
  const session: BrowserSession = {
    id: sessionId,
    userId: input.profile.userId,
    applicationId: input.applicationId,
    status: "in_progress",
    steps: [],
    startedAt: nowIso(),
  };

  await saveBrowserSession(session);

  if (input.materials?.coverLetter?.trim()) {
    console.log(
      `[Apply${debugPreview ? " Preview" : ""}] Cover letter for ${input.jobTitle} @ ${input.company}:`
    );
    console.log("—".repeat(72));
    console.log(input.materials.coverLetter.trim());
    console.log("—".repeat(72));
  }

  const candidateContext = await buildCandidateContext(input.userId);
  const jobContext = {
    title: input.jobTitle,
    company: input.company,
    description: input.jobDescription,
  };
  const fieldContext = {
    context: candidateContext,
    job: jobContext,
    userId: input.userId,
    materials: input.materials,
  };

  const launched = debugPreview
    ? await launchDebugBrowser()
    : await launchHeadlessBrowser();
  let page = launched.page;
  const browserContext = launched.context;
  const closeBrowser = launched.close;

  const previousActions: string[] = [];
  const ats = detectAts(input.applicationUrl);
  const goal = buildAgentGoal(input);
  let heldPreview = false;

  const holdBrowserForReview = async (reason: string) => {
    heldPreview = true;
    session.status = "preview";
    console.log(`[Apply Preview] ${reason}`);
    console.log(
      `[Apply Preview] Chrome stays open for ${PREVIEW_BROWSER_MS / 60000} minutes — ` +
        `review the form (not submitted).`
    );
    session.steps.push({
      step: session.steps.length + 1,
      action: "preview_hold",
      success: true,
      timestamp: nowIso(),
    });
    await saveBrowserSession(session);
    await new Promise((resolve) => setTimeout(resolve, PREVIEW_BROWSER_MS));
  };

  const finishPreview = async (reason: string) => {
    await holdBrowserForReview(reason);
  };

  try {
    const navigateUrl = isLinkedIn
      ? toGuestLinkedInJobUrl(input.applicationUrl)
      : input.applicationUrl;
    console.log(`[Apply] Navigating to: ${navigateUrl}`);
    await page.goto(navigateUrl, {
      waitUntil: "load",
      timeout: 60000,
    });
    await page.bringToFront();

    if (isLinkedIn && isLinkedInAuthWall(page.url())) {
      const loggedIn = await waitForLinkedInLogin(page, browserContext, PREVIEW_BROWSER_MS);
      if (!loggedIn) {
        const msg = "LinkedIn login timed out — sign in and try Apply again.";
        if (debugPreview) {
          await holdBrowserForReview(msg);
        } else {
          throw new Error(msg);
        }
      } else {
        console.log(`[Apply] Retrying job page after login: ${navigateUrl}`);
        await page.goto(navigateUrl, { waitUntil: "load", timeout: 60000 });
        await page.bringToFront();
      }
    }

    if (isLinkedIn && isLinkedInAuthWall(page.url())) {
      const msg =
        "Still on LinkedIn authwall after login — check the Chrome window and try again.";
      if (debugPreview) {
        await holdBrowserForReview(msg);
      } else {
        throw new Error(msg);
      }
    }

    if (isLinkedIn) {
      console.log("[LinkedIn Apply] Job posting loaded — looking for Solliciteren / Apply…");
      await dismissLinkedInOverlays(page);
      try {
        const { formPage, openedNewTab } = await openLinkedInApplicationForm(page);
        page = formPage;
        await page.bringToFront();
        console.log(`[LinkedIn Apply] Application page: ${page.url()}`);
        session.steps.push({
          step: session.steps.length + 1,
          action: "linkedin_open_apply",
          success: true,
          timestamp: nowIso(),
        });
        console.log(
          `[LinkedIn Apply] Form ready (${openedNewTab ? "new Chrome tab" : "Easy Apply modal"}) — ${page.url()}`
        );
        await page.waitForTimeout(2000);

        if (
          /linkedin\.com\/jobs\/view/i.test(page.url()) &&
          !(await page.locator(".jobs-easy-apply-modal").first().isVisible().catch(() => false))
        ) {
          throw new Error(
            "Still on LinkedIn job page — Solliciteren did not open the application form"
          );
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[LinkedIn Apply] Auto-click failed: ${msg}`);
        session.steps.push({
          step: session.steps.length + 1,
          action: "linkedin_open_apply",
          success: false,
          error: msg,
          timestamp: nowIso(),
        });
        if (debugPreview) {
          console.log(
            "[Apply Preview] Click Solliciteren manually — AI will still try to fill once the form tab is open."
          );
          await page.waitForTimeout(30000);
          const formTab =
            browserContext.pages().find(
              (p) =>
                p !== page &&
                p.url() !== "about:blank" &&
                !/linkedin\.com\/jobs\/view/i.test(p.url())
            ) ?? page;
          page = formTab;
          await page.bringToFront();
        } else {
          throw e;
        }
      }
    }

    if (!heldPreview) {
    if (ats === "greenhouse" && input.profile.resume?.storagePath) {
      const sel = ATS_SELECTORS.greenhouse;
      const [first, ...rest] = input.profile.name.split(" ");
      try {
        await page.fill(sel.firstName, first || input.profile.name);
        await page.fill(sel.lastName, rest.join(" ") || "-");
        await page.fill(sel.email, input.profile.email);
        const resumeBuf = await downloadBuffer(input.profile.resume.storagePath);
        await page.setInputFiles(sel.resume, {
          name: input.profile.resume.fileName,
          mimeType:
            input.profile.resume.contentType ??
            getResumeMimeType(input.profile.resume.fileName),
          buffer: resumeBuf,
        });
        session.steps.push({
          step: 1,
          action: "ats_fast_fill",
          success: true,
          timestamp: nowIso(),
        });
      } catch {
        // fall through to AI loop
      }
    }

    const onLinkedInJobOnly =
      /linkedin\.com\/jobs\/view/i.test(page.url()) &&
      !(await page
        .locator(".jobs-easy-apply-modal")
        .first()
        .isVisible()
        .catch(() => false));

    if (onLinkedInJobOnly) {
      throw new Error(
        "Application form not open — still on LinkedIn job page. Click Solliciteren to open the company application site."
      );
    }

    for (let i = 0; i < MAX_STEPS; i++) {
      if (page.isClosed()) {
        console.warn("[Apply] Browser page closed — stopping agent loop");
        break;
      }

      const observation = await observePage(page);

      let actions: BrowserAction[];
      try {
        actions = await decideBrowserActions(
          observation,
          goal,
          candidateContext,
          previousActions,
          debugPreview,
          isLinkedIn
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : "AI action failed";
        console.warn(`[Apply] Browser AI step failed: ${msg}`);
        session.steps.push({
          step: i + 1,
          action: "ai_error",
          success: false,
          error: msg,
          timestamp: nowIso(),
        });
        if (debugPreview) {
          continue;
        }
        throw e;
      }

      let stopLoop = false;

      for (const action of actions) {
        if (stopLoop || page.isClosed()) break;

        const step: BrowserStep = {
          step: session.steps.length + 1,
          action: action.action,
          selector: action.selector,
          value: action.value,
          success: true,
          timestamp: nowIso(),
        };

        if (action.action === "done") {
          session.steps.push(step);
          if (debugPreview) {
            await finishPreview("All fields filled — stopping before submit.");
          } else {
            session.status = "completed";
          }
          stopLoop = true;
          break;
        }

        if (action.action === "pause") {
          session.steps.push({ ...step, success: false, error: "CAPTCHA detected" });
          session.status = "paused";
          stopLoop = true;
          break;
        }

        try {
          switch (action.action) {
            case "fill": {
              if (action.selector) {
                const field = observation.fields.find(
                  (f) => f.selector === action.selector
                );
                let value = action.value?.trim() ?? "";
                if (!value) {
                  const resolved = await resolveApplicationFieldValue({
                    fieldLabel: field?.label || field?.name || action.selector,
                    fieldType: field?.type || "text",
                    fieldName: field?.name,
                    ...fieldContext,
                  });
                  value = resolved.value;
                }
                if (value) {
                  step.value = value.slice(0, 200);
                  await page.fill(action.selector, value);
                  console.log(`[Apply] Filled ${action.selector}`);
                }
              }
              break;
            }
            case "select": {
              if (action.selector) {
                const field = observation.fields.find(
                  (f) => f.selector === action.selector
                );
                let value = action.value?.trim() ?? "";
                if (!value) {
                  const resolved = await resolveApplicationFieldValue({
                    fieldLabel: field?.label || field?.name || action.selector,
                    fieldType: "select",
                    fieldName: field?.name,
                    ...fieldContext,
                  });
                  value = resolved.value;
                }
                if (value) {
                  step.value = value;
                  try {
                    await page.selectOption(action.selector, { label: value });
                  } catch {
                    await page.selectOption(action.selector, value);
                  }
                  console.log(`[Apply] Selected ${action.selector} = ${value}`);
                }
              }
              break;
            }
            case "click": {
              if (action.selector) {
                const button = observation.buttons.find(
                  (b) => b.selector === action.selector
                );
                if (debugPreview && button && isSubmitButton(button.text, isLinkedIn)) {
                  console.log(
                    `[Apply Preview] Blocked submit button: "${button.text}"`
                  );
                  await finishPreview("Submit button blocked.");
                  stopLoop = true;
                  break;
                }
                await executeClick(page, action.selector);
                console.log(`[Apply] Clicked ${action.selector}`);
              }
              break;
            }
            case "upload": {
              if (action.selector) {
                const field = observation.fields.find(
                  (f) => f.selector === action.selector
                );
                const label = field?.label || field?.name || action.selector;
                const useCover =
                  input.coverLetterPdf &&
                  (isCoverLetterUploadField(label, field?.type || "file", field?.name) ||
                    isCoverLetterUploadHint(action.value, label, field?.name));
                const useResume =
                  input.profile.resume?.storagePath &&
                  (isResumeUploadHint(action.value, label, field?.name) ||
                    (!useCover && input.profile.resume?.storagePath));

                if (useCover) {
                  console.log(`[Apply Preview] Uploading cover letter PDF to: ${label}`);
                  await page.setInputFiles(action.selector, {
                    name: "cover-letter.pdf",
                    mimeType: "application/pdf",
                    buffer: input.coverLetterPdf!,
                  });
                  step.value = "cover-letter.pdf";
                } else if (useResume) {
                  const buf = await downloadBuffer(input.profile.resume!.storagePath);
                  await page.setInputFiles(action.selector, {
                    name: input.profile.resume!.fileName,
                    mimeType:
                      input.profile.resume!.contentType ??
                      getResumeMimeType(input.profile.resume!.fileName),
                    buffer: buf,
                  });
                  step.value = input.profile.resume!.fileName;
                  console.log(`[Apply] Uploaded resume to ${action.selector}`);
                }
              }
              break;
            }
            case "navigate":
              if (action.value) await page.goto(action.value);
              break;
            case "wait":
              await page.waitForTimeout(2000);
              break;
          }

          if (session.status === "preview") {
            stopLoop = true;
            break;
          }

          previousActions.push(
            `${action.action}:${action.selector || action.value || ""}`
          );
          session.steps.push(step);
        } catch (e) {
          step.success = false;
          step.error = e instanceof Error ? e.message : "Action failed";
          session.steps.push(step);
          console.warn(`[Apply] Action failed (${action.action} ${action.selector}):`, e);
        }
      }

      await saveBrowserSession(session);

      if (stopLoop) break;
    }

    if (session.status === "in_progress" && !heldPreview) {
      session.status = debugPreview ? "preview" : "completed";
      if (debugPreview) {
        await finishPreview("Step limit reached — form may be partially filled.");
      }
    }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Browser agent failed";
    if (debugPreview) {
      session.status = "preview";
      session.error = msg;
      if (!heldPreview) {
        await holdBrowserForReview(`Error: ${msg}`);
      }
    } else {
      session.status = "failed";
      session.error = msg;
    }
  } finally {
    session.completedAt = nowIso();
    await saveBrowserSession(session);
    await closeBrowser();
  }

  return session;
}
