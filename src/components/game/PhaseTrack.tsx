import {
  RotateCcw, Settings, BookOpen, Circle, CircleDot,
  Swords, Sword, Shield, Zap, Flag, Moon, LogOut,
  type LucideIcon,
} from "lucide-react";
import { PHASES, PHASE_LABEL, type Phase } from "@/lib/gamePhases";

const PHASE_ICON: Record<Phase, LucideIcon> = {
  untap:       RotateCcw,
  upkeep:      Settings,
  draw:        BookOpen,
  main1:       Circle,
  startCombat: Swords,
  attack:      Sword,
  block:       Shield,
  damage:      Zap,
  endCombat:   Flag,
  main2:       CircleDot,
  end:         Moon,
};

/** Color wash for each phase button — 50% overlay tint. Grouped by phase
 *  family: beginning-phase = green, mains = blue, combat = red, end = green. */
const PHASE_TINT: Record<Phase, string> = {
  untap:       "#22c55e", // green
  upkeep:      "#22c55e",
  draw:        "#22c55e",
  main1:       "#3b82f6", // blue
  startCombat: "#ef4444", // red
  attack:      "#ef4444",
  block:       "#ef4444",
  damage:      "#ef4444",
  endCombat:   "#ef4444",
  main2:       "#3b82f6",
  end:         "#22c55e",
};

/**
 * Vertical column of MTG turn-phase buttons plus a Pass action at the
 * bottom. Each phase shows an icon + label. Clicking highlights the
 * phase; Pass advances to the next player's turn.
 *
 * Only the active player can change phases — the phase buttons are
 * disabled for everyone else. Pass, on the other hand, is available to
 * anyone (e.g., a stuck game where the active player has stepped away).
 */
type Props = {
  currentPhase: Phase;
  onPhaseChange: (phase: Phase) => void;
  onPass: () => void;
  /** True when the viewer is the active player; controls phase-button clickability. */
  canChangePhase: boolean;
};

export default function PhaseTrack({ currentPhase, onPhaseChange, onPass, canChangePhase }: Props) {
  return (
    <div className="shrink-0 h-full border-r border-border-subtle bg-bg-surface/40 flex flex-col py-4 gap-6 w-28 min-h-0 overflow-y-auto">
      {PHASES.map((phase) => {
        const Icon = PHASE_ICON[phase];
        const active = phase === currentPhase;
        return (
          <button
            key={phase}
            onClick={() => onPhaseChange(phase)}
            disabled={!canChangePhase}
            title={canChangePhase ? undefined : "Only the active player can change phases"}
            className={[
              "relative overflow-hidden mx-2 px-2 py-2 rounded-md text-[15px] font-semibold uppercase tracking-wider flex-1 min-h-0 flex flex-col items-center justify-center gap-1 text-white bg-bg-elevated/40 transition-opacity duration-300",
              active ? "opacity-100" : "opacity-40",
              canChangePhase ? "cursor-pointer" : "cursor-not-allowed",
            ].join(" ")}
          >
            {/* 50% color wash for this phase group — sits under the icon
                and label so it only tints the background, not the text. */}
            <div
              className="absolute inset-0 pointer-events-none z-0"
              style={{ backgroundColor: PHASE_TINT[phase], opacity: 0.5 }}
              aria-hidden
            />
            <Icon size={18} className="relative z-10 text-white" />
            <span className="relative z-10 leading-tight text-center">
              {PHASE_LABEL[phase]}
            </span>
          </button>
        );
      })}
      <div className="mt-auto pt-3 border-t border-border-subtle mx-2">
        <button
          onClick={onPass}
          className="w-full px-2 py-3 rounded-md text-xs font-bold uppercase tracking-wider bg-accent-secondary hover:bg-accent text-white shadow-glow transition-colors flex flex-col items-center gap-1"
          title="End your turn and pass to the next player"
        >
          <LogOut size={18} />
          <span>Pass</span>
        </button>
      </div>
    </div>
  );
}
