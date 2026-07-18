import { User, Crown, Eye, MessageSquare, Zap, LogOut } from "lucide-react";
import { BRACKET_TONE } from "@/components/rooms/CreateRoomModal";
import type { RoomMemberWithProfile } from "@/lib/rooms";
import { useHoveredCard } from "./hoveredCard";
import { CARD_CORNER_RADIUS } from "./cardSize";

/**
 * Right-rail companion for the battlefield. Three stacked sections, top-down:
 *   1. Card preview — shows the most recently hovered card (placeholder for now)
 *   2. Player list — every seat, spectators flagged
 *   3. Chat / game log — non-functional in this iteration; just the frame
 */

type Props = {
  members: RoomMemberWithProfile[];
  onLeave: () => void;
  leaving: boolean;
};

function PlayerRow({ m }: { m: RoomMemberWithProfile }) {
  const name = m.profile?.display_name ?? m.profile?.username ?? "Unknown";
  const bracket = m.selected_bracket as 2 | 3 | 4 | null;
  const tone = bracket ? BRACKET_TONE[bracket] : null;
  const isSpectator = !m.is_playing;

  return (
    <li className="flex items-center gap-2 px-3 py-2 hover:bg-bg-elevated transition-colors">
      {m.profile?.avatar_url ? (
        <img
          src={m.profile.avatar_url}
          alt=""
          className="h-7 w-7 rounded-full border border-border-strong"
        />
      ) : (
        <div className="h-7 w-7 rounded-full bg-gradient-to-br from-accent-secondary to-accent flex items-center justify-center">
          <User size={12} className="text-white" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span className={`text-sm font-medium truncate ${isSpectator ? "text-text-muted" : "text-text-primary"}`}>
            {name}
          </span>
          {m.seat === "host" && (
            <Crown size={11} className="text-yellow-400 shrink-0" aria-label="Host" />
          )}
        </div>
        {isSpectator ? (
          <div className="text-[10px] text-text-muted inline-flex items-center gap-1">
            <Eye size={10} /> Spectator
          </div>
        ) : (
          <div className="text-[10px] text-text-muted truncate">
            {m.profile?.role === "admin"
              ? "Admin"
              : m.profile?.role === "mod"
              ? "Moderator"
              : "Member"}
          </div>
        )}
      </div>
      {!isSpectator && bracket && tone && (
        <span
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border shrink-0 ${tone.bg} ${tone.text} ${tone.border}`}
          title={`Bracket ${bracket}`}
        >
          <Zap size={9} /> B{bracket}
        </span>
      )}
    </li>
  );
}

export default function BattlefieldSidebar({ members, onLeave, leaving }: Props) {
  const { hoveredCard } = useHoveredCard();
  const hoveredImageUrl = hoveredCard
    ? hoveredCard.scryfallId
      ? `https://api.scryfall.com/cards/${hoveredCard.scryfallId}?format=image&version=png`
      : `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(hoveredCard.name)}&format=image&version=png`
    : null;

  return (
    <aside className="w-72 shrink-0 border-l border-border-subtle bg-bg-surface flex flex-col min-h-0">
      {/* Card preview */}
      <div className="p-3 border-b border-border-subtle">
        {hoveredImageUrl ? (
          <img
            src={hoveredImageUrl}
            alt={hoveredCard?.name ?? ""}
            draggable={false}
            className="w-full shadow-md"
            style={{
              aspectRatio: "5 / 7",
              borderRadius: CARD_CORNER_RADIUS,
              imageRendering: "-webkit-optimize-contrast",
            }}
          />
        ) : (
          <div className="aspect-[5/7] rounded-md border border-dashed border-border-subtle bg-bg-base/30 flex items-center justify-center text-xs text-text-muted italic p-3 text-center">
            Hover a card to preview it here
          </div>
        )}
      </div>

      {/* Player list */}
      <div className="border-b border-border-subtle">
        <div className="px-3 py-2 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-text-muted">
            Players
          </span>
          <button
            onClick={onLeave}
            disabled={leaving}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-text-primary bg-bg-elevated hover:bg-border-subtle border border-border-subtle disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            title="Leave the room"
          >
            <LogOut size={12} /> {leaving ? "Leaving…" : "Leave"}
          </button>
        </div>
        <ul className="pb-1">
          {members.map((m) => (
            <PlayerRow key={m.user_id} m={m} />
          ))}
        </ul>
      </div>

      {/* Chat / game log (placeholder) */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="px-3 py-2 text-[10px] uppercase tracking-widest text-text-muted flex items-center gap-1">
          <MessageSquare size={11} /> Chat & log
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 text-xs text-text-muted italic">
          Chat and game log will land in a later iteration.
        </div>
        <div className="p-2 border-t border-border-subtle">
          <input
            type="text"
            disabled
            placeholder="Chat is not enabled yet"
            className="w-full bg-bg-base border border-border-subtle rounded-md px-3 py-1.5 text-xs text-text-muted placeholder:text-text-muted cursor-not-allowed"
          />
        </div>
      </div>
    </aside>
  );
}
