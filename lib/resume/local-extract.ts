const TECH_KEYWORDS = [
  "JavaScript", "TypeScript", "Python", "Java", "C#", "C++", "Go", "Rust", "Ruby",
  "PHP", "Swift", "Kotlin", "Scala", "R", "SQL", "HTML", "CSS", "Sass", "Less",
  "React", "React Native", "Next.js", "Vue", "Angular", "Svelte", "Node.js",
  "Express", "Django", "Flask", "FastAPI", "Spring", "Rails", "Laravel",
  "PostgreSQL", "MySQL", "MongoDB", "Redis", "Firebase", "Firestore", "Supabase",
  "AWS", "GCP", "Azure", "Docker", "Kubernetes", "Terraform", "CI/CD",
  "Git", "GitHub", "GitLab", "Jest", "Cypress", "Playwright", "Tailwind CSS",
  "GraphQL", "REST", "gRPC", "Microservices", "Machine Learning", "AI",
  "TensorFlow", "PyTorch", "OpenAI", "Gemini", "LLM", "Agile", "Scrum",
  "Figma", "Webpack", "Vite", "Linux", "Unix", "Bash", "Shell",
];

export interface LocalResumeExtraction {
  skills: string[];
  technologies: string[];
  experience: { title: string; company: string; description: string; technologies: string[] }[];
  projects: { name: string; description: string; technologies: string[] }[];
  education: { institution: string; degree: string }[];
  certifications: { name: string }[];
}

function unique(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function matchKeywords(text: string): string[] {
  const lower = text.toLowerCase();
  return TECH_KEYWORDS.filter((kw) => {
    const pattern = kw.toLowerCase().replace(/[.+]/g, "\\$&");
    return new RegExp(`\\b${pattern}\\b`, "i").test(lower);
  });
}

function extractSections(text: string): LocalResumeExtraction {
  const technologies = matchKeywords(text);
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const skills: string[] = [...technologies];
  const skillSection = extractSectionLines(lines, ["skills", "technical skills", "core competencies"]);
  if (skillSection.length) {
    const parsed = skillSection
      .join(" ")
      .split(/[,•|·]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 1 && s.length < 60);
    skills.push(...parsed);
  }

  return {
    skills: unique(skills).slice(0, 40),
    technologies: unique(technologies).slice(0, 30),
    experience: [],
    projects: [],
    education: [],
    certifications: [],
  };
}

function extractSectionLines(lines: string[], headers: string[]): string[] {
  const headerIdx = lines.findIndex((l) =>
    headers.some((h) => l.toLowerCase().replace(/[^a-z ]/g, "").includes(h))
  );
  if (headerIdx === -1) return [];

  const section: string[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^[A-Z][A-Z\s/&-]{2,}$/.test(line) && line.length < 40) break;
    section.push(line);
    if (section.length > 20) break;
  }
  return section;
}

export function extractResumeLocally(rawText: string): LocalResumeExtraction {
  const normalized = rawText.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return {
      skills: [],
      technologies: [],
      experience: [],
      projects: [],
      education: [],
      certifications: [],
    };
  }
  return extractSections(rawText);
}
