import { chatgptAdapter } from '../adapters/chatgpt';
import { bootstrapContentScript } from '../utils/content-bootstrap';

export default defineContentScript({
  matches: ['*://chatgpt.com/*'],
  runAt: 'document_idle',
  main() {
    bootstrapContentScript(chatgptAdapter);
  },
});
