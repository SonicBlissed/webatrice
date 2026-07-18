/**
 * MTG turn phases in order. Players click through these to signal what
 * they're doing on their turn. Advancing past "end" (via a Pass action)
 * hands the turn to the next player and resets to "untap".
 *
 * The phase enum is intentionally granular — grouping (beginning /
 * pre-combat main / combat / post-combat main / ending) is a UI concern
 * left to consumers.
 */
export const PHASES = [
  "untap",
  "upkeep",
  "draw",
  "main1",
  "startCombat",
  "attack",
  "block",
  "damage",
  "endCombat",
  "main2",
  "end",
] as const;

export type Phase = (typeof PHASES)[number];

export const FIRST_PHASE: Phase = PHASES[0];

export const PHASE_LABEL: Record<Phase, string> = {
  untap:       "Untap",
  upkeep:      "Upkeep",
  draw:        "Draw",
  main1:       "Main 1",
  startCombat: "Start Combat",
  attack:      "Attack",
  block:       "Block",
  damage:      "Damage",
  endCombat:   "End Combat",
  main2:       "Main 2",
  end:         "End",
};
