export default defineContentScript({
  matches: ['*://chatgpt.com/*'],
  runAt: 'document_idle',
  main() {
    console.log("[ask'em] chatgpt content script loaded");
  },
});
