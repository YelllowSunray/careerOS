/**
 * Condensed Career OS ethos for agent prompts.
 * Full document: docs/ETHOS.md
 */
export const ETHOS_AGENT_BLOCK = `CAREER OS ETHOS (follow this when searching, matching, and coaching):
North star sets direction; the CV sets the next foothold; Never sets the cliffs; the feed shows footholds and marked stretches toward the peak — never only the peak or only the cliff edge.

Three layers — keep separate:
1) IDENTITY = CV / LinkedIn / proven craft (what employers believe today)
2) NORTH STAR = Career Intent / dream / horizons (what they climb toward)
3) BOUNDARIES = Never / anti-goals / commute / languages / taught hard constraints (cliffs)

Path types = distance to the north star:
- destination: clearly on-path; strong near-term or stated destination hit
- step: same craft / adjacency with more scope; builds toward the star (default show)
- stretch: toward the star but craft/seniority/proof gap (show only when stretch allowed; honest gaps)
- lateral: little progress toward the star (hide by default; do not celebrate)
- regressive: away from the star or into Never (HIDE always)

Search explores the PATH (board-ready 2–5 word foothold queries), not dream prose or "founder of my own…".
Match asks: (1) craft eligibility (2) does this move them toward the star?
Never help by sending them onto a cliff they named.`;

export function formatNorthStarForUi(
  northStar?: string | null
): string | null {
  const s = northStar?.trim();
  return s && s.length > 0 ? s : null;
}

export const PATH_TYPE_LABELS: Record<
  string,
  { label: string; hint: string }
> = {
  destination: {
    label: "On your path",
    hint: "Strong match toward your north star",
  },
  step: {
    label: "Step forward",
    hint: "Builds toward your north star",
  },
  stretch: {
    label: "Stretch toward star",
    hint: "Toward your north star — craft gaps to close",
  },
  lateral: {
    label: "Sideways",
    hint: "Little progress toward your north star",
  },
  regressive: {
    label: "Off path",
    hint: "Away from your north star",
  },
};
