import type { Provider } from '../../../runtime/protocol';
import { SUPPORTED_SITES } from '../../../adapters/sites';

function getProviderOrigin(provider: Provider): string {
  const site = SUPPORTED_SITES.find((s) => s.name === provider);
  return site?.origin ?? '#';
}

export function OnboardingCard({ providers }: { providers: Provider[] }) {
  const openProvider = (provider: Provider) => {
    const origin = getProviderOrigin(provider);
    void chrome.tabs.create({ url: origin });
  };

  return (
    <div className="askem-onboarding">
      <div className="askem-onboarding-header">
        <span className="askem-onboarding-step">Get Started</span>
        <p className="askem-onboarding-title">Ask every AI at once</p>
      </div>
      <div className="askem-onboarding-body">
        <p className="askem-onboarding-desc">
          ask&apos;em lets you compare models without leaving their official apps, so you keep
          artifacts, web search, file uploads, long-term memory, and every new feature each
          provider ships.
        </p>
        <div className="askem-onboarding-steps">
          <div className="askem-onboarding-step-item">
            <span className="askem-onboarding-num">1</span>
            <span>Open any AI chat below</span>
          </div>
          <div className="askem-onboarding-step-item">
            <span className="askem-onboarding-num">2</span>
            <span>Type your prompt and send</span>
          </div>
          <div className="askem-onboarding-step-item">
            <span className="askem-onboarding-num">3</span>
            <span>It auto-syncs to the other models</span>
          </div>
        </div>
        <p className="askem-onboarding-hint">
          Make sure you&apos;re logged in to each provider you want to sync.
        </p>
        <div className="askem-onboarding-providers">
          {providers.length > 0 ? (
            providers.map((provider) => (
              <button
                key={provider}
                className="askem-onboarding-provider-btn"
                onClick={() => openProvider(provider)}
                type="button"
              >
                {provider}
                <span className="askem-onboarding-arrow">→</span>
              </button>
            ))
          ) : (
            <span className="askem-onboarding-empty">Enable a default model in Settings.</span>
          )}
        </div>
      </div>
    </div>
  );
}
