import { getSiteInfoByProvider } from '../adapters/sites';
import { installFileInputDeliveryBridge } from '../content/file-input-delivery-main';
import { ALL_PROVIDERS } from '../runtime/protocol';

const matches = Array.from(
  new Set(ALL_PROVIDERS.flatMap((provider) => getSiteInfoByProvider(provider).matches)),
);

export default defineContentScript({
  matches,
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    installFileInputDeliveryBridge();
  },
});
