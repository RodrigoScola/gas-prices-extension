// Which tabs the sidebar reads automatically: Gmail, and Outlook on the web for work accounts
// (outlook.office.com, outlook.office365.com, outlook.cloud.microsoft) and personal ones
// (outlook.live.com). Other tabs leave the current quote alone.
// (The extension only sees tab.url for sites in host_permissions.)
const MAIL_HOSTS = {
  "mail.google.com": "Gmail",
  "outlook.office.com": "Outlook",
  "outlook.office365.com": "Outlook",
  "outlook.cloud.microsoft": "Outlook",
  "outlook.live.com": "Outlook",
};
export function mailApp(url) {
  const m = /^https:\/\/([^/?#]+)\//.exec(url || "");
  return (m && MAIL_HOSTS[m[1]]) || null;
}
export const isMailTab = (url) => mailApp(url) != null;
export const isGmail = (url) => mailApp(url) === "Gmail";

// Runs inside the email page (via chrome.scripting.executeScript) and returns plain text, never HTML.
// Chrome serializes this function into the page, so it must not use anything from outside it.
// Order: the user's selection, then the open message in Gmail or Outlook, then the whole page.
export function captureEmailText() {
  const selection = window.getSelection()?.toString().trim();
  if (selection) return { text: selection, source: "selection" };

  const visible = (el) => el && el.offsetParent !== null && el.innerText.trim();
  const all = (selector) => [...document.querySelectorAll(selector)].filter(visible);
  const firstOf = (selectors) => {
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (el?.innerText.trim()) return el;
    }
    return null;
  };

  // The subject carries the equipment, date and reference, so it goes in front of the body.
  const withSubject = (subjectEl, body) => (subjectEl?.innerText.trim() ? `Subject: ${subjectEl.innerText.trim()}\n\n` : "") + body.innerText;
  const host = location.hostname;

  // Gmail renders each message body in div.a3s; a thread lists oldest first, so the last visible
  // one is the newest. The thread subject is h2.hP.
  if (host === "mail.google.com") {
    const body = all("div.a3s").pop();
    if (body) return { text: withSubject(document.querySelector("h2.hP"), body), source: "Gmail message" };
    return { text: null, source: "no open email" };
  }

  // Outlook on the web (work and personal) marks each message body with aria-label="Message body".
  // Its conversations list newest first, so the first visible one is the newest.
  if (/^outlook\./.test(host)) {
    const body = all('[aria-label="Message body"]')[0] || all('[role="main"] [role="document"]')[0];
    if (body) {
      const subject = firstOf(['[role="main"] [role="heading"][aria-level="2"]', '#ReadingPaneContainerId [role="heading"]', '[role="main"] [role="heading"]']);
      return { text: withSubject(subject, body), source: "Outlook message" };
    }
    return { text: null, source: "no open email" };
  }

  return { text: document.body.innerText, source: "whole page" };
}
