import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  MOCK_BUDDIES,
  MOCK_CONVERSATIONS,
  type Buddy,
  type ChatMessage,
} from "./buddies";

/**
 * Runtime state for the buddy-chat system: which chat windows are open,
 * whether each is minimized to the dock, the position of each floating
 * window (persisted to localStorage so windows reappear where the user
 * last dragged them), plus per-buddy message logs and unread counts.
 *
 * No backend — messages are all in-memory for the session. The
 * `simulateIncoming` action lets us demo what an incoming message
 * looks like without actually receiving one.
 */

export type ChatWindowState = {
  buddyId: string;
  messages: ChatMessage[];
  /** True when the window is docked (icon only) rather than shown as
   *  a floating window. */
  minimized: boolean;
  /** Number of unread messages received while the window was minimized
   *  or wasn't in the dock yet. Cleared when the window is opened. */
  unread: number;
};

type Position = { x: number; y: number };

type BuddyChatContextValue = {
  /** Chats the viewer has interacted with (open or minimized). Includes
   *  chats auto-added via incoming messages. */
  openChats: ChatWindowState[];
  /** Per-buddy floating-window positions in viewport coords. Null =
   *  hasn't been placed yet (dock into default spot). */
  positions: Record<string, Position | undefined>;
  openChat: (buddyId: string) => void;
  closeChat: (buddyId: string) => void;
  minimizeChat: (buddyId: string) => void;
  sendMessage: (buddyId: string, text: string) => void;
  setPosition: (buddyId: string, pos: Position) => void;
  /** Simulate an incoming message from a buddy — adds the message to
   *  their chat log, opens the chat in the dock (minimized) if not
   *  already there, and bumps the unread count. */
  simulateIncoming: (buddyId: string, text?: string) => void;
};

const BuddyChatContext = createContext<BuddyChatContextValue | null>(null);

const POSITIONS_STORAGE_KEY = "webatrice.buddyChatPositions";
const OPEN_CHATS_STORAGE_KEY = "webatrice.buddyChatOpen";

function readStoredPositions(): Record<string, Position> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(POSITIONS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // ignore
  }
  return {};
}

function writeStoredPositions(positions: Record<string, Position>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      POSITIONS_STORAGE_KEY,
      JSON.stringify(positions),
    );
  } catch {
    // ignore quota / disabled storage
  }
}

function readStoredOpenChats(): ChatWindowState[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(OPEN_CHATS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (c): c is ChatWindowState =>
          c &&
          typeof c.buddyId === "string" &&
          Array.isArray(c.messages) &&
          typeof c.minimized === "boolean" &&
          typeof c.unread === "number",
      )
      .map((c) => ({
        buddyId: c.buddyId,
        messages: c.messages,
        minimized: c.minimized,
        unread: c.unread,
      }));
  } catch {
    // ignore
  }
  return [];
}

function writeStoredOpenChats(chats: ChatWindowState[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(OPEN_CHATS_STORAGE_KEY, JSON.stringify(chats));
  } catch {
    // ignore quota / disabled storage
  }
}

/** A canned pool of one-liners used by simulateIncoming when the caller
 *  doesn't supply their own text. Rotating through them keeps the demo
 *  from feeling like a copy-paste. */
const SIMULATED_MESSAGES = [
  "you up?",
  "want to play a game?",
  "check out this deck I just built",
  "gg wp",
  "brb, tea",
  "did you see the new set?",
  "shuffle up!",
  "one more?",
];

