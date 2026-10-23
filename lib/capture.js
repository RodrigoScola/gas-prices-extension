// Runs inside the email page (via chrome.scripting.executeScript) and returns plain text, never HTML.
// Order: the user's selection, then the open message body in Gmail or Outlook, then the whole page.
export function captureEmailText() {
  const selection = window.getSelection()?.toString().trim();
  if (selection) return { text: selection, source: "selection" };

  const visible = (el) => el && el.offsetParent !== null && el.innerText.trim();
  const last = (selector) => [...document.querySelectorAll(selector)].filter(visible).pop();

  // Gmail renders each message body in div.a3s; the last visible one is the open message.
  const gmail = location.hostname === "mail.google.com" && last("div.a3s");
  if (gmail) return { text: gmail.innerText, source: "Gmail message" };

  const outlook = /outlook\./.test(location.hostname) &&
    (last('[aria-label="Message body"]') || last('[role="document"]'));
  if (outlook) return { text: outlook.innerText, source: "Outlook message" };

  return { text: document.body.innerText, source: "whole page" };
}
