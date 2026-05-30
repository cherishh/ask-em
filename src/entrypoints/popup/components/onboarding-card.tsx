import type { Provider } from '../../../runtime/protocol';

export function OnboardingCard({
  providers,
  enabledProviders,
  loading,
  onToggleProvider,
}: {
  providers: Provider[];
  enabledProviders: Provider[];
  loading: boolean;
  onToggleProvider: (provider: Provider) => void;
}) {
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
            <span>Choose who joins the first fan-out</span>
          </div>
          <div className="askem-onboarding-step-item">
            <span className="askem-onboarding-num">2</span>
            <span>Open any AI chat and send</span>
          </div>
          <div className="askem-onboarding-step-item">
            <span className="askem-onboarding-num">3</span>
            <span>It auto-syncs to selected models</span>
          </div>
        </div>
        <p className="askem-onboarding-hint">
          Make sure you&apos;re logged in to each provider you want to sync.
        </p>
        <div className="askem-onboarding-providers">
          {providers.length > 0 ? (
            providers.map((provider) => {
              const active = enabledProviders.includes(provider);

              return (
                <button
                  key={provider}
                  className="askem-onboarding-provider-btn"
                  onClick={() => onToggleProvider(provider)}
                  type="button"
                  disabled={loading}
                  aria-pressed={active}
                  aria-label={`${active ? 'Disable' : 'Enable'} ${provider} for first fan-out`}
                  data-enabled={String(active)}
                >
                  {provider}
                  <span className="askem-onboarding-provider-check" aria-hidden="true">
                    {active ? '✓' : ''}
                  </span>
                </button>
              );
            })
          ) : (
            <span className="askem-onboarding-empty">Enable a default model in Settings.</span>
          )}
        </div>
      </div>
    </div>
  );
}
