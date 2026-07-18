import { useEffect, useRef, useState } from "react";
import { Search, Loader2, CornerDownLeft } from "lucide-react";
import { autocompleteCards, findCardByName, type ScryfallCard } from "@/lib/scryfall";

/**
 * Compact top-bar search that autocompletes card names as the user types.
 * Clicking a suggestion adds that card immediately (`onQuickAdd`). Pressing
 * Enter without a selection hands the query off to the caller (`onSubmit`)
 * so the caller can switch to the full Search view and pre-fill it.
 *
 * The autocomplete endpoint returns just names; we look the card up on-add
 * via `/cards/named?exact=` to get a full ScryfallCard payload for the
 * existing addCardToDeck flow.
 */

type Props = {
  onQuickAdd: (card: ScryfallCard) => Promise<void> | void;
  onSubmit: (query: string) => void;
  disabled?: boolean;
};

export default function QuickAddSearch({ onQuickAdd, onSubmit, disabled }: Props) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [loadingSug, setLoadingSug] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<number>(-1);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced autocomplete
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setHighlight(-1);
      return;
    }
    const controller = new AbortController();
    setLoadingSug(true);
    const t = setTimeout(async () => {
      try {
        const names = await autocompleteCards(q, controller.signal);
        setSuggestions(names);
        setHighlight(-1);
      } catch (e) {
        if ((e as { name?: string }).name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Autocomplete failed");
      } finally {
        setLoadingSug(false);
      }
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(t);
    };
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const pickAndAdd = async (name: string) => {
    setAdding(name);
    setError(null);
    try {
      const card = await findCardByName(name);
      if (!card) {
        setError(`No card named "${name}"`);
        return;
      }
      await onQuickAdd(card);
      setQuery("");
      setSuggestions([]);
      setOpen(false);
      inputRef.current?.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Add failed");
    } finally {
      setAdding(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const q = query.trim();
      if (!q) return;
      if (highlight >= 0 && suggestions[highlight]) {
        void pickAndAdd(suggestions[highlight]);
      } else {
        // No highlighted suggestion → hand off to the full search view
        onSubmit(q);
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapperRef} className="relative w-72">
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setError(null);
          }}
          onFocus={() => query.trim().length >= 2 && setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Quick add — type a card name"
          className="w-full bg-bg-base border border-border-subtle rounded-md pl-8 pr-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
        />
        {loadingSug && (
          <Loader2 size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-text-muted" />
        )}
      </div>

      {open && (suggestions.length > 0 || error) && (
        <div className="absolute z-40 top-full right-0 mt-1 w-[320px] rounded-lg bg-bg-surface border border-border-subtle shadow-glow py-1 max-h-72 overflow-y-auto">
          {error && (
            <div className="px-3 py-2 text-xs text-red-300">{error}</div>
          )}
          {suggestions.map((name, i) => (
            <button
              key={name}
              onClick={() => void pickAndAdd(name)}
              onMouseEnter={() => setHighlight(i)}
              disabled={adding !== null}
              className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
                highlight === i
                  ? "bg-bg-elevated text-text-primary"
                  : "text-text-secondary hover:bg-bg-elevated hover:text-text-primary"
              }`}
            >
              {adding === name ? (
                <Loader2 size={12} className="animate-spin shrink-0" />
              ) : (
                <span className="w-3 shrink-0" />
              )}
              <span className="flex-1 truncate">{name}</span>
            </button>
          ))}
          {!error && suggestions.length > 0 && (
            <div className="border-t border-border-subtle mt-1 px-3 py-1.5 text-[10px] text-text-muted flex items-center gap-1.5">
              <CornerDownLeft size={10} /> Enter — open in Search view
            </div>
          )}
        </div>
      )}
    </div>
  );
}
