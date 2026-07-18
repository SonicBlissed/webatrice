import { useEffect, useRef } from "react";
import { Send, Hash, ChevronUp } from "lucide-react";

type ChatMessage = {
  id: string;
  author: string;
  role?: "admin" | "mod";
  time: string;
  body: string;
  system?: boolean;
};

const MOCK_MESSAGES: ChatMessage[] = [
  { id: "1", author: "system", time: "8:12 PM", body: "Alice created room “Casual EDH — no combo pls”", system: true },
  { id: "2", author: "Bob", time: "8:14 PM", body: "anyone up for a cEDH pod? 4 seats open" },
  { id: "3", author: "Charlie", role: "mod", time: "8:15 PM", body: "reminder: no proxies in tournament rooms" },
  { id: "4", author: "Diana", time: "8:16 PM", body: "goldfishing modern burn, anyone want to spar?" },
  { id: "5", author: "Evan", time: "8:18 PM", body: "pauper league starts sunday — get your decks in" },
  { id: "6", author: "system", time: "8:19 PM", body: "Fiona joined the lobby" },
  { id: "7", author: "Fiona", time: "8:19 PM", body: "hey all!" },
  { id: "8", author: "Alice", role: "admin", time: "8:20 PM", body: "welcome :)" },
];

export default function ChatPanel() {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  return (
    <section className="flex flex-col h-full bg-bg-surface border-t border-border-subtle">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border-subtle">
        <Hash size={14} className="text-text-muted" />
        <span className="text-sm font-semibold text-text-primary">lobby</span>
        <span className="text-xs text-text-muted">· global chat</span>
        <button className="ml-auto p-1 text-text-muted hover:text-text-primary transition-colors" title="Collapse">
          <ChevronUp size={16} />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-2 space-y-1.5">
        {MOCK_MESSAGES.map((m) => (
          <div key={m.id} className="text-sm leading-snug">
            {m.system ? (
              <div className="text-xs italic text-text-muted">
                <span className="text-text-muted/60 mr-2">{m.time}</span>
                {m.body}
              </div>
            ) : (
              <div>
                <span className="text-text-muted/70 text-xs mr-2 tabular-nums">{m.time}</span>
                <span
                  className={`font-semibold mr-2 ${
                    m.role === "admin" ? "text-yellow-400"
                    : m.role === "mod" ? "text-accent"
                    : "text-text-primary"
                  }`}
                >
                  {m.author}
                </span>
                <span className="text-text-secondary">{m.body}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      <form
        className="flex items-center gap-2 px-4 py-3 border-t border-border-subtle"
        onSubmit={(e) => e.preventDefault()}
      >
        <input
          type="text"
          placeholder="Message #lobby"
          className="flex-1 bg-bg-base border border-border-subtle rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
        />
        <button
          type="submit"
          className="p-2 rounded-md bg-accent hover:bg-accent-hover text-white transition-colors"
          title="Send"
        >
          <Send size={16} />
        </button>
      </form>
    </section>
  );
}
