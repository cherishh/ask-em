import { geminiAdapter } from '../adapters/gemini';
import { bootstrapContentScript } from '../utils/content-bootstrap';

export default defineContentScript({
  matches: ['*://gemini.google.com/*'],
  runAt: 'document_idle',
  main() {
    bootstrapContentScript(geminiAdapter);
  },
});
