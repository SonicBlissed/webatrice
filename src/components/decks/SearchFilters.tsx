import { ChevronDown, ChevronUp } from "lucide-react";

// ---------- Types ----------

export type Color = "W" | "U" | "B" | "R" | "G" | "C";
export type ColorMode = "includes" | "exactly" | "atMost";
export type CardType =
  | "Creature"
  | "Instant"
  | "Sorcery"
  | "Enchantment"
  | "Artifact"
  | "Planeswalker"
  | "Land";
export type Rarity = "common" | "uncommon" | "rare" | "mythic";

export type SearchFiltersState = {
  colors: Color[];
  colorMode: ColorMode;
  types: CardType[];
  subtype: string;
  showAdvanced: boolean;
  cmcMin: string;
  cmcMax: string;
  oracle: string;
  rarities: Rarity[];
};

export const EMPTY_FILTERS: SearchFiltersState = {
  colors: [],
  colorMode: "includes",
  types: [],
  subtype: "",
  showAdvanced: false,
  cmcMin: "",
  cmcMax: "",
  oracle: "",
  rarities: [],
};

const COLORS: Color[] = ["W", "U", "B", "R", "G", "C"];
const TYPES: CardType[] = [
  "Creature", "Instant", "Sorcery", "Enchantment", "Artifact", "Planeswalker", "Land",
];
const RARITIES: Array<{ id: Rarity; label: string }> = [
  { id: "common",   label: "C" },
  { id: "uncommon", label: "U" },
  { id: "rare",     label: "R" },
  { id: "mythic",   label: "M" },
];

/** Scryfall's official mana-symbol SVGs — served from their CDN, no cost to us. */
const SYMBOL_URL = (c: Color) => `https://svgs.scryfall.io/card-symbols/${c}.svg`;

const COLOR_LABEL: Record<Color, string> = {
  W: "White", U: "Blue", B: "Black", R: "Red", G: "Green", C: "Colorless",
};

// ---------- Query builder ----------

/**
 * Combine the user's typed query with filter state into a Scryfall query.
 * Filters are AND-combined with the typed text (Scryfall AND is implicit).
 */
export function buildScryfallQuery(typed: string, f: SearchFiltersState): string {
  const parts: string[] = [];
  const text = typed.trim();
  if (text) parts.push(text);

  if (f.colors.length > 0) {
    const letters = f.colors.map((c) => c.toLowerCase()).join("");
    const op = f.colorMode === "exactly" ? "=" : f.colorMode === "atMost" ? "<=" : ":";
    parts.push(`c${op}${letters}`);
  }

  if (f.types.length > 0) {
    const clauses = f.types.map((t) => `t:${t.toLowerCase()}`);
    parts.push(clauses.length > 1 ? `(${clauses.join(" or ")})` : clauses[0]);
  }

  // Subtype input — one t: clause per whitespace-separated token so a user can
  // narrow to intersections like "Human Warrior". Multi-word subtypes are
  // supported by wrapping the whole input in quotes: e.g. `"eldrazi drone"`.
  const subtype = f.subtype.trim();
  if (subtype) {
    const hasQuotes = /^".*"$/.test(subtype);
    if (hasQuotes) {
      parts.push(`t:${subtype.toLowerCase()}`);
    } else {
      const tokens = subtype.split(/\s+/).filter(Boolean);
      for (const tok of tokens) parts.push(`t:${tok.toLowerCase()}`);
    }
  }

  const min = f.cmcMin.trim();
  const max = f.cmcMax.trim();
  if (min && /^\d+$/.test(min)) parts.push(`cmc>=${min}`);
  if (max && /^\d+$/.test(max)) parts.push(`cmc<=${max}`);

  const oracle = f.oracle.trim();
  if (oracle) {
    // Escape any embedded double-quotes so Scryfall doesn't choke on our syntax.
    const safe = oracle.replace(/"/g, '\\"');
    parts.push(`o:"${safe}"`);
  }

  // Only include rarity clauses if the user has partially narrowed down.
  // Selecting all four is equivalent to no filter.
  if (f.rarities.length > 0 && f.rarities.length < 4) {
    const clauses = f.rarities.map((r) => `r:${r}`);
    parts.push(clauses.length > 1 ? `(${clauses.join(" or ")})` : clauses[0]);
  }

  return parts.join(" ");
}

// ---------- Component ----------

type Props = {
  value: SearchFiltersState;
  onChange: (next: SearchFiltersState) => void;
  onReset: () => void;
};

function toggle<T>(arr: T[], item: T): T[] {
  return arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];
}

