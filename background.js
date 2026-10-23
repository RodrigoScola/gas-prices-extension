// Toolbar icon opens the side panel. Right-clicking selected text sends it to the panel.

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  chrome.contextMenus.create({
    id: "quote-selection",
    title: "Quote this shipment",
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "quote-selection") return;
  // open() must run inside the user gesture, so call it before any await.
  chrome.sidePanel.open({ windowId: tab.windowId });
  chrome.storage.session.set({ pendingEmail: { text: info.selectionText, at: Date.now() } });
});
