import { formatCooldownRemaining } from '../hooks/use-provider-request';

const MORE_PROVIDER_REQUEST_OPTIONS = [
  'Perplexity',
  'Grok',
  'Meta AI',
  'Mistral',
  'Qwen',
  'Kimi',
  'Doubao',
  'Poe',
] as const;

export function RequestProvidersModal(props: {
  open: boolean;
  requestedProviders: string[];
  requestSubmitting: boolean;
  requestSubmitted: boolean;
  requestComingSoon: boolean;
  requestCooldownUntil: number | null;
  onToggleProvider: (provider: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  onResetCooldownForDev: () => void;
}) {
  if (!props.open) {
    return null;
  }

  return (
    <div className="askem-modal-overlay" onClick={props.onClose} role="presentation">
      <section
        className="askem-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="askem-request-modal-title"
      >
        <div className="askem-modal-top">
          <div>
            <p className="askem-card-label">Requests</p>
            <h2 id="askem-request-modal-title">Request More Providers</h2>
          </div>
          <button className="askem-modal-close" onClick={props.onClose} type="button">
            Close
          </button>
        </div>

        {props.requestSubmitted ? (
          <div className="askem-modal-state">
            <p>Thanks. Your request is in.</p>
            <span>We&apos;re on it. Stay tuned.</span>
          </div>
        ) : props.requestCooldownUntil ? (
          <div className="askem-modal-state">
            <p>You already sent a request recently.</p>
            <span>You can send another one {formatCooldownRemaining(props.requestCooldownUntil)}.</span>
            <button
              type="button"
              className="askem-provider-clear"
              style={{ marginTop: 12 }}
              onClick={props.onResetCooldownForDev}
            >
              DEV: Reset Cooldown
            </button>
          </div>
        ) : (
          <>
            <p className="askem-card-copy">
              Pick the providers you want us to add next. Choose as many as you want.
            </p>
            {props.requestComingSoon ? (
              <div className="askem-modal-state" style={{ marginBottom: 14 }}>
                <p>Coming soon.</p>
                <span>Request sending isn&apos;t live yet.</span>
              </div>
            ) : null}
            <div className="askem-request-grid">
              {MORE_PROVIDER_REQUEST_OPTIONS.map((provider) => {
                const active = props.requestedProviders.includes(provider);

                return (
                  <button
                    key={provider}
                    className={`askem-request-chip ${active ? 'is-active' : ''}`}
                    onClick={() => props.onToggleProvider(provider)}
                    type="button"
                  >
                    <span className="askem-provider-chip-dot" aria-hidden="true" />
                    <span>{provider}</span>
                  </button>
                );
              })}
            </div>
            <div className="askem-modal-actions">
              <button className="askem-provider-clear" onClick={props.onClose} type="button">
                Cancel
              </button>
              <button
                className="askem-clear-workspace"
                onClick={props.onSubmit}
                disabled={props.requestSubmitting || props.requestedProviders.length === 0}
                type="button"
              >
                {props.requestSubmitting ? 'Sending' : 'Send Request'}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