export default function SearchFilters({ value, onChange, onReset }: Props) {
  const set = <K extends keyof SearchFiltersState>(key: K, v: SearchFiltersState[K]) =>
    onChange({ ...value, [key]: v });

  const hasAny =
    value.colors.length > 0 ||
    value.types.length > 0 ||
    value.subtype.trim() !== "" ||
    value.cmcMin.trim() !== "" ||
    value.cmcMax.trim() !== "" ||
    value.oracle.trim() !== "" ||
    value.rarities.length > 0;

  return (
    <div className="space-y-2">
      {/* Row 1: colors + mode + reset */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
          Colors
        </span>
        {COLORS.map((c) => {
          const active = value.colors.includes(c);
          return (
            <button
              key={c}
              type="button"
              onClick={() => set("colors", toggle(value.colors, c))}
              className={[
                "h-6 w-6 rounded-full transition-all",
                active
                  ? "ring-2 ring-offset-1 ring-offset-bg-surface ring-accent"
                  : "opacity-40 hover:opacity-80",
              ].join(" ")}
              title={COLOR_LABEL[c]}
              aria-pressed={active}
            >
              <img
                src={SYMBOL_URL(c)}
                alt={COLOR_LABEL[c]}
                className="w-full h-full block"
                draggable={false}
              />
            </button>
          );
        })}

        <select
          value={value.colorMode}
          onChange={(e) => set("colorMode", e.target.value as ColorMode)}
          className="appearance-none bg-bg-base border border-border-subtle rounded-md pl-2 pr-6 py-1 text-xs text-text-primary focus:outline-none focus:border-accent transition-colors"
          title="Color match mode"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%237A6E8F' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>\")",
            backgroundRepeat: "no-repeat",
            backgroundPosition: "right 6px center",
          }}
        >
          <option value="includes">Includes</option>
          <option value="exactly">Exactly</option>
          <option value="atMost">At most</option>
        </select>

        {hasAny && (
          <button
            type="button"
            onClick={onReset}
            className="ml-auto text-xs text-text-muted hover:text-text-primary transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Row 2: types */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mr-1">
          Types
        </span>
        {TYPES.map((t) => {
          const active = value.types.includes(t);
          return (
            <button
              key={t}
              type="button"
              onClick={() => set("types", toggle(value.types, t))}
              className={[
                "px-2 py-1 rounded-md text-xs font-medium border transition-colors",
                active
                  ? "bg-accent/20 border-accent text-text-primary"
                  : "bg-bg-base border-border-subtle text-text-muted hover:text-text-primary hover:border-border-strong",
              ].join(" ")}
              aria-pressed={active}
            >
              {t}
            </button>
          );
        })}
      </div>

      {/* Advanced toggle */}
      <button
        type="button"
        onClick={() => set("showAdvanced", !value.showAdvanced)}
        className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors"
      >
        {value.showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        Advanced filters
      </button>

      {value.showAdvanced && (
        <div className="grid gap-3 pt-2 pb-1 border-t border-border-subtle" style={{ gridTemplateColumns: "1fr 1fr" }}>
          {/* CMC range */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-1">
              Mana value
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={20}
                value={value.cmcMin}
                onChange={(e) => set("cmcMin", e.target.value)}
                placeholder="min"
                className="w-16 bg-bg-base border border-border-subtle rounded-md px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent transition-colors"
              />
              <span className="text-xs text-text-muted">to</span>
              <input
                type="number"
                min={0}
                max={20}
                value={value.cmcMax}
                onChange={(e) => set("cmcMax", e.target.value)}
                placeholder="max"
                className="w-16 bg-bg-base border border-border-subtle rounded-md px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent transition-colors"
              />
            </div>
          </div>

          {/* Rarity */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-1">
              Rarity
            </div>
            <div className="flex items-center gap-1">
              {RARITIES.map(({ id, label }) => {
                const active = value.rarities.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => set("rarities", toggle(value.rarities, id))}
                    className={[
                      "w-7 h-7 rounded-md text-xs font-semibold border transition-colors",
                      active
                        ? "bg-accent/20 border-accent text-text-primary"
                        : "bg-bg-base border-border-subtle text-text-muted hover:text-text-primary hover:border-border-strong",
                    ].join(" ")}
                    title={id[0].toUpperCase() + id.slice(1)}
                    aria-pressed={active}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Subtype — full-width row */}
          <div className="col-span-2">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-1">
              Subtype
            </div>
            <input
              type="text"
              value={value.subtype}
              onChange={(e) => set("subtype", e.target.value)}
              placeholder='e.g. Elemental, or "Human Warrior" for both'
              className="w-full bg-bg-base border border-border-subtle rounded-md px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors"
            />
          </div>

          {/* Oracle text — full-width row */}
          <div className="col-span-2">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-1">
              Oracle text contains
            </div>
            <input
              type="text"
              value={value.oracle}
              onChange={(e) => set("oracle", e.target.value)}
              placeholder='e.g. "draw a card"'
              className="w-full bg-bg-base border border-border-subtle rounded-md px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors"
            />
          </div>
        </div>
      )}
    </div>
  );
}
