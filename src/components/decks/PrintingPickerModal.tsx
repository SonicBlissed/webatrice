import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cardImage, fetchAllPrintings, type ScryfallCard } from "@/lib/scryfall";

export type PrintingPickerRequest = {
  oracleId: string;
  name: string;
  /** If set, that printing gets a "current" badge so the user sees which is in the deck. */
  currentScryfallId?: string;
};

type Props = {
  request: PrintingPickerRequest | null;
  onClose: () => void;
  onPick: (card: ScryfallCard) => void;
};

export default function PrintingPickerModal({ request, onClose, onPick }: Props) {
  const [printings, setPrintings] = useState<ScryfallCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!request) return;
    setPrintings([]);
    setError(null);
    setLoading(true);
    const controller = new AbortController();
    fetchAllPrintings(request.oracleId, controller.signal)
      .then((data) => {
        setPrintings(data);
        setLoading(false);
      })
      .catch((e) => {
        if ((e as { name?: string }).name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Failed to fetch printings");
        setLoading(false);
      });
    return () => controller.abort();
  }, [request?.oracleId]);

  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [request, onClose]);

  if (!request) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative w-full max-w-5xl rounded-xl bg-bg-surface border border-border-subtle shadow-glow p-6 max-h-[calc(100vh-2rem)] overflow-hidden flex flex-col">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors"
          aria-label="Close"
        >
          <X size={18} />
        </button>

        <div>
          <h2 className="font-modern text-xl font-semibold text-text-primary truncate">
            Choose printing
          </h2>
          <p className="text-sm text-text-muted mt-1">
            {request.name}
            {!loading && printings.length > 0 && (
              <span className="ml-2 text-text-muted">
                · {printings.length} printing{printings.length === 1 ? "" : "s"}
              </span>
            )}
          </p>
        </div>

        {loading && (
          <div className="flex-1 flex items-center justify-center py-16 text-text-muted text-sm">
            <Loader2 size={18} className="animate-spin mr-2 text-accent" /> Loading printings…
          </div>
        )}

        {error && (
          <div className="mt-4 flex items-start gap-2 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {!loading && !error && printings.length === 0 && (
          <div className="flex-1 flex items-center justify-center py-16 text-text-muted text-sm">
            No printings found.
          </div>
        )}

        {!loading && !error && printings.length > 0 && (
          <div className="mt-4 flex-1 overflow-y-auto pr-1">
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}
            >
              {printings.map((p) => {
                const img = cardImage(p, "normal");
                const isCurrent = p.id === request.currentScryfallId;
                return (
                  <button
                    key={p.id}
                    onClick={() => onPick(p)}
                    className={[
                      "rounded-lg overflow-hidden border transition-all group relative bg-bg-base",
                      isCurrent
                        ? "border-accent ring-2 ring-accent/50"
                        : "border-border-subtle hover:border-accent hover:shadow-glow",
                    ].join(" ")}
                    title={`${p.set?.toUpperCase() ?? "?"} · ${p.name}`}
                  >
                    <div className="aspect-[5/7] w-full">
                      {img ? (
                        <img
                          src={img}
                          alt={`${p.name} (${p.set})`}
                          className="w-full h-full object-cover"
                          loading="lazy"
                          draggable={false}
                        />
                      ) : (
                        <div className="h-full flex items-center justify-center text-xs text-text-muted p-2 text-center">
                          {p.name}
                        </div>
                      )}
                    </div>
                    <div className="px-2 py-1.5 text-xs flex items-center justify-between gap-1 border-t border-border-subtle bg-bg-surface">
                      <span className="font-medium text-text-primary uppercase tracking-wider truncate">
                        {p.set}
                      </span>
                      <span
                        className={[
                          "tabular-nums shrink-0",
                          p.prices?.usd ? "text-emerald-300 font-medium" : "text-text-muted",
                        ].join(" ")}
                        title={p.prices?.usd ? "TCGplayer USD" : "No TCGplayer price"}
                      >
                        {p.prices?.usd ? `$${p.prices.usd}` : "—"}
                      </span>
                      <span className="text-text-muted tabular-nums shrink-0">
                        #{p.collector_number}
                      </span>
                    </div>
                    {isCurrent && (
                      <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded bg-accent text-white text-[10px] font-semibold shadow-glow">
                        <CheckCircle2 size={10} /> Current
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
