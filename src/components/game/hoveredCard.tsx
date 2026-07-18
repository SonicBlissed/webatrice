import { createContext, useContext, useState, type ReactNode } from "react";

/**
 * Tracks the most recently hovered card across the battlefield so the
 * right-rail preview can show it. Card components set it on mouse enter,
 * consumers (like BattlefieldSidebar) read it to render a large preview.
 *
 * We track the scryfall id (not just the name) so the preview shows the
 * exact printing the deck chose, not Scryfall's default printing for that
 * card name.
 */
export type HoveredCard = {
  name: string;
  scryfallId?: string;
};

type HoveredCardContextValue = {
  hoveredCard: HoveredCard | null;
  setHoveredCard: (card: HoveredCard | null) => void;
};

const HoveredCardContext = createContext<HoveredCardContextValue | null>(null);

export function HoveredCardProvider({ children }: { children: ReactNode }) {
  const [hoveredCard, setHoveredCard] = useState<HoveredCard | null>(null);
  return (
    <HoveredCardContext.Provider value={{ hoveredCard, setHoveredCard }}>
      {children}
    </HoveredCardContext.Provider>
  );
}

/**
 * Read/write the hovered card. Returns a no-op setter when called outside the
 * provider so isolated component previews don't crash.
 */
export function useHoveredCard(): HoveredCardContextValue {
  return (
    useContext(HoveredCardContext) ?? {
      hoveredCard: null,
      setHoveredCard: () => {},
    }
  );
}
