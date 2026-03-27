import { bootstrapContentScript } from '../utils/content-bootstrap';
import { claudeAdapter } from '../adapters/claude';

export default defineContentScript({
  matches: ['*://claude.ai/*'],
  runAt: 'document_idle',
  main() {
    bootstrapContentScript(claudeAdapter);
  },
});
