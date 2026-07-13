import { formatCooldownRemaining } from '../hooks/use-provider-request';

const MORE_PROVIDER_REQUEST_OPTIONS = [
  'Perplexity',
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
  otherProviderText: string;
  requestSubmitting: boolean;
  requestSubmitted: boolean;
  requestEndpointNotConfigured: boolean;
  requestCooldownUntil: number | null;
  onToggleProvider: (provider: string) => void;
  onOtherProviderTextChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  if (!props.open) {
    return null;
  }

  const hasCustomProvider = props.otherProviderText.trim().length > 0;
  const canSubmit = props.requestedProviders.length > 0 || hasCustomProvider;

  return (
    <div className="askem-modal-overlay" onClick={props.onClose} role="presentation">
      <section
        className="askem-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="askem-request-modal-title"
      >
        {props.requestSubmitted ? (
          <>
            <div className="askem-modal-top askem-modal-top-compact">
              <p className="askem-card-label">Requests</p>
              <button className="askem-modal-close" onClick={props.onClose} type="button">
                Close
              </button>
            </div>
            <div className="askem-modal-state askem-modal-state-compact">
              <p>Thanks. We got your request.</p>
              <span>We&apos;ll use it to shape what comes next.</span>
            </div>
          </>
        ) : props.requestCooldownUntil ? (
          <>
            <div className="askem-modal-top askem-modal-top-compact">
              <p className="askem-card-label">Requests</p>
              <button className="askem-modal-close" onClick={props.onClose} type="button">
                Close
              </button>
            </div>
            <div className="askem-modal-state askem-modal-state-compact">
              <p>Request already sent.</p>
              <span>You can send another one {formatCooldownRemaining(props.requestCooldownUntil)}.</span>
            </div>
          </>
        ) : (
          <>
            <div className="askem-modal-top">
              <div>
                <p className="askem-card-label">Requests</p>
                <h2 id="askem-request-modal-title">Request More Providers</h2>
              </div>
              <button className="askem-modal-close" onClick={props.onClose} type="button">
                Close
              </button>
            </div>
            <p className="askem-card-copy">
              Pick the providers you want us to add next. Choose as many as you want.
            </p>
            {props.requestEndpointNotConfigured ? (
              <div className="askem-modal-state" style={{ marginBottom: 14 }}>
                <p>Request endpoint is not configured.</p>
                <span>This build cannot send provider requests yet.</span>
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
            <div className="askem-request-other">
              <label className="askem-feedback-label" htmlFor="askem-other-provider-input">
                Other
              </label>
              <input
                id="askem-other-provider-input"
                className="askem-request-other-input"
                value={props.otherProviderText}
                onChange={(event) => props.onOtherProviderTextChange(event.target.value)}
                placeholder="Provider name"
                maxLength={80}
                disabled={props.requestSubmitting}
              />
            </div>
            <div className="askem-modal-actions">
              <button className="askem-provider-clear" onClick={props.onClose} type="button">
                Cancel
              </button>
              <button
                className="askem-clear-workspace"
                onClick={props.onSubmit}
                disabled={props.requestSubmitting || !canSubmit}
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
