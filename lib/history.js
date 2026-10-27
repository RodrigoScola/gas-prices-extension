// Recent quotes, newest first, so the broker can go back to one without reopening the email.
export const HISTORY_MAX = 25;

// One entry per email: re-quoting the same email replaces its entry and moves it to the top.
// entry: { key, reference, origin, destination, equipment, total, at, snapshot }
export function addToHistory(list, entry, max = HISTORY_MAX) {
  return [entry, ...(list || []).filter((e) => e.key !== entry.key)].slice(0, max);
}

// A short, stable key for an email's text (FNV-1a), so history doesn't store the key twice.
export function emailKey(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < String(text).length; i++) {
    h ^= String(text).charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// "5 min ago", "2 h ago", "yesterday", else a date.
export function ago(iso, now = new Date()) {
  const s = (now - new Date(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 172800) return "yesterday";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
