/**
 * Parse a pasted Magic deck list into (quantity, name, section) tuples.
 *
 * Supported shapes (case-insensitive on section markers):
 *   4 Lightning Bolt
 *   4x Lightning Bolt              — MTGA export sometimes uses `x`
 *   1 Sol Ring (2XM) 300           — MTGA export with set + collector number
 *   SB: 2 Wear // Tear             — old MTGO sideboard prefix (mapped to sideboard)
 *   Deck                            — section marker (mainboard)
 *   Commander
 *   Sideboard                       — dropped in Commander context but parsed
 *   Companion                       — treated as sideboard
 *   //  or  #  starts a comment (whole line ignored)
 *
 * We drop empty lines. Set + collector number are captured but currently
 * unused; the importer only sends the name to Scryfall's collection endpoint.
 * (Sending set/collector too would pin a specific printing — nice-to-have.)
 */

export type ParsedSection = "commander" | "main" | "sideboard";

export type ParsedEntry = {
  quantity: number;
  name: string;
  section: ParsedSection;
  set?: string;
  collectorNumber?: string;
};

export type ParseResult = {
  entries: ParsedEntry[];
  ignored: string[]; // lines we couldn't make sense of, for surfacing to the user
};

// Section marker lines (whole line, tolerant of trailing text like "Deck (100)")
const SECTION_RE = /^\s*(deck|main(?:board)?|commander|sideboard|maybeboard|companion|about)\b/i;

// Comment / metadata lines to skip silently
const COMMENT_RE = /^\s*(?:\/\/|#)/;

// Card line: quantity [x] name [(SET) collector]
// Groups: 1=qty, 2=name (greedy), 3=set (optional), 4=collector (optional)
const CARD_RE =
  /^\s*(\d+)\s*x?\s+([^()\n]+?)(?:\s+\(([A-Za-z0-9]{2,5})\)\s+([0-9A-Za-z-★]+))?\s*$/;

// MTGO-style sideboard prefix: "SB: 1 Card Name"
const SB_PREFIX_RE = /^\s*SB:\s*/i;

function mapSection(header: string): ParsedSection {
  const h = header.toLowerCase();
  if (h.startsWith("commander")) return "commander";
  if (h.startsWith("sideboard") || h.startsWith("companion") || h.startsWith("maybeboard")) return "sideboard";
  return "main";
}

export function parseDecklist(text: string): ParseResult {
  const entries: ParsedEntry[] = [];
  const ignored: string[] = [];
  let currentSection: ParsedSection = "main";

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (COMMENT_RE.test(line)) continue;

    const sectionMatch = line.match(SECTION_RE);
    if (sectionMatch) {
      currentSection = mapSection(sectionMatch[1]);
      continue;
    }

    // Handle explicit MTGO sideboard prefix: strip and parse remainder
    let workingLine = line;
    let sectionForThisLine = currentSection;
    if (SB_PREFIX_RE.test(workingLine)) {
      workingLine = workingLine.replace(SB_PREFIX_RE, "");
      sectionForThisLine = "sideboard";
    }

    const m = workingLine.match(CARD_RE);
    if (!m) {
      ignored.push(line);
      continue;
    }
    const [, qty, name, set, collector] = m;
    const quantity = parseInt(qty, 10);
    if (!quantity || quantity < 1) {
      ignored.push(line);
      continue;
    }
    entries.push({
      quantity,
      name: name.trim(),
      section: sectionForThisLine,
      set: set || undefined,
      collectorNumber: collector || undefined,
    });
  }

  return { entries, ignored };
}
