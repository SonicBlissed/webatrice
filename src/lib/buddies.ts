/**
 * Static mock data for the social features (buddy list + buddy chat).
 * Real data + backend wiring lands in a later slice; keeping the data
 * shape here now so the UI can be built against something realistic.
 */

export type PresenceStatus = "in-game" | "idle" | "online" | "offline";
export type PlayerRole = "admin" | "mod" | "user";

export type Buddy = {
  id: string;
  name: string;
  status: PresenceStatus;
  role: PlayerRole;
  /** Short activity string shown under the name (deck they're playing,
   *  "in a pod", etc.). Optional. */
  activity?: string;
};

export type ChatMessage = {
  id: string;
  /** Sender id. "me" = the local user; anything else = a buddy id. */
  senderId: string;
  text: string;
  /** Milliseconds since epoch. */
  sentAt: number;
};

const HOUR = 60 * 60 * 1000;
const now = Date.now();

/** A handful of buddies the viewer has added. Some are online, some
 *  offline — the UI groups them by presence but shows all of them. */
export const MOCK_BUDDIES: Buddy[] = [
  {
    id: "b-barry",
    name: "Barry Orrens",
    status: "online",
    role: "user",
    activity: "Casual EDH",
  },
  {
    id: "b-nick",
    name: "Nick Doran",
    status: "in-game",
    role: "user",
    activity: "cEDH pod",
  },
  {
    id: "b-sara",
    name: "Sara Lin",
    status: "online",
    role: "mod",
  },
  {
    id: "b-max",
    name: "Max Whitfield",
    status: "idle",
    role: "user",
  },
  {
    id: "b-lila",
    name: "Lila Chen",
    status: "offline",
    role: "user",
  },
];

/** Seed conversations so open-a-chat has some history to render. Each
 *  entry is keyed by buddy id. */
export const MOCK_CONVERSATIONS: Record<string, ChatMessage[]> = {
  "b-barry": [
    {
      id: "m1",
      senderId: "b-barry",
      text: "When do you want to play?",
      sentAt: now - 2 * HOUR - 5 * 60 * 1000,
    },
    {
      id: "m2",
      senderId: "me",
      text: "Not tonight, I have to go to be early.",
      sentAt: now - 2 * HOUR - 3 * 60 * 1000,
    },
    {
      id: "m3",
      senderId: "b-barry",
      text: "Come on one game!",
      sentAt: now - 2 * HOUR - 2 * 60 * 1000,
    },
    {
      id: "m4",
      senderId: "me",
      text: "No",
      sentAt: now - 2 * HOUR - 1 * 60 * 1000,
    },
  ],
  "b-nick": [
    {
      id: "n1",
      senderId: "b-nick",
      text: "gg last night",
      sentAt: now - 12 * HOUR,
    },
  ],
  "b-sara": [],
  "b-max": [],
  "b-lila": [],
};
