/** Coerce Gemini's inconsistent JSON shapes into predictable values before Zod validation. */

export function coerceStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "name" in item) {
          return String((item as { name: unknown }).name);
        }
        return String(item);
      })
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (value && typeof value === "object") {
    return Object.values(value)
      .map(String)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return value.split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

export function coerceNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function coerceExperienceLevel(
  value: unknown
): "junior" | "mid" | "senior" | "staff" | "principal" {
  const levels = ["junior", "mid", "senior", "staff", "principal"] as const;
  const s = String(value ?? "")
    .toLowerCase()
    .trim();
  const match = levels.find((l) => s === l || s.includes(l));
  return match ?? "mid";
}

export function coerceSource(value: unknown): "resume" | "portfolio" | "linkedin" {
  const s = String(value ?? "").toLowerCase();
  if (s.includes("linkedin")) return "linkedin";
  return s.includes("portfolio") ? "portfolio" : "resume";
}

export function normalizeResumeExtraction(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const o = raw as Record<string, unknown>;

  return {
    ...o,
    phoneNumber: o.phoneNumber ? String(o.phoneNumber) : undefined,
    skills: coerceStringArray(o.skills),
    technologies: coerceStringArray(o.technologies),
    experience: Array.isArray(o.experience)
      ? o.experience.map((e) => {
          const exp = (e ?? {}) as Record<string, unknown>;
          return {
            title: String(exp.title ?? ""),
            company: String(exp.company ?? ""),
            startDate: exp.startDate ? String(exp.startDate) : undefined,
            endDate: exp.endDate ? String(exp.endDate) : undefined,
            description: String(exp.description ?? ""),
            technologies: coerceStringArray(exp.technologies),
          };
        })
      : [],
    projects: Array.isArray(o.projects)
      ? o.projects.map((p) => {
          const proj = (p ?? {}) as Record<string, unknown>;
          return {
            name: String(proj.name ?? ""),
            description: String(proj.description ?? ""),
            technologies: coerceStringArray(proj.technologies),
          };
        })
      : [],
    education: Array.isArray(o.education) ? o.education : [],
    certifications: Array.isArray(o.certifications) ? o.certifications : [],
  };
}

export function coerceRemoteType(
  value: unknown
): "remote" | "hybrid" | "onsite" | "any" | undefined {
  const s = String(value ?? "").toLowerCase();
  if (s.includes("remote") || s === "true") return "remote";
  if (s.includes("hybrid")) return "hybrid";
  if (s.includes("onsite") || s.includes("on-site") || s.includes("office")) return "onsite";
  if (s.includes("any")) return "any";
  return undefined;
}

function requirementItems(skills: string[]) {
  return skills.map((skill) => ({ skill, description: undefined }));
}

export function normalizeJobPosting(raw: unknown, sourceUrl?: string): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const o = raw as Record<string, unknown>;

  const title = String(o.title ?? o.job_title ?? o.role ?? o.position ?? "").trim();
  const company = String(
    o.company ?? o.company_name ?? o.employer ?? o.organization ?? ""
  ).trim();

  let location = o.location;
  if (location && typeof location === "object") {
    const loc = location as Record<string, unknown>;
    location =
      [loc.city, loc.country, loc.type, loc.region]
        .filter(Boolean)
        .map(String)
        .join(", ") || "Remote";
  } else if (typeof location !== "string" || !location.trim()) {
    location = o.candidate_required_location ?? o.work_location ?? "Remote";
  }

  const description = String(
    o.description ??
      o.job_description_summary ??
      o.job_description ??
      o.summary ??
      (Array.isArray(o.responsibilities)
        ? o.responsibilities
            .flatMap((r) => {
              if (typeof r === "string") return r;
              if (r && typeof r === "object") {
                const item = r as Record<string, unknown>;
                const tasks = Array.isArray(item.tasks)
                  ? item.tasks.map(String)
                  : [];
                return [String(item.category ?? ""), ...tasks].filter(Boolean);
              }
              return [];
            })
            .join("\n")
        : "")
  ).trim();

  const reqs = o.requirements;
  let requiredSkills: string[] = [];
  let preferredSkills: string[] = [];

  if (reqs && typeof reqs === "object" && !Array.isArray(reqs)) {
    const r = reqs as Record<string, unknown>;
    requiredSkills = coerceStringArray(
      r.required ?? r.hard_requirements ?? r.must_have ?? r.qualifications
    );
    preferredSkills = coerceStringArray(
      r.preferred ?? r.preferred_skills ?? r.nice_to_have ?? r.bonus
    );
  } else {
    requiredSkills = coerceStringArray(
      o.hard_requirements ?? o.required_skills ?? o.must_have ?? o.qualifications
    );
    preferredSkills = coerceStringArray(
      o.preferred_skills ?? o.nice_to_have ?? o.bonus_skills
    );
  }

  const extractedSkills = [
    ...new Set([
      ...coerceStringArray(o.extractedSkills ?? o.skills ?? o.tags ?? o.technologies),
      ...requiredSkills,
      ...preferredSkills,
    ]),
  ];

  const applicationUrl = String(
    o.applicationUrl ?? o.application_url ?? o.source_url ?? o.url ?? sourceUrl ?? ""
  ).trim();

  let remoteType: unknown = o.remoteType ?? o.remote_type ?? o.work_type;
  if (!remoteType && o.is_remote === true) remoteType = "remote";
  if (!remoteType && typeof location === "string" && location.toLowerCase().includes("remote")) {
    remoteType = "remote";
  }

  return {
    title,
    company,
    location: String(location ?? "Remote"),
    remoteType: coerceRemoteType(remoteType),
    description,
    requirements: {
      required: requirementItems(requiredSkills),
      preferred: requirementItems(preferredSkills),
    },
    extractedSkills,
    applicationUrl,
  };
}

