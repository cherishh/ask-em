import '../styles/content-ui.css';
import { getAdapter } from '../adapters/registry';
import { getSiteInfoByProvider } from '../adapters/sites';
import type { Provider } from '../runtime/protocol';
import { bootstrapContentScript } from './content-bootstrap';

export function createProviderContentScript(provider: Provider) {
  const adapter = getAdapter(provider);
  const site = getSiteInfoByProvider(provider);

  return defineContentScript({
    matches: site.matches,
    runAt: 'document_idle',
    main() {
      bootstrapContentScript(adapter);
    },
  });
}
