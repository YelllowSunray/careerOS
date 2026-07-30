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
    education: Array.isArray(o.education)
      ? o.education.map((e) => {
          const edu = (e ?? {}) as Record<string, unknown>;
          const graduationYear =
            edu.graduationYear ?? edu.year ?? edu.dates ?? edu.date;
          return {
            institution: String(edu.institution ?? edu.school ?? ""),
            degree: String(edu.degree ?? edu.program ?? edu.name ?? ""),
            field: edu.field ? String(edu.field) : undefined,
            graduationYear: graduationYear
              ? String(graduationYear)
              : undefined,
          };
        })
      : [],
    certifications: Array.isArray(o.certifications)
      ? o.certifications
          .map((c) => {
            if (typeof c === "string") {
              const name = c.trim();
              return name ? { name } : null;
            }
            if (!c || typeof c !== "object") return null;
            const cert = c as Record<string, unknown>;
            const name = String(cert.name ?? cert.title ?? cert.certification ?? "").trim();
            if (!name) return null;
            return {
              name,
              issuer: cert.issuer
                ? String(cert.issuer)
                : cert.organization
                  ? String(cert.organization)
                  : undefined,
              year: cert.year
                ? String(cert.year)
                : cert.date
                  ? String(cert.date)
                  : undefined,
            };
          })
          .filter((c): c is { name: string; issuer?: string; year?: string } =>
            Boolean(c)
          )
      : [],
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
): {
  skill: string;
  learnability: "must_have" | "learn_on_job" | "nice_to_have";
  isHardRequirement: boolean;
}[] {
  const normalizeLearnability = (
    raw: unknown,
    hardFallback?: boolean
  ): "must_have" | "learn_on_job" | "nice_to_have" => {
    const s = String(raw ?? "")
      .toLowerCase()
      .trim()
      .replace(/[-\s]+/g, "_");
    if (
      s === "must_have" ||
      s === "musthave" ||
      s === "hard" ||
      s === "required" ||
      s === "non_negotiable"
    ) {
      return "must_have";
    }
    if (
      s === "learn_on_job" ||
      s === "learn_on_the_job" ||
      s === "learnable" ||
      s === "ramp" ||
      s === "trainable"
    ) {
      return "learn_on_job";
    }
    if (
      s === "nice_to_have" ||
      s === "nicetohave" ||
      s === "soft" ||
      s === "preferred" ||
      s === "optional"
    ) {
      return "nice_to_have";
    }
    if (hardFallback === true) return "must_have";
    if (hardFallback === false) return "nice_to_have";
    return "nice_to_have";
  };

  if (Array.isArray(value)) {
    const parsed = value
      .map((item) => {
        if (typeof item === "string") {
          return {
            skill: item.trim(),
            learnability: "nice_to_have" as const,
            isHardRequirement: false,
          };
        }
        const o = (item ?? {}) as Record<string, unknown>;
        const skill = String(o.skill ?? o.name ?? o.requirement ?? "").trim();
        if (!skill) return null;
        const hardFlag = o.isHardRequirement ?? o.required ?? o.is_required ?? o.hard;
        const learnability = normalizeLearnability(
          o.learnability ?? o.gapType ?? o.gap_type ?? o.category,
          typeof hardFlag === "boolean" ? hardFlag : undefined
        );
        return {
          skill,
          learnability,
          isHardRequirement: learnability === "must_have",
        };
      })
      .filter(
        (
          x
        ): x is {
          skill: string;
          learnability: "must_have" | "learn_on_job" | "nice_to_have";
          isHardRequirement: boolean;
        } => !!x
      );
    if (parsed.length > 0) return parsed;
  }

  const strings = coerceStringArray(value);
  const combined = [...strings, ...fallbackStrings].filter(Boolean);
  return [...new Set(combined)].map((skill) => ({
    skill,
    learnability: "nice_to_have" as const,
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
  // Preferences are soft — do not crush scores on sector mismatch.

  const scoreOrUndef = (raw: unknown): number | undefined => {
    if (raw === undefined || raw === null || raw === "") return undefined;
    return Math.min(100, Math.max(0, coerceNumber(raw, 0)));
  };

  const contributionScore = scoreOrUndef(
    o.contributionScore ?? o.contribution_score ?? details?.contributionScore
  );
  const learningScore = scoreOrUndef(
    o.learningScore ??
      o.learning_score ??
      o.growthPotential ??
      o.growth_potential ??
      details?.learningScore
  );
  const moneyScore = scoreOrUndef(
    o.moneyScore ?? o.money_score ?? o.compensationScore ?? details?.moneyScore
  );

  const contributionNotes = String(
    o.contributionNotes ?? o.contribution_notes ?? ""
  ).trim();
  const learningNotes = String(
    o.learningNotes ?? o.learning_notes ?? o.growthNotes ?? o.growth_notes ?? ""
  ).trim();
  const moneyNotes = String(o.moneyNotes ?? o.money_notes ?? "").trim();

  const requiredLanguages = coerceStringArray(
    o.requiredLanguages ?? o.required_languages ?? details?.requiredLanguages
  );

  let languageRequirementMet =
    o.languageRequirementMet ?? o.language_requirement_met;
  if (typeof languageRequirementMet === "string") {
    const s = languageRequirementMet.toLowerCase().trim();
    languageRequirementMet = s === "true" || s === "yes" || s === "met";
  }
  if (typeof languageRequirementMet !== "boolean") {
    // Default open unless model listed hard requirements without a clear fail.
    languageRequirementMet = true;
  }

  const languageNotes = String(
    o.languageNotes ?? o.language_notes ?? ""
  ).trim();

  let skillRequirementMet =
    o.skillRequirementMet ?? o.skill_requirement_met ?? o.skillsMet;
  if (typeof skillRequirementMet === "string") {
    const s = skillRequirementMet.toLowerCase().trim();
    skillRequirementMet = s === "true" || s === "yes" || s === "met";
  }

  const coreCraftRaw = String(
    o.coreCraftFit ?? o.core_craft_fit ?? o.craftFit ?? o.craft_fit ?? ""
  )
    .toLowerCase()
    .trim()
    .replace(/[-\s]+/g, "_");
  let coreCraftFit: "day_one" | "with_ramp" | "not_eligible" | undefined;
  if (
    coreCraftRaw === "day_one" ||
    coreCraftRaw === "dayone" ||
    coreCraftRaw === "ready"
  ) {
    coreCraftFit = "day_one";
  } else if (
    coreCraftRaw === "with_ramp" ||
    coreCraftRaw === "withramp" ||
    coreCraftRaw === "ramp" ||
    coreCraftRaw === "learn_on_job" ||
    coreCraftRaw === "trainable"
  ) {
    coreCraftFit = "with_ramp";
  } else if (
    coreCraftRaw === "not_eligible" ||
    coreCraftRaw === "noteligible" ||
    coreCraftRaw === "wrong_craft" ||
    coreCraftRaw === "ineligible"
  ) {
    coreCraftFit = "not_eligible";
  }

  if (typeof skillRequirementMet !== "boolean") {
    if (coreCraftFit) {
      skillRequirementMet = coreCraftFit !== "not_eligible";
    } else {
      // Infer fail only when model flagged must-have / hard missing skills.
      const hardMissing = Array.isArray(missingSkills)
        ? missingSkills.some((s) => {
            if (!s || typeof s !== "object") return false;
            const m = s as {
              learnability?: string;
              isHardRequirement?: boolean;
            };
            if (m.learnability === "must_have") return true;
            if (
              m.learnability === "learn_on_job" ||
              m.learnability === "nice_to_have"
            ) {
              return false;
            }
            return Boolean(m.isHardRequirement);
          })
        : false;
      skillRequirementMet = !hardMissing;
    }
  }

  if (!coreCraftFit) {
    coreCraftFit = skillRequirementMet ? "with_ramp" : "not_eligible";
  } else {
    skillRequirementMet = coreCraftFit !== "not_eligible";
  }

  const skillNotes = String(o.skillNotes ?? o.skill_notes ?? "").trim();

  let commuteRequirementMet =
    o.commuteRequirementMet ?? o.commute_requirement_met;
  if (typeof commuteRequirementMet === "string") {
    const s = commuteRequirementMet.toLowerCase().trim();
    commuteRequirementMet = s === "true" || s === "yes" || s === "met";
  }
  if (typeof commuteRequirementMet !== "boolean") {
    commuteRequirementMet = true;
  }

  const commuteNotes = String(o.commuteNotes ?? o.commute_notes ?? "").trim();
  const estimatedCommuteMinutesRaw =
    o.estimatedCommuteMinutes ?? o.estimated_commute_minutes;
  const estimatedCommuteMinutes =
    typeof estimatedCommuteMinutesRaw === "number" &&
    Number.isFinite(estimatedCommuteMinutesRaw)
      ? Math.round(estimatedCommuteMinutesRaw)
      : undefined;

  let feedbackRequirementMet =
    o.feedbackRequirementMet ?? o.feedback_requirement_met;
  if (typeof feedbackRequirementMet === "string") {
    const s = feedbackRequirementMet.toLowerCase().trim();
    feedbackRequirementMet = s === "true" || s === "yes" || s === "met";
  }
  if (typeof feedbackRequirementMet !== "boolean") {
    feedbackRequirementMet = true;
  }
  const feedbackNotes = String(
    o.feedbackNotes ?? o.feedback_notes ?? ""
  ).trim();

  const scopeIncrease = scoreOrUndef(
    o.scopeIncrease ?? o.scope_increase ?? details?.scopeIncrease
  );
  const scopeNotes = String(o.scopeNotes ?? o.scope_notes ?? "").trim();

  const pathRaw = String(
    o.pathType ?? o.path_type ?? o.ladderType ?? o.ladder_type ?? ""
  )
    .toLowerCase()
    .trim();
  let pathType: string = "step";
  if (pathRaw.includes("stretch")) pathType = "stretch";
  else if (pathRaw.includes("dest")) pathType = "destination";
  else if (pathRaw.includes("later") || pathRaw.includes("side"))
    pathType = "lateral";
  else if (pathRaw.includes("step") || pathRaw.includes("next"))
    pathType = "step";

  const ladderPath = String(
    o.ladderPath ?? o.ladder_path ?? o.pathNarrative ?? o.path_narrative ?? ""
  ).trim();
  const matchedDestination = String(
    o.matchedDestination ?? o.matched_destination ?? o.destination ?? ""
  ).trim();

  return {
    fitScore: fitScoreOut,
    strengths,
    missingSkills,
    applyRecommendation: Boolean(applyRecommendation),
    reasoning: reasoning || `Overall fit score: ${fitScoreOut}/100`,
    preferenceAlignment:
      preferenceAlignment || "Preference alignment not provided.",
    preferencesMatch:
      typeof preferencesMatch === "boolean" ? preferencesMatch : true,
    requiredLanguages,
    languageRequirementMet,
    languageNotes,
    coreCraftFit,
    skillRequirementMet,
    skillNotes,
    commuteRequirementMet,
    commuteNotes,
    ...(estimatedCommuteMinutes !== undefined
      ? { estimatedCommuteMinutes }
      : {}),
    feedbackRequirementMet,
    feedbackNotes,
    scopeIncrease: scopeIncrease ?? 40,
    scopeNotes,
    pathType,
    ladderPath,
    ...(matchedDestination ? { matchedDestination } : {}),
    ...(o.employerType || o.employer_type
      ? { employerType: String(o.employerType ?? o.employer_type) }
      : {}),
    contributionScore: contributionScore ?? fitScoreOut,
    learningScore: learningScore ?? fitScoreOut,
    moneyScore: moneyScore ?? 50,
    contributionNotes,
    learningNotes,
    moneyNotes,
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

  const normalizeLadderRole = (r: unknown) => {
    const role = (r ?? {}) as Record<string, unknown>;
    const horizonRaw = String(role.horizon ?? role.timeframe ?? "next")
      .toLowerCase()
      .trim();
    const horizon = horizonRaw.includes("stretch") ? "stretch" : "next";
    const branchRaw = String(role.branch ?? role.path ?? "same")
      .toLowerCase()
      .trim();
    const branch = branchRaw.includes("adj") ? "adjacent" : "same";
    const title = String(role.title ?? role.role ?? role.name ?? "").trim();
    if (!title) return null;
    const searchQuery = String(role.searchQuery ?? role.search_query ?? "")
      .trim()
      .slice(0, 80);
    return {
      title,
      horizon,
      branch,
      transferableStrengths: coerceStringArray(
        role.transferableStrengths ??
          role.transferable_strengths ??
          role.strengths
      ),
      gapsToClose: coerceStringArray(
        role.gapsToClose ?? role.gaps_to_close ?? role.gaps
      ),
      whyScopeIncreases: String(
        role.whyScopeIncreases ??
          role.why_scope_increases ??
          role.scopeIncrease ??
          role.scope_notes ??
          ""
      ).trim(),
      ...(searchQuery ? { searchQuery } : {}),
    };
  };

  const ladderRaw = o.careerLadder ?? o.career_ladder ?? o.ladder;
  let careerLadder: Record<string, unknown> | undefined;
  if (ladderRaw && typeof ladderRaw === "object") {
    const L = ladderRaw as Record<string, unknown>;
    const nextRoles = (
      Array.isArray(L.nextRoles)
        ? L.nextRoles
        : Array.isArray(L.next_roles)
          ? L.next_roles
          : []
    )
      .map(normalizeLadderRole)
      .filter(Boolean);
    const stretchRoles = (
      Array.isArray(L.stretchRoles)
        ? L.stretchRoles
        : Array.isArray(L.stretch_roles)
          ? L.stretch_roles
          : []
    )
      .map(normalizeLadderRole)
      .filter(Boolean)
      .map((r) => (r ? { ...r, horizon: "stretch" as const } : r));

    const currentRole = String(
      L.currentRole ?? L.current_role ?? L.current ?? ""
    ).trim();
    if (currentRole && nextRoles.length > 0) {
      careerLadder = {
        currentRole,
        summary: String(L.summary ?? L.strategy ?? "").trim() ||
          `Climb from ${currentRole} via scope step-ups and adjacent moves.`,
        nextRoles,
        stretchRoles:
          stretchRoles.length > 0
            ? stretchRoles
            : nextRoles.slice(0, 1).map((r) =>
                r
                  ? {
                      ...r,
                      horizon: "stretch" as const,
                      whyScopeIncreases:
                        r.whyScopeIncreases ||
                        "Broader ownership and leadership ceiling in 1–2 years.",
                    }
                  : r
              ),
      };
    }
  }

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
    ...(careerLadder ? { careerLadder } : {}),
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
        relevant = score >= 40;
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

  const queriesRaw =
    o.searchQueries ?? o.search_queries ?? o.queries ?? o.query;

  let searchQueries: { query: string; language: string }[] = [];
  if (Array.isArray(queriesRaw)) {
    if (
      queriesRaw.length > 0 &&
      queriesRaw[0] &&
      typeof queriesRaw[0] === "object"
    ) {
      searchQueries = queriesRaw
        .map((item) => {
          const r = item as Record<string, unknown>;
          const query = String(r.query ?? r.keyword ?? r.text ?? "").trim();
          const lang = String(r.language ?? r.lang ?? "en")
            .toLowerCase()
            .startsWith("nl")
            ? "nl"
            : "en";
          const intentRaw = String(r.intent ?? r.kind ?? r.type ?? "")
            .toLowerCase()
            .trim();
          const intent =
            intentRaw === "stretch" || intentRaw === "ambitious"
              ? "stretch"
              : intentRaw === "next" || intentRaw === "near" || intentRaw === "hireable"
                ? "next"
                : undefined;
          return query
            ? intent
              ? { query, language: lang, intent }
              : { query, language: lang }
            : null;
        })
        .filter(Boolean) as {
        query: string;
        language: string;
        intent?: string;
      }[];
    } else {
      searchQueries = coerceStringArray(queriesRaw).map((query) => ({
        query,
        language: "en",
      }));
    }
  }

  const strategyRaw = String(
    o.searchLanguageStrategy ?? o.search_language_strategy ?? "single"
  )
    .toLowerCase()
    .trim();
  const searchLanguageStrategy =
    strategyRaw === "mixed" ? "mixed" : "single";

  const primaryRaw = String(
    o.primarySearchLanguage ?? o.primary_search_language ?? "en"
  )
    .toLowerCase()
    .trim();
  const primarySearchLanguage = primaryRaw.startsWith("nl") ? "nl" : "en";

  const languageRationale = String(
    o.languageRationale ?? o.language_rationale ?? ""
  ).trim();

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
    searchLanguageStrategy,
    primarySearchLanguage,
    searchQueries,
    languageRationale,
    rationale: rationale || "AI-tailored search plan",
  };
}

/** Gemini education / certification recommendation plans. */
export function normalizeEducationRecommendations(raw: unknown): unknown {
  const o = Array.isArray(raw)
    ? ((raw[0] ?? {}) as Record<string, unknown>)
    : raw && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : {};

  const summary = String(
    o.summary ?? o.strategy ?? o.educationStrategy ?? o.education_strategy ?? ""
  ).trim();

  const listRaw =
    o.recommendations ??
    o.educationRecommendations ??
    o.education_recommendations ??
    o.certs ??
    o.items ??
    [];

  const normalizeType = (v: unknown): string => {
    const s = String(v ?? "")
      .toLowerCase()
      .trim();
    if (s.includes("licen")) return "license";
    if (s.includes("degree") || s.includes("bachelor") || s.includes("master"))
      return "degree";
    if (s.includes("course") || s.includes("class")) return "course";
    if (s.includes("train")) return "training";
    return "certification";
  };

  const normalizeHorizon = (v: unknown): string => {
    const s = String(v ?? "")
      .toLowerCase()
      .trim();
    if (s.includes("stretch") || s.includes("long") || s.includes("later"))
      return "stretch";
    return "near";
  };

  const normalizeSources = (v: unknown): string[] => {
    const arr = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
    const out: string[] = [];
    for (const item of arr) {
      const s = String(item)
        .toLowerCase()
        .trim();
      if (s.includes("market") || s.includes("job")) out.push("market");
      else if (s.includes("ladder") || s.includes("career")) out.push("ladder");
      else if (s.includes("profile") || s.includes("cv") || s.includes("resume"))
        out.push("profile");
      else if (s.includes("knowledge") || s.includes("domain") || s.includes("industry"))
        out.push("knowledge");
    }
    return [...new Set(out.length ? out : ["knowledge"])];
  };

  const recommendations = (Array.isArray(listRaw) ? listRaw : [])
    .map((item, i) => {
      if (typeof item === "string") {
        return {
          title: item.trim(),
          type: "certification",
          rationale: "Suggested next credential for ladder climb.",
          closesGaps: [],
          targetsLadderRoles: [],
          priority: i + 1,
          horizon: "near",
          evidenceSources: ["knowledge"],
        };
      }
      if (!item || typeof item !== "object") return null;
      const r = item as Record<string, unknown>;
      const title = String(
        r.title ?? r.name ?? r.certification ?? r.credential ?? ""
      ).trim();
      if (!title) return null;
      const marketSignalCount = r.marketSignalCount ?? r.market_signal_count;
      return {
        title,
        type: normalizeType(r.type ?? r.kind ?? r.category),
        provider: String(r.provider ?? r.issuer ?? r.organization ?? "").trim() ||
          undefined,
        rationale: String(
          r.rationale ?? r.reason ?? r.why ?? r.explanation ?? ""
        ).trim() || "Helps unlock the next ladder move.",
        closesGaps: coerceStringArray(
          r.closesGaps ?? r.closes_gaps ?? r.gaps ?? r.skills
        ),
        targetsLadderRoles: coerceStringArray(
          r.targetsLadderRoles ??
            r.targets_ladder_roles ??
            r.roles ??
            r.targetRoles
        ),
        priority: coerceNumber(r.priority ?? r.rank ?? i + 1, i + 1),
        horizon: normalizeHorizon(r.horizon ?? r.timeHorizon ?? r.time_horizon),
        evidenceSources: normalizeSources(
          r.evidenceSources ?? r.evidence_sources ?? r.sources
        ),
        ...(typeof marketSignalCount === "number"
          ? { marketSignalCount: Math.round(marketSignalCount) }
          : {}),
      };
    })
    .filter(Boolean);

  return {
    summary:
      summary ||
      "Prioritize credentials that unlock hireable next roles on your ladder.",
    recommendations:
      recommendations.length > 0
        ? recommendations
        : [
            {
              title: "Role-relevant short course",
              type: "course",
              rationale:
                "Build a targeted credential that closes the most common gaps on your ladder.",
              closesGaps: [],
              targetsLadderRoles: [],
              priority: 1,
              horizon: "near",
              evidenceSources: ["knowledge"],
            },
          ],
  };
}

const FEEDBACK_THEMES = new Set([
  "too_senior",
  "too_junior",
  "wrong_craft",
  "location_commute",
  "compensation",
  "company_stage",
  "schedule_type",
  "other",
]);

/** Map free-form Gemini theme labels onto the FeedbackTheme enum. */
export function normalizeFeedbackReview(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const o = raw as Record<string, unknown>;
  const themeRaw = String(o.theme ?? o.feedback_theme ?? o.category ?? "")
    .toLowerCase()
    .trim()
    .replace(/[-\s]+/g, "_");

  let theme = themeRaw;
  if (!FEEDBACK_THEMES.has(theme)) {
    if (
      /senior|overqualified|too_high|above_level|staff_level|principal/.test(
        themeRaw
      )
    ) {
      theme = "too_senior";
    } else if (
      /junior|underqualified|too_low|entry|below_level|internship/.test(
        themeRaw
      )
    ) {
      theme = "too_junior";
    } else if (
      /craft|skill|domain|role_type|unfamiliar|consulting|industry|sector|function|title_mismatch|wrong_role|not_my_field/.test(
        themeRaw
      )
    ) {
      theme = "wrong_craft";
    } else if (
      /location|commute|remote|onsite|hybrid|distance|travel|reloc/.test(
        themeRaw
      )
    ) {
      theme = "location_commute";
    } else if (
      /comp|salary|pay|money|wage|benefits|compensation/.test(themeRaw)
    ) {
      theme = "compensation";
    } else if (
      /company|stage|startup|scaleup|enterprise|size|culture/.test(themeRaw)
    ) {
      theme = "company_stage";
    } else if (
      /schedule|shift|night|hours|part.?time|full.?time|weekend/.test(themeRaw)
    ) {
      theme = "schedule_type";
    } else {
      theme = "other";
    }
  }

  const stanceRaw = String(o.aiStance ?? o.ai_stance ?? o.stance ?? "")
    .toLowerCase()
    .trim()
    .replace(/[-\s]+/g, "_");
  let aiStance = stanceRaw;
  if (aiStance === "pushback" || aiStance === "disagree") {
    aiStance = "soft_pushback";
  } else if (
    aiStance !== "agree" &&
    aiStance !== "soft_pushback" &&
    aiStance !== "strong_pushback"
  ) {
    aiStance = "soft_pushback";
  }

  return {
    ...o,
    theme,
    aiStance,
    aiExplanation: String(o.aiExplanation ?? o.ai_explanation ?? "").trim(),
    constraintSummary: String(
      o.constraintSummary ?? o.constraint_summary ?? ""
    ).trim(),
    userLikelyCorrect: Boolean(
      o.userLikelyCorrect ?? o.user_likely_correct ?? false
    ),
    ...(ceilingCleaned()),
  };

  function ceilingCleaned(): { proposedExperienceCeiling?: string } {
    const ceiling =
      o.proposedExperienceCeiling ?? o.proposed_experience_ceiling;
    if (
      ceiling == null ||
      ceiling === "" ||
      ceiling === "null" ||
      ceiling === "none"
    ) {
      return {};
    }
    return { proposedExperienceCeiling: String(ceiling) };
  }
}

/** Drop null/empty experienceCeiling before Zod (Gemini often sends null). */
export function normalizeFeedbackResynth(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const o = { ...(raw as Record<string, unknown>) };
  const ceiling = o.experienceCeiling ?? o.experience_ceiling;
  if (
    ceiling == null ||
    ceiling === "" ||
    ceiling === "null" ||
    ceiling === "none" ||
    ceiling === "undefined"
  ) {
    delete o.experienceCeiling;
    delete o.experience_ceiling;
  } else {
    o.experienceCeiling = ceiling;
  }
  if (Array.isArray(o.learnedConstraints)) {
    o.learnedConstraints = o.learnedConstraints
      .map((c) => String(c ?? "").trim())
      .filter(Boolean);
  } else if (Array.isArray(o.learned_constraints)) {
    o.learnedConstraints = o.learned_constraints
      .map((c) => String(c ?? "").trim())
      .filter(Boolean);
  }
  if (typeof o.guidanceSummary !== "string" && typeof o.guidance_summary === "string") {
    o.guidanceSummary = o.guidance_summary;
  }
  return o;
}
