import { getSiteInfoByProvider } from '../adapters/sites';
import { installTransientFileInputHook } from '../content/transient-file-input-main';

const site = getSiteInfoByProvider('gemini');

export default defineContentScript({
  matches: site.matches,
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    installTransientFileInputHook();
  },
});
