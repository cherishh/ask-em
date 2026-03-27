export default defineContentScript({
  matches: ['*://chat.deepseek.com/*'],
  runAt: 'document_idle',
  main() {
    console.log("[ask'em] deepseek content script loaded");
  },
});
