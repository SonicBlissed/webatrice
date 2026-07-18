import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X, Copy, Check, Download, FileText, Swords, Package } from "lucide-react";
import type { DeckCard } from "@/lib/decks";

/**
 * Deck exporter. Renders a portal modal with a format picker, a live preview
 * of the exported text, and Copy / Download actions. Formats:
 *   - Plain text  — `1 Card Name` lines grouped by category (universal)
 *   - MTG Arena   — includes set + collector number, headers per zone
 *   - Cockatrice  — .cod XML, main + side zones
 */

type Props = {
  open: boolean;
  onClose: () => void;
  deckName: string;
  cards: DeckCard[];
};

type Format = "plain" | "arena" | "cockatrice";

type FormatDef = {
  id: Format;
  label: string;
  icon: typeof FileText;
  extension: string;
  mime: string;
  description: string;
};

const FORMATS: FormatDef[] = [
  {
    id: "plain",
    label: "Plain text",
    icon: FileText,
    extension: "txt",
    mime: "text/plain",
    description: "Simple list, grouped by section. Works with most tools.",
  },
  {
    id: "arena",
    label: "MTG Arena",
    icon: Swords,
    extension: "txt",
    mime: "text/plain",
    description: "Includes set code + collector number. Works for Arena, Moxfield, Archidekt imports.",
  },
  {
    id: "cockatrice",
    label: "Cockatrice (.cod)",
    icon: Package,
    extension: "cod",
    mime: "application/xml",
    description: "XML deck file for Cockatrice.",
  },
];

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toPlain(cards: DeckCard[]): string {
  const commanders = cards.filter((c) => c.category === "commander");
  const main = cards.filter((c) => c.category === "main");
  const side = cards.filter((c) => c.category === "sideboard");
  const parts: string[] = [];
  if (commanders.length > 0) {
    parts.push("// Commander");
    for (const c of commanders) parts.push(`${c.quantity} ${c.name}`);
  }
  if (main.length > 0) {
    if (parts.length > 0) parts.push("");
    parts.push("// Deck");
    for (const c of main) parts.push(`${c.quantity} ${c.name}`);
  }
  if (side.length > 0) {
    if (parts.length > 0) parts.push("");
    parts.push("// Sideboard");
    for (const c of side) parts.push(`${c.quantity} ${c.name}`);
  }
  return parts.join("\n");
}

function toArena(cards: DeckCard[]): string {
  const line = (c: DeckCard) => {
    const set = c.set ? c.set.toUpperCase() : "";
    const num = c.collector_number ?? "";
    if (set && num) return `${c.quantity} ${c.name} (${set}) ${num}`;
    return `${c.quantity} ${c.name}`;
  };
  const commanders = cards.filter((c) => c.category === "commander");
  const main = cards.filter((c) => c.category === "main");
  const side = cards.filter((c) => c.category === "sideboard");
  const parts: string[] = [];
  if (commanders.length > 0) {
    parts.push("Commander");
    for (const c of commanders) parts.push(line(c));
  }
  if (main.length > 0) {
    if (parts.length > 0) parts.push("");
    parts.push("Deck");
    for (const c of main) parts.push(line(c));
  }
  if (side.length > 0) {
    if (parts.length > 0) parts.push("");
    parts.push("Sideboard");
    for (const c of side) parts.push(line(c));
  }
  return parts.join("\n");
}

function toCockatrice(deckName: string, cards: DeckCard[]): string {
  // Cockatrice's .cod treats commanders as main-zone cards. We mirror that
  // and drop a header comment noting them so a human reader still sees which
  // rows are the commander(s).
  const commanders = cards.filter((c) => c.category === "commander");
  const main = [
    ...commanders,
    ...cards.filter((c) => c.category === "main"),
  ];
  const side = cards.filter((c) => c.category === "sideboard");

  const cardLine = (c: DeckCard) =>
    `    <card number="${c.quantity}" name="${escapeXml(c.name)}"/>`;
  const comment =
    commanders.length > 0
      ? `Commander: ${commanders.map((c) => c.name).join(", ")}`
      : "";

  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<cockatrice_deck version="1">`);
  lines.push(`  <deckname>${escapeXml(deckName)}</deckname>`);
  lines.push(`  <comments>${escapeXml(comment)}</comments>`);
  lines.push(`  <zone name="main">`);
  for (const c of main) lines.push(cardLine(c));
  lines.push(`  </zone>`);
  if (side.length > 0) {
    lines.push(`  <zone name="side">`);
    for (const c of side) lines.push(cardLine(c));
    lines.push(`  </zone>`);
  }
  lines.push(`</cockatrice_deck>`);
  return lines.join("\n");
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "deck";
}

export default function ExportDeckModal({ open, onClose, deckName, cards }: Props) {
  const [format, setFormat] = useState<Format>("plain");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCopied(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const content = useMemo(() => {
    switch (format) {
      case "arena": return toArena(cards);
      case "cockatrice": return toCockatrice(deckName, cards);
      default: return toPlain(cards);
    }
  }, [format, cards, deckName]);

  const currentFormat = FORMATS.find((f) => f.id === format)!;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard denied — user can select the textarea manually */
    }
  };

  const download = () => {
    const blob = new Blob([content], { type: `${currentFormat.mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slugify(deckName)}.${currentFormat.extension}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative w-full max-w-2xl rounded-xl bg-bg-surface border border-border-subtle shadow-glow p-6 max-h-[calc(100vh-2rem)] flex flex-col">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors"
          aria-label="Close"
        >
          <X size={18} />
        </button>

        <div className="mb-4">
          <h2 className="font-modern text-xl font-bold text-text-primary">Export deck</h2>
          <p className="text-xs text-text-muted mt-1 truncate">{deckName}</p>
        </div>

        {/* Format picker */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {FORMATS.map((f) => {
            const Icon = f.icon;
            const active = f.id === format;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFormat(f.id)}
                className={[
                  "flex flex-col items-start gap-1 px-3 py-2 rounded-md border text-left transition-colors",
                  active
                    ? "bg-accent/15 border-accent text-text-primary"
                    : "bg-bg-elevated border-border-subtle text-text-secondary hover:text-text-primary hover:border-border-strong",
                ].join(" ")}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <Icon size={13} /> {f.label}
                </span>
                <span className="text-[10px] text-text-muted leading-snug">
                  {f.description}
                </span>
              </button>
            );
          })}
        </div>

        {/* Preview */}
        <div className="flex-1 min-h-0 mb-4">
          <textarea
            readOnly
            value={content}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full h-64 bg-bg-base border border-border-subtle rounded-md px-3 py-2 text-xs font-mono text-text-primary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void copy()}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-accent hover:bg-accent-hover text-white text-sm font-semibold shadow-glow transition-colors"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={download}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-bg-elevated hover:bg-border-subtle text-text-primary text-sm font-medium border border-border-strong transition-colors"
          >
            <Download size={14} /> Download .{currentFormat.extension}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