function normalizeListingItem(item: unknown) {
  const o = (item ?? {}) as Record<string, unknown>;
  return {
    title: String(o.title ?? o.job_title ?? o.role ?? o.position ?? "").trim(),
    company: o.company
      ? String(o.company ?? o.company_name ?? o.employer).trim()
      : undefined,
    url: String(
      o.url ?? o.link ?? o.href ?? o.application_url ?? o.job_url ?? ""
    ).trim(),
    location: o.location
      ? String(o.location ?? o.job_location).trim()
      : undefined,
    tags: coerceStringArray(o.tags ?? o.skills),
  };
}

export function normalizeJobListings(raw: unknown): unknown {
  if (Array.isArray(raw)) {
    return {
      jobs: raw.map(normalizeListingItem).filter((j) => j.title && j.url),
    };
  }
  if (!raw || typeof raw !== "object") return { jobs: [] };
  const o = raw as Record<string, unknown>;
  const items = o.jobs ?? o.listings ?? o.results ?? o.data ?? o.items ?? [];
  if (!Array.isArray(items)) return { jobs: [] };
  return {
    jobs: items.map(normalizeListingItem).filter((j) => j.title && j.url),
  };
}

function coerceMissingSkills(
  value: unknown,
  fallbackStrings: string[] = []
): { skill: string; isHardRequirement: boolean }[] {
  if (Array.isArray(value)) {
    const parsed = value
      .map((item) => {
        if (typeof item === "string") {
          return { skill: item.trim(), isHardRequirement: false };
        }
        const o = (item ?? {}) as Record<string, unknown>;
        const skill = String(o.skill ?? o.name ?? o.requirement ?? "").trim();
        if (!skill) return null;
        return {
          skill,
          isHardRequirement: Boolean(
            o.isHardRequirement ?? o.required ?? o.is_required ?? o.hard
          ),
        };
      })
      .filter((x): x is { skill: string; isHardRequirement: boolean } => !!x);
    if (parsed.length > 0) return parsed;
  }

  const strings = coerceStringArray(value);
  const combined = [...strings, ...fallbackStrings].filter(Boolean);
  return [...new Set(combined)].map((skill) => ({
    skill,
    isHardRequirement: false,
  }));
}

