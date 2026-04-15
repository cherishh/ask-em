export function DevToolsModal(props: {
  open: boolean;
  busy: boolean;
  showDiagnostics: boolean;
  onClose: () => void;
  onClearPersistentStorage: () => void;
  onResetRequestCooldown: () => void;
  onToggleShowDiagnostics: () => void;
}) {
  if (!props.open) {
    return null;
  }

  return (
    <div
      className="askem-modal-overlay"
      onClick={() => !props.busy && props.onClose()}
      role="presentation"
    >
      <section
        className="askem-modal askem-dev-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="askem-modal-top">
          <div>
            <p className="askem-card-label">Development</p>
            <h2>Dev Tools</h2>
          </div>
          <button
            className="askem-modal-close"
            onClick={props.onClose}
            type="button"
            disabled={props.busy}
          >
            Close
          </button>
        </div>
        <div className="askem-dev-list">
          <div className="askem-dev-row">
            <div className="askem-dev-copy">
              <p className="askem-dev-title">Show Diagnostics card</p>
              <span className="askem-dev-desc">
                Reveal the Diagnostics section in Settings without changing trace defaults.
              </span>
            </div>
            <button
              className={`askem-provider-chip ${props.showDiagnostics ? 'is-active' : ''}`}
              onClick={props.onToggleShowDiagnostics}
              disabled={props.busy}
              type="button"
            >
              <span>Diagnostics</span>
              <span>{props.showDiagnostics ? 'on' : 'off'}</span>
            </button>
          </div>
          <div className="askem-dev-row">
            <div className="askem-dev-copy">
              <p className="askem-dev-title">Clear persistent storage</p>
              <span className="askem-dev-desc">
                Reset popup settings, workspace state, logs, and saved indicator positions.
              </span>
            </div>
            <button
              className="askem-provider-clear"
              onClick={props.onClearPersistentStorage}
              disabled={props.busy}
              type="button"
            >
              {props.busy ? 'Clearing' : 'Run'}
            </button>
          </div>
          <div className="askem-dev-row">
            <div className="askem-dev-copy">
              <p className="askem-dev-title">Reset request cooldown</p>
              <span className="askem-dev-desc">
                Clear the local cooldown for Request more providers.
              </span>
            </div>
            <button
              className="askem-provider-clear"
              onClick={props.onResetRequestCooldown}
              disabled={props.busy}
              type="button"
            >
              Run
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
