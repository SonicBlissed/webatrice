import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { primaryType, type DeckCard, type CardTypeGroup } from "@/lib/decks";
import { useBracketData } from "@/lib/scryfallCache";
import { findCombosInDeck, type Combo } from "@/lib/combos";
import {
  MLD_CURATED_CI,
  EXTRA_TURN_CHAIN_LIST_CI,
  normaliseName,
} from "@/lib/bracketRules";
import { useAdaptiveDebounce } from "@/lib/time";

// ---------- Stats ----------

type Color = "W" | "U" | "B" | "R" | "G" | "C";
const COLORS: Color[] = ["W", "U", "B", "R", "G", "C"];
const COLOR_LABEL: Record<Color, string> = {
  W: "White", U: "Blue", B: "Black", R: "Red", G: "Green", C: "Colorless",
};
const CURVE_BUCKETS = [0, 1, 2, 3, 4, 5, 6, 7] as const; // 7 is the "7+" bucket

type Stats = {
  totalCards: number;
  nonlandCards: number;
  landCount: number;
  avgNonlandCmc: number;
  curve: Record<number, number>;
  pips: Record<Color, number>;
  typeCounts: Partial<Record<CardTypeGroup, number>>;
};

function computeStats(cards: DeckCard[]): Stats {
  let totalCards = 0;
  let nonlandCards = 0;
  let landCount = 0;
  let totalNonlandCmc = 0;
  const curve: Record<number, number> = {};
  // Card-based color distribution (NOT pip counting): each nonland card
  // contributes its quantity to every color of its identity, or to `C` if
  // it's colorless. That way Sol Ring and Eldrazi actually show up in the
  // pie, and multicolor cards register in each color.
  const pips: Record<Color, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  const typeCounts: Partial<Record<CardTypeGroup, number>> = {};

  for (const card of cards) {
    const qty = card.quantity;
    totalCards += qty;
    const type = primaryType(card.type_line);
    typeCounts[type] = (typeCounts[type] ?? 0) + qty;

    if (type === "Land") {
      landCount += qty;
    } else {
      nonlandCards += qty;
      const cmc = card.cmc ?? 0;
      const bucket = cmc >= 7 ? 7 : Math.floor(cmc);
      curve[bucket] = (curve[bucket] ?? 0) + qty;
      totalNonlandCmc += cmc * qty;

      // Attribute the card to its color(s). No colors on a nonland card
      // means it's colorless (Sol Ring, Eldrazi, etc.) → C slice. Cards
      // with multiple colors contribute to each.
      if (card.colors.length === 0) {
        pips.C += qty;
      } else {
        for (const raw of card.colors) {
          if (raw === "W" || raw === "U" || raw === "B" || raw === "R" || raw === "G") {
            pips[raw] += qty;
          }
        }
      }
    }
  }

  return {
    totalCards,
    nonlandCards,
    landCount,
    avgNonlandCmc: nonlandCards > 0 ? totalNonlandCmc / nonlandCards : 0,
    curve,
    pips,
    typeCounts,
  };
}

// ---------- Small building blocks ----------

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-bg-elevated border border-border-subtle p-3">
      <div className="text-2xl font-modern font-bold text-text-primary tabular-nums">
        {value}
      </div>
      <div className="text-xs uppercase tracking-widest text-text-muted mt-1">{label}</div>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-widest text-text-muted mb-2">
      {children}
    </h3>
  );
}

function ManaCurve({ curve }: { curve: Record<number, number> }) {
  const max = Math.max(1, ...CURVE_BUCKETS.map((b) => curve[b] ?? 0));
  return (
    <div className="flex items-end gap-1 h-32">
      {CURVE_BUCKETS.map((b) => {
        const count = curve[b] ?? 0;
        const heightPct = (count / max) * 100;
        return (
          <div key={b} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
            <div className="text-[10px] text-text-muted tabular-nums h-3">
              {count > 0 ? count : ""}
            </div>
            <div
              className="w-full bg-gradient-to-t from-accent-secondary to-accent rounded-t"
              style={{ height: `${heightPct}%` }}
              title={`${count} card${count === 1 ? "" : "s"} at CMC ${b === 7 ? "7+" : b}`}
            />
            <div className="text-xs text-text-muted tabular-nums">{b === 7 ? "7+" : b}</div>
          </div>
        );
      })}
    </div>
  );
}