export function normalizeJobMatch(raw: unknown): unknown {
  const unwrapped = Array.isArray(raw) ? raw[0] : raw;
  if (!unwrapped || typeof unwrapped !== "object") return raw;
  const o = unwrapped as Record<string, unknown>;

  const details =
    o.matchDetails && typeof o.matchDetails === "object"
      ? (o.matchDetails as Record<string, unknown>)
      : null;

  const fitScore = Math.min(
    100,
    Math.max(
      0,
      coerceNumber(
        o.fitScore ??
          o.fit_score ??
          o.match_score ??
          o.matchScore ??
          o.score,
        0
      )
    )
  );

  const strengths = coerceStringArray(
    o.strengths ?? details?.strengths ?? o.match_strengths
  );

  const weaknesses = coerceStringArray(
    o.weaknesses ?? details?.weaknesses ?? o.gaps ?? o.missing_requirements
  );

  const missingSkills = coerceMissingSkills(
    o.missingSkills ?? o.missing_skills ?? details?.missingSkills,
    weaknesses
  );

  const reasoning = String(
    o.reasoning ??
      o.matchReason ??
      o.match_reason ??
      o.explanation ??
      o.summary ??
      o.feedback ??
      o.reason ??
      (typeof details?.seniorityAlignment === "string"
        ? details.seniorityAlignment
        : "")
  ).trim();

  let applyRecommendation = o.applyRecommendation ?? o.apply_recommendation;
  if (typeof applyRecommendation !== "boolean") {
    applyRecommendation = fitScore >= 85;
  }

  const preferenceAlignment = String(
    o.preferenceAlignment ??
      o.preference_alignment ??
      details?.preferenceAlignment ??
      ""
  ).trim();

  let preferencesMatch = o.preferencesMatch ?? o.preferences_match;
  if (typeof preferencesMatch === "string") {
    const s = preferencesMatch.toLowerCase().trim();
    preferencesMatch = s === "true" || s === "yes" || s === "match";
  }
  if (typeof preferencesMatch !== "boolean") {
    // Only infer false from explicit conflict language — never invent a true match.
    if (
      preferenceAlignment &&
      /conflict|mismatch|does not match|doesn't match|not align|does not satisfy|fails preference/i.test(
        preferenceAlignment
      )
    ) {
      preferencesMatch = false;
    } else {
      preferencesMatch = undefined;
    }
  }

  let fitScoreOut = fitScore;
  if (preferencesMatch === false) {
    fitScoreOut = Math.min(fitScoreOut, 40);
    applyRecommendation = false;
  }

  return {
    fitScore: fitScoreOut,
    strengths,
    missingSkills,
    applyRecommendation: Boolean(applyRecommendation),
    reasoning: reasoning || `Overall fit score: ${fitScoreOut}/100`,
    preferenceAlignment:
      preferenceAlignment || "Preference alignment not provided.",
    preferencesMatch:
      typeof preferencesMatch === "boolean" ? preferencesMatch : false,
    ...(o.employerType || o.employer_type
      ? { employerType: String(o.employerType ?? o.employer_type) }
      : {}),
  };
}

export function normalizeApplicationMaterials(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const o = raw as Record<string, unknown>;

  let customAnswers = o.customAnswers ?? o.custom_answers;
  if (
    customAnswers &&
    typeof customAnswers === "object" &&
    !Array.isArray(customAnswers)
  ) {
    customAnswers = Object.entries(customAnswers as Record<string, unknown>).map(
      ([question, answer]) => ({
        question: question.replace(/^\d+\.\s*/, "").trim(),
        answer: String(answer ?? "").trim(),
      })
    );
  } else if (Array.isArray(customAnswers)) {
    customAnswers = customAnswers.map((item) => {
      const row = (item ?? {}) as Record<string, unknown>;
      return {
        question: String(row.question ?? row.q ?? "").trim(),
        answer: String(row.answer ?? row.a ?? "").trim(),
      };
    });
  }

  return {
    coverLetter: String(o.coverLetter ?? o.cover_letter ?? "").trim(),
    resumeSummary: String(
      o.resumeSummary ?? o.resume_summary ?? o.summary ?? ""
    ).trim(),
    customAnswers: customAnswers ?? [],
  };
}

