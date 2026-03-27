export default defineContentScript({
  matches: ['*://gemini.google.com/*'],
  runAt: 'document_idle',
  main() {
    console.log("[ask'em] gemini content script loaded");
  },
});