export function BuddyChatProvider({ children }: { children: ReactNode }) {
  const [openChats, setOpenChats] = useState<ChatWindowState[]>(() =>
    readStoredOpenChats(),
  );
  const [positions, setPositions] = useState<Record<string, Position>>(() =>
    readStoredPositions(),
  );

  // Debounced persistence of positions — writes 500ms after the last
  // update rather than on every drag frame.
  const positionsRef = useRef(positions);
  useEffect(() => {
    positionsRef.current = positions;
  }, [positions]);
  useEffect(() => {
    const t = window.setTimeout(() => {
      writeStoredPositions(positionsRef.current);
    }, 500);
    return () => window.clearTimeout(t);
  }, [positions]);

  // Persist open chats so they survive full page reloads. Debounced so
  // rapid message bursts don't hammer localStorage.
  const openChatsRef = useRef(openChats);
  useEffect(() => {
    openChatsRef.current = openChats;
  }, [openChats]);
  useEffect(() => {
    const t = window.setTimeout(() => {
      writeStoredOpenChats(openChatsRef.current);
    }, 300);
    return () => window.clearTimeout(t);
  }, [openChats]);

  const upsertChat = useCallback(
    (buddyId: string, patch: Partial<ChatWindowState>) => {
      setOpenChats((prev) => {
        const existingIdx = prev.findIndex((c) => c.buddyId === buddyId);
        if (existingIdx >= 0) {
          const next = prev.slice();
          next[existingIdx] = { ...next[existingIdx], ...patch };
          return next;
        }
        // New chat — seed messages from mock conversation history
        return [
          ...prev,
          {
            buddyId,
            messages: MOCK_CONVERSATIONS[buddyId] ?? [],
            minimized: false,
            unread: 0,
            ...patch,
          },
        ];
      });
    },
    [],
  );

  const openChat = useCallback(
    (buddyId: string) => {
      upsertChat(buddyId, { minimized: false, unread: 0 });
    },
    [upsertChat],
  );

  const closeChat = useCallback((buddyId: string) => {
    setOpenChats((prev) => prev.filter((c) => c.buddyId !== buddyId));
  }, []);

  const minimizeChat = useCallback(
    (buddyId: string) => {
      upsertChat(buddyId, { minimized: true });
    },
    [upsertChat],
  );

  const sendMessage = useCallback((buddyId: string, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setOpenChats((prev) =>
      prev.map((c) =>
        c.buddyId === buddyId
          ? {
              ...c,
              messages: [
                ...c.messages,
                {
                  id: `local-${Date.now()}`,
                  senderId: "me",
                  text: trimmed,
                  sentAt: Date.now(),
                },
              ],
            }
          : c,
      ),
    );
  }, []);

  const setPosition = useCallback((buddyId: string, pos: Position) => {
    setPositions((prev) => ({ ...prev, [buddyId]: pos }));
  }, []);

  const simulateIncoming = useCallback(
    (buddyId: string, text?: string) => {
      const message: ChatMessage = {
        id: `sim-${Date.now()}`,
        senderId: buddyId,
        text:
          text ??
          SIMULATED_MESSAGES[
            Math.floor(Math.random() * SIMULATED_MESSAGES.length)
          ],
        sentAt: Date.now(),
      };
      setOpenChats((prev) => {
        const existingIdx = prev.findIndex((c) => c.buddyId === buddyId);
        if (existingIdx >= 0) {
          const next = prev.slice();
          const existing = next[existingIdx];
          next[existingIdx] = {
            ...existing,
            messages: [...existing.messages, message],
            unread: existing.minimized
              ? existing.unread + 1
              : existing.unread,
          };
          return next;
        }
        // Chat wasn't open — add it minimized with unread=1 so the
        // dock icon shows the notification badge.
        return [
          ...prev,
          {
            buddyId,
            messages: [...(MOCK_CONVERSATIONS[buddyId] ?? []), message],
            minimized: true,
            unread: 1,
          },
        ];
      });
    },
    [],
  );

  const value = useMemo<BuddyChatContextValue>(
    () => ({
      openChats,
      positions,
      openChat,
      closeChat,
      minimizeChat,
      sendMessage,
      setPosition,
      simulateIncoming,
    }),
    [
      openChats,
      positions,
      openChat,
      closeChat,
      minimizeChat,
      sendMessage,
      setPosition,
      simulateIncoming,
    ],
  );

  return (
    <BuddyChatContext.Provider value={value}>
      {children}
    </BuddyChatContext.Provider>
  );
}

export function useBuddyChat(): BuddyChatContextValue {
  const ctx = useContext(BuddyChatContext);
  if (!ctx) {
    // Safety fallback so components outside the provider don't crash
    // during hot reload or storybook.
    return {
      openChats: [],
      positions: {},
      openChat: () => {},
      closeChat: () => {},
      minimizeChat: () => {},
      sendMessage: () => {},
      setPosition: () => {},
      simulateIncoming: () => {},
    };
  }
  return ctx;
}

/** Convenience lookup: buddy id → Buddy record from the mock roster. */
export function useBuddy(buddyId: string): Buddy | undefined {
  return MOCK_BUDDIES.find((b) => b.id === buddyId);
}
