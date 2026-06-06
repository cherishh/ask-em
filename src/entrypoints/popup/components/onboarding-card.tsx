import type { Provider } from '../../../runtime/protocol';

export function OnboardingCard({
  providers,
  selectedProviders,
  loading,
  onToggleProvider,
}: {
  providers: Provider[];
  selectedProviders: Provider[];
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
        <div className="askem-onboarding-steps">
          <div className="askem-onboarding-step-item">
            <span className="askem-onboarding-num">1</span>
            <span>Choose the AI chats you want to ask</span>
          </div>
          <div className="askem-onboarding-step-item">
            <span className="askem-onboarding-num">2</span>
            <span>Open any one as usual</span>
          </div>
          <div className="askem-onboarding-step-item">
            <span className="askem-onboarding-num">3</span>
            <span>
              Send your prompt as usual. ask&apos;em opens the other chats in new tabs and syncs it across
            </span>
          </div>
        </div>
        <p className="askem-onboarding-hint">
          Make sure you&apos;re signed in to each selected AI chat first.
        </p>
        <div className="askem-onboarding-providers">
          {providers.length > 0 ? (
            providers.map((provider) => {
              const active = selectedProviders.includes(provider);
              const locked = active && selectedProviders.length <= 1;

              return (
                <button
                  key={provider}
                  className="askem-onboarding-provider-btn"
                  onClick={() => onToggleProvider(provider)}
                  type="button"
                  disabled={loading || locked}
                  aria-pressed={active}
                  aria-label={
                    locked
                      ? `Keep ${provider} for default fan-out`
                      : `${active ? 'Disable' : 'Enable'} ${provider} for default fan-out`
                  }
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
            <span className="askem-onboarding-empty">Enable providers in Settings.</span>
          )}
        </div>
      </div>
    </div>
  );
}
