// The quote's lines as plain text, for pasting into a TMS or a note.
export function quoteText(quote) {
  return quote.lines.map(([l, v]) => `${l}: ${v}`).join("\n");
}
