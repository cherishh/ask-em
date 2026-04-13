export function FeedbackModal(props: {
  open: boolean;
  feedbackConfigured: boolean;
  feedbackText: string;
  includeLogs: boolean;
  feedbackSubmitting: boolean;
  feedbackSubmitted: boolean;
  feedbackError: string | null;
  onClose: () => void;
  onFeedbackTextChange: (value: string) => void;
  onIncludeLogsChange: (checked: boolean) => void;
  onSubmit: () => void;
}) {
  if (!props.open) {
    return null;
  }

  return (
    <div
      className="askem-modal-overlay"
      onClick={() => !props.feedbackSubmitting && props.onClose()}
      role="presentation"
    >
      <section
        className="askem-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="askem-modal-top">
          <div>
            <p className="askem-card-label">Feedback</p>
            <h2>Send Feedback</h2>
          </div>
          <button
            className="askem-modal-close"
            onClick={props.onClose}
            type="button"
            disabled={props.feedbackSubmitting}
          >
            Close
          </button>
        </div>
        {props.feedbackSubmitted ? (
          <div className="askem-modal-state">
            <p>Thanks. Your feedback is in.</p>
            <span>We&apos;ll review it together with any optional logs you included.</span>
          </div>
        ) : (
          <>
            <div className="askem-feedback-field">
              <label className="askem-feedback-label" htmlFor="askem-feedback-input">
                Feedback
              </label>
              <textarea
                id="askem-feedback-input"
                className="askem-feedback-textarea"
                placeholder="What happened? What felt wrong? What should change?"
                value={props.feedbackText}
                onChange={(event) => props.onFeedbackTextChange(event.target.value)}
                rows={6}
                disabled={props.feedbackSubmitting}
              />
            </div>
            <label className="askem-feedback-checkbox">
              <input
                type="checkbox"
                checked={props.includeLogs}
                onChange={(event) => props.onIncludeLogsChange(event.target.checked)}
                disabled={props.feedbackSubmitting || !props.feedbackConfigured}
              />
              <span>Include logs</span>
            </label>
            {props.feedbackError ? (
              <p className="askem-feedback-error">{props.feedbackError}</p>
            ) : !props.feedbackConfigured ? (
              <p className="askem-feedback-error">Feedback endpoint is not configured.</p>
            ) : (
              <p className="askem-feedback-note">
                {props.includeLogs
                  ? "Your feedback and a snapshot of local debug logs will be sent to ask'em's feedback service."
                  : "Only your written feedback will be sent to ask'em's feedback service."}
              </p>
            )}
            <div className="askem-modal-actions">
              <button
                className="askem-provider-clear"
                onClick={props.onClose}
                type="button"
                disabled={props.feedbackSubmitting}
              >
                Cancel
              </button>
              <button
                className="askem-clear-workspace"
                onClick={props.onSubmit}
                disabled={
                  props.feedbackSubmitting ||
                  props.feedbackText.trim().length === 0 ||
                  !props.feedbackConfigured
                }
                type="button"
              >
                {props.feedbackSubmitting ? 'Sending' : 'Send Feedback'}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
