// The sidebar only reads Gmail tabs automatically; other tabs leave the current quote alone.
// (The extension only sees tab.url for sites in host_permissions.)
export const isGmail = (url) => /^https:\/\/mail\.google\.com\//.test(url || "");

// Runs inside the email page (via chrome.scripting.executeScript) and returns plain text, never HTML.
// Order: the user's selection, then the open message body in Gmail or Outlook, then the whole page.
export function captureEmailText() {
  const selection = window.getSelection()?.toString().trim();
  if (selection) return { text: selection, source: "selection" };

  const visible = (el) => el && el.offsetParent !== null && el.innerText.trim();
  const last = (selector) => [...document.querySelectorAll(selector)].filter(visible).pop();

  // The subject carries the equipment, date and reference, so it goes in front of the body.
  const withSubject = (subjectEl, body) => (subjectEl?.innerText.trim() ? `Subject: ${subjectEl.innerText.trim()}\n\n` : "") + body.innerText;

  // Gmail renders each message body in div.a3s (the last visible one is the open message)
  // and the thread subject in h2.hP.
  const gmail = location.hostname === "mail.google.com" && last("div.a3s");
  if (gmail) return { text: withSubject(document.querySelector("h2.hP"), gmail), source: "Gmail message" };

  const outlook = /outlook\./.test(location.hostname) &&
    (last('[aria-label="Message body"]') || last('[role="document"]'));
  if (outlook) return { text: withSubject(document.querySelector('[role="main"] [role="heading"]'), outlook), source: "Outlook message" };

  // In Gmail/Outlook with no message open (the inbox list), there's nothing to quote.
  if (/^(mail\.google\.com|outlook\.)/.test(location.hostname)) return { text: null, source: "no open email" };
  return { text: document.body.innerText, source: "whole page" };
}
