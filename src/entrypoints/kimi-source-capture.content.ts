import { getSiteInfoByProvider } from '../adapters/sites';
import { installFileInputSourceCaptureHook } from '../content/file-input-source-capture-main';

const site = getSiteInfoByProvider('kimi');

export default defineContentScript({
  matches: site.matches,
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    // Keep source capture active in prompt-only mode so the content script can
    // warn that Kimi attachments will be skipped.
    installFileInputSourceCaptureHook();
  },
});
