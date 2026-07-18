import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Card-scale multiplier. Everything sized by a card (cards themselves,
 * library/graveyard/exile boxes, commander stack, battlefield grid) scales
 * with this value. Non-card UI — mana pips, life total, card preview,
 * tabs, header — is unaffected.
 *
 * Range: 1.0 (default) to 2.0 (max). Slider hits 2x per the spec.
 * Persisted to localStorage so the user's choice sticks across reloads.
 */
export const CARD_SCALE_MIN = 1;
export const CARD_SCALE_MAX = 1.1;
export const CARD_SCALE_DEFAULT = 1;
const STORAGE_KEY = "webatrice.cardScale";

type CardScaleContextValue = {
  scale: number;
  setScale: (n: number) => void;
};

const CardScaleContext = createContext<CardScaleContextValue>({
  scale: CARD_SCALE_DEFAULT,
  setScale: () => {},
});

function clampScale(n: number): number {
  if (!Number.isFinite(n)) return CARD_SCALE_DEFAULT;
  return Math.min(CARD_SCALE_MAX, Math.max(CARD_SCALE_MIN, n));
}

function readStoredScale(): number {
  if (typeof window === "undefined") return CARD_SCALE_DEFAULT;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw == null) return CARD_SCALE_DEFAULT;
  const parsed = parseFloat(raw);
  return clampScale(parsed);
}

export function CardScaleProvider({ children }: { children: ReactNode }) {
  const [scale, setScaleState] = useState<number>(readStoredScale);

  const setScale = (n: number) => {
    const clamped = clampScale(n);
    setScaleState(clamped);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, String(clamped));
    }
  };

  const value = useMemo(() => ({ scale, setScale }), [scale]);

  return (
    <CardScaleContext.Provider value={value}>
      {children}
    </CardScaleContext.Provider>
  );
}

export function useCardScale(): CardScaleContextValue {
  return useContext(CardScaleContext);
}

/**
 * Convenience: the CSS-variable style object to apply at the game-area
 * root. Every card-sized element in the game view reads these variables
 * (via cardSize.ts constants) so a single React state update reflows the
 * entire card-based layout.
 */
export function useCardScaleStyle(): React.CSSProperties {
  const { scale } = useCardScale();
  return useMemo(
    () =>
      ({
        "--card-width": `${5 * scale}rem`,
        "--card-height": `${7 * scale}rem`,
        "--card-gap-px": `${20 * scale}px`,
        "--card-stack-offset-px": `${15 * scale}px`,
      }) as React.CSSProperties,
    [scale],
  );
}
