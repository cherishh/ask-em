export default defineContentScript({
  matches: ['*://claude.ai/*'],
  runAt: 'document_idle',
  main() {
    console.log("[ask'em] claude content script loaded");
  },
});
