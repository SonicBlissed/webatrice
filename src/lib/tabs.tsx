import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type TabType = "lobby" | "my-decks" | "deck" | "game" | "profile";

export type Tab = {
  id: string;
  type: TabType;
  title: string;
  closeable: boolean;
  // Free-form payload for the tab's content (e.g. deckId, roomId).
  data?: Record<string, unknown>;
};

type TabsContextValue = {
  tabs: Tab[];
  activeTabId: string;
  activate: (id: string) => void;
  close: (id: string) => void;
  /**
   * Open a tab by id. If a tab with that id already exists, focus it and
   * leave its state alone. Otherwise create and activate a new one.
   */
  openOrFocus: (tab: Omit<Tab, "closeable"> & { closeable?: boolean }) => void;
  /**
   * Add a tab without changing the active tab. Used by session restoration
   * (e.g. TabSessionRestore) so restored tabs don't yank the user's focus
   * away from the tab they had active before refresh.
   */
  restore: (tab: Omit<Tab, "closeable"> & { closeable?: boolean }) => void;
};

const LOBBY_TAB: Tab = {
  id: "lobby",
  type: "lobby",
  title: "Lobby",
  closeable: false,
};

/**
 * Tabs live in `sessionStorage`, not localStorage, so they survive a refresh
 * (or accidental navigation) but vanish when the browser tab is closed.
 * That matches "browser tab" semantics: closing the page means gone.
 */
const STORAGE_KEY = "webatrice:tabs";

const VALID_TAB_TYPES: TabType[] = ["lobby", "my-decks", "deck", "game", "profile"];

type Persisted = { tabs: Tab[]; activeTabId: string };

function loadPersisted(): Persisted {
  const fallback: Persisted = { tabs: [LOBBY_TAB], activeTabId: LOBBY_TAB.id };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Persisted> | null;
    if (!parsed || !Array.isArray(parsed.tabs)) return fallback;

    // Validate each tab shape; drop anything that looks off (schema drift, etc.)
    const clean: Tab[] = [];
    for (const t of parsed.tabs) {
      if (
        t &&
        typeof t.id === "string" &&
        typeof t.title === "string" &&
        typeof t.closeable === "boolean" &&
        VALID_TAB_TYPES.includes(t.type as TabType)
      ) {
        clean.push({
          id: t.id,
          title: t.title,
          type: t.type as TabType,
          closeable: t.closeable,
          data: t.data && typeof t.data === "object" ? t.data as Record<string, unknown> : undefined,
        });
      }
    }
    // Guarantee the pinned Lobby tab is present.
    if (!clean.some((t) => t.id === LOBBY_TAB.id)) clean.unshift(LOBBY_TAB);
    const activeTabId =
      typeof parsed.activeTabId === "string" && clean.some((t) => t.id === parsed.activeTabId)
        ? parsed.activeTabId
        : LOBBY_TAB.id;
    return { tabs: clean, activeTabId };
  } catch {
    return fallback;
  }
}

const TabsContext = createContext<TabsContextValue | null>(null);

export function TabsProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useState<Tab[]>(() => loadPersisted().tabs);
  const [activeTabId, setActiveTabId] = useState<string>(() => loadPersisted().activeTabId);

  // Persist tabs + active tab on every change. sessionStorage means these
  // clear on browser/tab close but survive an F5 refresh.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs, activeTabId }));
    } catch {
      // Quota exceeded or storage disabled — non-fatal; the in-memory state
      // is still correct for this session.
    }
  }, [tabs, activeTabId]);

  const activate = useCallback((id: string) => setActiveTabId(id), []);

  const close = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === id);
        if (idx === -1 || !prev[idx].closeable) return prev;
        const next = prev.filter((t) => t.id !== id);
        // If we closed the active tab, focus the neighbor to the left (or right if we closed the first).
        setActiveTabId((current) => {
          if (current !== id) return current;
          const fallback = next[Math.max(0, idx - 1)] ?? next[0];
          return fallback?.id ?? LOBBY_TAB.id;
        });
        return next;
      });
    },
    [],
  );

  const openOrFocus = useCallback<TabsContextValue["openOrFocus"]>((incoming) => {
    setTabs((prev) => {
      if (prev.some((t) => t.id === incoming.id)) return prev;
      return [...prev, { closeable: true, ...incoming }];
    });
    setActiveTabId(incoming.id);
  }, []);

  const restore = useCallback<TabsContextValue["restore"]>((incoming) => {
    setTabs((prev) => {
      if (prev.some((t) => t.id === incoming.id)) return prev;
      return [...prev, { closeable: true, ...incoming }];
    });
    // NB: do not touch activeTabId — this call is for session restoration and
    // must not steal focus from whatever tab the user actually had active.
  }, []);

  const value = useMemo<TabsContextValue>(
    () => ({ tabs, activeTabId, activate, close, openOrFocus, restore }),
    [tabs, activeTabId, activate, close, openOrFocus, restore],
  );

  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
}

export function useTabs() {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("useTabs must be used inside <TabsProvider>");
  return ctx;
}