export function normalizeCandidateSynthesis(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const o = raw as Record<string, unknown>;

  const inferredRoles = o.inferredRoles ?? o.inferred_roles ?? o.roles;
  const experienceLevel =
    o.experienceLevel ?? o.experience_level ?? o.level ?? o.seniority;

  return {
    skills: coerceStringArray(o.skills),
    technologies: coerceStringArray(o.technologies ?? o.tech ?? o.tools),
    strengths: coerceStringArray(o.strengths),
    gaps: coerceStringArray(o.gaps),
    experienceLevel: coerceExperienceLevel(experienceLevel),
    inferredRoles: Array.isArray(inferredRoles)
      ? inferredRoles
          .map((r) => {
            const role = (r ?? {}) as Record<string, unknown>;
            return {
              role: String(role.role ?? role.title ?? role.name ?? "").trim(),
              confidence: Math.min(
                100,
                Math.max(0, coerceNumber(role.confidence ?? role.score, 70))
              ),
            };
          })
          .filter((r) => r.role)
      : [],
    projects: Array.isArray(o.projects)
      ? o.projects.map((p) => {
          const proj = (p ?? {}) as Record<string, unknown>;
          return {
            name: String(proj.name ?? proj.title ?? "Untitled project"),
            description: String(proj.description ?? proj.summary ?? ""),
            technologies: coerceStringArray(
              proj.technologies ?? proj.tech ?? proj.tools
            ),
            links: coerceStringArray(proj.links ?? proj.url ?? proj.urls),
            source: coerceSource(proj.source ?? proj.origin),
          };
        })
      : [],
  };
}

/** Gemini often returns a bare array, or snake_case / id/score field names. */
export function normalizeRelevanceBatch(raw: unknown): unknown {
  const rows = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? ((raw as Record<string, unknown>).results ??
        (raw as Record<string, unknown>).listings ??
        (raw as Record<string, unknown>).items ??
        (raw as Record<string, unknown>).jobs ??
        [])
      : [];

  if (!Array.isArray(rows)) {
    return { results: [] };
  }

  return {
    results: rows.map((row, i) => {
      const r = (row ?? {}) as Record<string, unknown>;
      const score = coerceNumber(
        r.relevanceScore ??
          r.relevance_score ??
          r.match_score ??
          r.matchScore ??
          r.score ??
          r.fitScore ??
          r.fit_score,
        0
      );
      let relevant = r.relevant ?? r.relevance ?? r.is_relevant ?? r.isRelevant;
      if (typeof relevant === "string") {
        const s = relevant.toLowerCase().trim();
        relevant = s === "true" || s === "yes" || s === "relevant";
      }
      if (typeof relevant !== "boolean") {
        relevant = score >= 55;
      }
      return {
        index: coerceNumber(
          r.index ?? r.id ?? r.job_id ?? r.jobId ?? r.listing_id ?? r.listingId,
          i
        ),
        relevant: Boolean(relevant),
        relevanceScore: Math.min(100, Math.max(0, score)),
      };
    }),
  };
}

/** Gemini often omits reason or uses snake_case for listing validation. */
export function normalizeListingValidation(raw: unknown): unknown {
  const o = Array.isArray(raw)
    ? ((raw[0] ?? {}) as Record<string, unknown>)
    : raw && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : {};
  let isJobPosting = o.isJobPosting ?? o.is_job_posting ?? o.valid ?? o.isValid;
  if (typeof isJobPosting === "string") {
    const s = isJobPosting.toLowerCase().trim();
    isJobPosting = s === "true" || s === "yes";
  }
  if (typeof isJobPosting !== "boolean") {
    isJobPosting = true;
  }
  const reason = String(
    o.reason ?? o.explanation ?? o.feedback ?? o.message ?? ""
  ).trim();
  return {
    isJobPosting: Boolean(isJobPosting),
    reason:
      reason ||
      (isJobPosting ? "Looks like a job posting" : "Does not look like a job posting"),
  };
}

/** Gemini often returns experience_level / search_queries instead of camelCase. */
export function normalizeTailoredSearchPlan(raw: unknown): unknown {
  const o = Array.isArray(raw)
    ? ((raw[0] ?? {}) as Record<string, unknown>)
    : raw && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : {};
  const queries =
    o.searchQueries ?? o.search_queries ?? o.queries ?? o.query;
  const rationale = String(
    o.rationale ?? o.reason ?? o.explanation ?? o.search_rationale ?? ""
  ).trim();
  return {
    inferredExperienceLevel: coerceExperienceLevel(
      o.inferredExperienceLevel ??
        o.inferred_experience_level ??
        o.experienceLevel ??
        o.experience_level
    ),
    searchQueries: coerceStringArray(queries),
    rationale: rationale || "AI-tailored search plan",
  };
}