// Traditional MTG colors chosen for legibility on the dark theme.
// (Black gets a lighter tone so it doesn't blend into the background.)
const PIE_HEX: Record<Color, string> = {
  W: "#F8F0C4",
  U: "#4B92DB",
  B: "#4A3B60",
  R: "#E15C4F",
  G: "#4CA96A",
  C: "#B7B7C8",
};

const SIZE = 240;
const RADIUS = SIZE / 2;

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function ColorPie({ pips }: { pips: Record<Color, number> }) {
  const total = COLORS.reduce((s, c) => s + pips[c], 0);

  if (total === 0) {
    return (
      <div
        className="mx-auto rounded-full border border-border-subtle"
        style={{ width: SIZE, height: SIZE, background: "rgb(var(--bg-elevated))" }}
      />
    );
  }

  let acc = 0;
  const slices = COLORS.filter((c) => pips[c] > 0).map((c) => {
    const n = pips[c];
    const sweep = (n / total) * 360;
    const start = acc;
    const end = acc + sweep;
    acc = end;

    // Full-circle degenerate case: `A` can't draw a 360° arc directly,
    // so fall back to two 180° arcs by using a full circle path.
    let path: string;
    if (sweep >= 359.999) {
      const top = polar(RADIUS, RADIUS, RADIUS, 0);
      const bottom = polar(RADIUS, RADIUS, RADIUS, 180);
      path = [
        `M ${top.x} ${top.y}`,
        `A ${RADIUS} ${RADIUS} 0 1 1 ${bottom.x} ${bottom.y}`,
        `A ${RADIUS} ${RADIUS} 0 1 1 ${top.x} ${top.y}`,
        "Z",
      ].join(" ");
    } else {
      const p1 = polar(RADIUS, RADIUS, RADIUS, start);
      const p2 = polar(RADIUS, RADIUS, RADIUS, end);
      const largeArc = sweep > 180 ? 1 : 0;
      path = [
        `M ${RADIUS} ${RADIUS}`,
        `L ${p1.x} ${p1.y}`,
        `A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${p2.x} ${p2.y}`,
        "Z",
      ].join(" ");
    }

    return { color: c, path };
  });

  // Only colors that actually appear in the pie get a legend entry.
  const legendColors = COLORS.filter((c) => pips[c] > 0);

  return (
    // 1fr auto 1fr keeps the pie perfectly centered in the section while the
    // legend rides in the right-hand column, aligned to its left edge so it
    // sits close to the pie.
    <div
      className="grid items-center gap-6"
      style={{ gridTemplateColumns: "1fr auto 1fr" }}
    >
      <div aria-hidden />
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="shadow-glow rounded-full"
        role="img"
        aria-label="Color distribution pie"
      >
        {slices.map((s) => (
          <path
            key={s.color}
            d={s.path}
            fill={PIE_HEX[s.color]}
            stroke="rgb(var(--bg-base))"
            strokeWidth={slices.length > 1 ? 2 : 0}
          />
        ))}
      </svg>

      <div className="justify-self-start flex flex-col gap-2">
        {legendColors.map((c) => {
          const n = pips[c];
          const pct = (n / total) * 100;
          return (
            <div
              key={c}
              className="flex items-center gap-2 text-sm"
              title={COLOR_LABEL[c]}
            >
              <span
                className="h-3 w-3 rounded-sm border border-border-subtle shrink-0"
                style={{ backgroundColor: PIE_HEX[c] }}
              />
              <img
                src={`https://svgs.scryfall.io/card-symbols/${c}.svg`}
                alt={COLOR_LABEL[c]}
                className="w-5 h-5 shrink-0"
                draggable={false}
              />
              <span className="text-text-primary tabular-nums font-semibold">{n}</span>
              <span className="text-text-muted tabular-nums text-xs">
                {pct.toFixed(0)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Bracket estimate ----------
//
// Rules follow edhpowerlevel.com's implementation (which mirrors WotC's
// bracket rules with reasonable interpretations, and is now our source of
// truth for bracket determination):
//
//   B2 (Core):     0 GC, 0 MLD, ≤2 extra turns, no chain extra turns,
//                  no early game-defining combos
//   B3 (Upgraded): ≤3 GC, 0 MLD, ≤3 extra turns, no chain extra turns,
//                  no early game-defining combos
//   B4 (Optimized): any of the B3 limits exceeded
//
// B5 (cEDH) needs power-score signals we don't compute, so we cap at B4.

type Bracket = 2 | 3 | 4;

const BRACKET_LABEL: Record<Bracket, string> = {
  2: "Core",
  3: "Upgraded",
  4: "Optimized",
};

const BRACKET_TONE: Record<
  Bracket,
  { text: string; bg: string; border: string }
> = {
  2: { text: "text-emerald-300", bg: "bg-emerald-500/15", border: "border-emerald-500/40" },
  3: { text: "text-yellow-300",  bg: "bg-yellow-500/15",  border: "border-yellow-500/40"  },
  4: { text: "text-red-300",     bg: "bg-red-500/15",     border: "border-red-500/40"     },
};

type Signals = {
  gameChangers: DeckCard[];
  mld: DeckCard[];
  extraTurns: DeckCard[];
  chainExtraTurns: DeckCard[];
  earlyCombos: Combo[];
};

function estimateBracket({
  gameChangers, mld, extraTurns, chainExtraTurns, earlyCombos,
}: Signals): Bracket {
  const gc = gameChangers.length;
  const m = mld.length;
  const et = extraTurns.length;
  const chainET = chainExtraTurns.length;
  const co = earlyCombos.length;

  // Any single violation of B3's ceiling → B4.
  if (gc > 3 || m > 0 || co > 0 || chainET > 0 || et > 3) return 4;

  // Presence beyond B2's caps → B3.
  if (gc > 0 || et > 2) return 3;

  return 2;
}

function CountBadge({
  label, count, tone = "muted", items = [],
}: {
  label: string;
  count: number;
  tone?: "muted" | "warn" | "hot";
  /** Items shown in the hover tooltip. Omit or leave empty to skip the tooltip. */
  items?: string[];
}) {
  const toneClass =
    tone === "hot"
      ? "text-red-300 bg-red-500/10 border-red-500/30"
      : tone === "warn"
      ? "text-yellow-300 bg-yellow-500/10 border-yellow-500/30"
      : "text-text-secondary bg-bg-elevated border-border-subtle";

  const ref = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canHover = items.length > 0;

  const show = () => {
    if (!canHover || !ref.current) return;
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    setRect(ref.current.getBoundingClientRect());
  };
  const scheduleHide = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setRect(null), 120);
  };

  // Choose the side of the badge with more room, so tall lists get to grow.
  const layout = rect
    ? (() => {
        const EDGE = 8;
        const GAP = 6;
        const spaceBelow = window.innerHeight - rect.bottom - EDGE;
        const spaceAbove = rect.top - EDGE;
        const showBelow = spaceBelow >= 220 || spaceBelow >= spaceAbove;
        const maxHeight = Math.min(560, showBelow ? spaceBelow - GAP : spaceAbove - GAP);
        return {
          left: Math.max(EDGE, Math.min(rect.left, window.innerWidth - 260 - EDGE)),
          top: showBelow ? rect.bottom + GAP : undefined,
          bottom: showBelow ? undefined : window.innerHeight - rect.top + GAP,
          maxHeight,
        };
      })()
    : null;

  return (
    <>
      <div
        ref={ref}
        onMouseEnter={show}
        onMouseLeave={scheduleHide}
        className={`px-2.5 py-1.5 rounded-md border text-xs ${toneClass} ${canHover ? "cursor-help" : ""}`}
      >
        <div className="uppercase tracking-wider text-[10px] opacity-70">{label}</div>
        <div className="font-semibold tabular-nums text-sm">{count}</div>
      </div>
      {rect && layout &&
        createPortal(
          <div
            onMouseEnter={show}
            onMouseLeave={scheduleHide}
            className="fixed z-[60] rounded-lg bg-bg-surface border border-border-subtle shadow-glow py-2 px-3 flex flex-col"
            style={{
              left: layout.left,
              top: layout.top,
              bottom: layout.bottom,
              width: 260,
              maxHeight: layout.maxHeight,
            }}
          >
            <div className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-1.5 shrink-0">
              {label}
            </div>
            <ul className="space-y-0.5 text-xs text-text-primary overflow-y-auto pr-1">
              {items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
}

function BracketEstimate({ cards }: { cards: DeckCard[] }) {
  // Fingerprint the deck by oracle_id + category + quantity so identity-
  // preserving edits (like a printing swap) don't retrigger the estimate.
  const fingerprint = useMemo(
    () =>
      cards
        .map((c) => `${c.oracle_id}:${c.category}:${c.quantity}`)
        .sort()
        .join("|"),
    [cards],
  );

  const { committed: debouncedCards, pending: debouncePending } =
    useAdaptiveDebounce(cards, fingerprint);

  const {
    gameChangers, mld, extraTurns,
    loading: dataLoading, error,
  } = useBracketData();

  // Combos are a per-deck POST to Commander Spellbook (already filtered to
  // early game-defining 2-card combos in the fetch layer).
  const [earlyCombos, setEarlyCombos] = useState<Combo[]>([]);
  const [combosLoading, setCombosLoading] = useState<boolean>(false);

  const debouncedCardNames = useMemo(() => {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const c of debouncedCards) {
      if (seen.has(c.oracle_id)) continue;
      seen.add(c.oracle_id);
      names.push(c.name);
    }
    return names;
  }, [debouncedCards]);

  useEffect(() => {
    if (debouncedCardNames.length === 0) {
      setEarlyCombos([]);
      return;
    }
    let cancelled = false;
    setCombosLoading(true);
    findCombosInDeck(debouncedCardNames).then((c) => {
      if (cancelled) return;
      setEarlyCombos(c);
      setCombosLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [debouncedCardNames]);

  const busy = debouncePending || dataLoading || combosLoading;

  const signals = useMemo<Signals | null>(() => {
    if (!gameChangers || !mld || !extraTurns) return null;

    // Dedupe by oracle_id for category-crossing safety.
    const seen = new Set<string>();
    const uniqueCards: DeckCard[] = [];
    for (const c of debouncedCards) {
      if (seen.has(c.oracle_id)) continue;
      seen.add(c.oracle_id);
      uniqueCards.push(c);
    }

    // MLD and Extra turns unions: the Scryfall tag PLUS edhpowerlevel's
    // curated additions (matched by name). Chain extra turns is a strict
    // subset of extra turns, matched only by name.
    const mldCards = uniqueCards.filter(
      (c) => mld.has(c.oracle_id) || MLD_CURATED_CI.has(normaliseName(c.name)),
    );
    const extraTurnCards = uniqueCards.filter(
      (c) =>
        extraTurns.has(c.oracle_id) ||
        EXTRA_TURN_CHAIN_LIST_CI.has(normaliseName(c.name)),
    );
    const chainExtraTurnCards = uniqueCards.filter((c) =>
      EXTRA_TURN_CHAIN_LIST_CI.has(normaliseName(c.name)),
    );

    // Filter combos to "early" — edhpowerlevel's rule: total mana required
    // (CMC of each combo piece from the deck + activation cost) < 8. Anything
    // 8-or-more is a late-game combo that doesn't push the bracket.
    const cmcByOracle = new Map<string, number>();
    for (const c of uniqueCards) {
      if (c.cmc !== null) cmcByOracle.set(c.oracle_id, c.cmc);
    }
    const earlyOnly = earlyCombos.filter((combo) => {
      let total = combo.manaValueNeeded;
      for (const id of combo.oracleIds) total += cmcByOracle.get(id) ?? 0;
      return total < 8;
    });

    return {
      gameChangers: uniqueCards.filter((c) => gameChangers.has(c.oracle_id)),
      mld: mldCards,
      extraTurns: extraTurnCards,
      chainExtraTurns: chainExtraTurnCards,
      earlyCombos: earlyOnly,
    };
  }, [debouncedCards, gameChangers, mld, extraTurns, earlyCombos]);

  if (error && !signals) {
    return (
      <div className="text-sm text-text-muted">
        Couldn't load bracket signals: {error}
      </div>
    );
  }

  if (busy || !signals) {
    return (
      <div className="flex items-center gap-2 text-sm text-text-muted">
        <Loader2 size={14} className="animate-spin" />
        {debouncePending
          ? "Waiting for changes to settle…"
          : "Loading bracket data…"}
      </div>
    );
  }

  const bracket = estimateBracket(signals);
  const tone = BRACKET_TONE[bracket];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <div
          className={`h-16 w-16 rounded-lg border ${tone.bg} ${tone.border} flex items-center justify-center`}
        >
          <span className={`text-3xl font-modern font-bold tabular-nums ${tone.text}`}>
            {bracket}
          </span>
        </div>
        <div>
          <div className={`text-sm font-semibold ${tone.text}`}>
            Bracket {bracket} · {BRACKET_LABEL[bracket]}
          </div>
          <div className="text-xs text-text-muted mt-1">
            Based on Game Changers, MLD, extra turns, and early game-defining combos.
          </div>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-2">
        <CountBadge
          label="Game Changers"
          count={signals.gameChangers.length}
          tone={signals.gameChangers.length > 3 ? "hot" : signals.gameChangers.length > 0 ? "warn" : "muted"}
          items={signals.gameChangers.map((c) => c.name)}
        />
        <CountBadge
          label="MLD"
          count={signals.mld.length}
          tone={signals.mld.length > 0 ? "hot" : "muted"}
          items={signals.mld.map((c) => c.name)}
        />
        <CountBadge
          label="Extra turns"
          count={signals.extraTurns.length}
          tone={signals.extraTurns.length > 3 ? "hot" : signals.extraTurns.length > 2 ? "warn" : "muted"}
          items={signals.extraTurns.map((c) => c.name)}
        />
        <CountBadge
          label="Chain extra turns"
          count={signals.chainExtraTurns.length}
          tone={signals.chainExtraTurns.length > 0 ? "hot" : "muted"}
          items={signals.chainExtraTurns.map((c) => c.name)}
        />
        <CountBadge
          label="Early combos"
          count={signals.earlyCombos.length}
          tone={signals.earlyCombos.length > 0 ? "hot" : "muted"}
          items={signals.earlyCombos.map((c) => {
            const cards = c.names.length > 0 ? c.names.join(" + ") : "(unnamed)";
            return c.results[0] ? `${cards} → ${c.results[0]}` : cards;
          })}
        />
      </div>

    </div>
  );
}

function TypeBreakdown({
  counts,
}: {
  counts: Partial<Record<CardTypeGroup, number>>;
}) {
  const entries = (Object.entries(counts) as [CardTypeGroup, number][])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    return <div className="text-sm text-text-muted italic">No cards yet.</div>;
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {entries.map(([type, count]) => (
        <div
          key={type}
          className="flex items-center justify-between px-3 py-1.5 rounded-md bg-bg-elevated border border-border-subtle text-sm"
        >
          <span className="text-text-primary">{type}</span>
          <span className="text-text-muted tabular-nums">{count}</span>
        </div>
      ))}
    </div>
  );
}

// ---------- Main component ----------

export default function DeckBreakdown({ cards }: { cards: DeckCard[] }) {
  const stats = useMemo(() => computeStats(cards), [cards]);

  if (stats.totalCards === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-text-muted text-center p-8">
        <div>
          <p>No cards in this deck yet.</p>
          <p className="mt-2 text-xs">Switch to Search to add cards, or import a list.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <section>
        <SectionHeader>Overview</SectionHeader>
        <div className="grid grid-cols-4 gap-3">
          <StatCard label="Total" value={stats.totalCards} />
          <StatCard label="Nonland" value={stats.nonlandCards} />
          <StatCard label="Lands" value={stats.landCount} />
          <StatCard label="Avg CMC" value={stats.avgNonlandCmc.toFixed(2)} />
        </div>
      </section>

      <section>
        <SectionHeader>Bracket estimate</SectionHeader>
        <BracketEstimate cards={cards} />
      </section>

      <section>
        <SectionHeader>Mana curve</SectionHeader>
        <ManaCurve curve={stats.curve} />
      </section>

      <section>
        <SectionHeader>Color distribution</SectionHeader>
        <ColorPie pips={stats.pips} />
      </section>

      <section>
        <SectionHeader>Card types</SectionHeader>
        <TypeBreakdown counts={stats.typeCounts} />
      </section>
    </div>
  );
}
