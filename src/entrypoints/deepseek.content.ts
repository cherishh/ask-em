import { bootstrapContentScript } from '../utils/content-bootstrap';
import { deepseekAdapter } from '../adapters/deepseek';

export default defineContentScript({
  matches: ['*://chat.deepseek.com/*'],
  runAt: 'document_idle',
  main() {
    bootstrapContentScript(deepseekAdapter);
  },
});
