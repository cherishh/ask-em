import {
  FEEDBACK_ATTACHMENT_ACCEPT,
  FEEDBACK_ATTACHMENT_LIMIT,
  FEEDBACK_KIND_OPTIONS,
  type FeedbackKind,
  type FeedbackStep,
} from '../feedback';
import type { FeedbackAttachmentDraft } from '../hooks/use-feedback';

function getMessagePageCopy(kind: FeedbackKind | null) {
  if (kind === 'feature-request') {
    return {
      heading: 'Feature Request',
      fieldLabel: 'Request',
      placeholder: 'What should ask\'em build next?',
      submitLabel: 'Send Request',
    };
  }

  if (kind === 'say-something-nice') {
    return {
      heading: 'Say Something Nice',
      fieldLabel: 'Message',
      placeholder: 'What did ask\'em get right? What felt unusually good?',
      submitLabel: 'Send Note',
    };
  }

  return {
    heading: 'Bug Report',
    fieldLabel: 'Report',
    placeholder: 'What happened? What felt wrong? What should change?',
    submitLabel: 'Send Report',
  };
}

function getAttachmentCopy(kind: FeedbackKind | null) {
  if (kind === 'feature-request') {
    return {
      title: 'Reference images',
      description: `Add up to ${FEEDBACK_ATTACHMENT_LIMIT} images that help explain the request.`,
      action: 'Add images',
    };
  }

  if (kind === 'say-something-nice') {
    return {
      title: 'Images',
      description: `Add up to ${FEEDBACK_ATTACHMENT_LIMIT} images you want to share with your note.`,
      action: 'Add images',
    };
  }

  return {
    title: 'Screenshots',
    description: `Paste or add up to ${FEEDBACK_ATTACHMENT_LIMIT} images to show what you saw.`,
    action: 'Add screenshots',
  };
}

function FeedbackAttachments(props: {
  feedbackKind: FeedbackKind | null;
  feedbackConfigured: boolean;
  feedbackSubmitting: boolean;
  attachments: FeedbackAttachmentDraft[];
  attachmentError: string | null;
  onAddAttachments: (files: FileList | File[] | null) => void;
  onRemoveAttachment: (attachmentId: string) => void;
}) {
  const copy = getAttachmentCopy(props.feedbackKind);

  return (
    <>
      <div className="askem-feedback-attachments">
        <div className="askem-feedback-attachments-top">
          <div className="askem-feedback-attachments-copy">
            <span className="askem-feedback-attachments-kicker">{copy.title}</span>
            <p>{copy.description}</p>
          </div>
          {props.attachments.length < FEEDBACK_ATTACHMENT_LIMIT ? (
            <label className="askem-feedback-upload">
              <input
                type="file"
                accept={FEEDBACK_ATTACHMENT_ACCEPT}
                multiple
                onChange={(event) => {
                  props.onAddAttachments(event.currentTarget.files);
                  event.currentTarget.value = '';
                }}
                disabled={props.feedbackSubmitting || !props.feedbackConfigured}
              />
              {copy.action}
            </label>
          ) : (
            <span className="askem-feedback-upload-cap">
              {props.attachments.length}/{FEEDBACK_ATTACHMENT_LIMIT}
            </span>
          )}
        </div>
        {props.attachments.length ? (
          <div className="askem-feedback-attachment-grid">
            {props.attachments.map((attachment) => (
              <div className="askem-feedback-attachment-card" key={attachment.id}>
                <img className="askem-feedback-attachment-image" src={attachment.previewUrl} alt="" />
                <button
                  className="askem-feedback-attachment-remove"
                  onClick={() => props.onRemoveAttachment(attachment.id)}
                  type="button"
                  disabled={props.feedbackSubmitting}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {props.attachmentError ? (
        <p className="askem-feedback-error">{props.attachmentError}</p>
      ) : null}
    </>
  );
}

export function FeedbackModal(props: {
  open: boolean;
  feedbackConfigured: boolean;
  feedbackStep: FeedbackStep;
  feedbackKind: FeedbackKind | null;
  feedbackText: string;
  includeLogs: boolean;
  attachments: FeedbackAttachmentDraft[];
  attachmentError: string | null;
  feedbackSubmitting: boolean;
  feedbackSubmitted: boolean;
  feedbackError: string | null;
  canSubmit: boolean;
  onClose: () => void;
  onBack: () => void;
  onSelectFeedbackKind: (kind: FeedbackKind) => void;
  onFeedbackTextChange: (value: string) => void;
  onIncludeLogsChange: (checked: boolean) => void;
  onAddAttachments: (files: FileList | File[] | null) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onSubmit: () => void;
}) {
  if (!props.open) {
    return null;
  }

  const messagePageCopy = getMessagePageCopy(props.feedbackKind);
  const successLine =
    props.feedbackKind === 'feature-request'
      ? 'Thanks. We got your request.'
      : props.feedbackKind === 'say-something-nice'
        ? 'Thanks. We got your note.'
        : 'Thanks. We got your report.';
  const successSubline =
    props.feedbackKind === 'feature-request'
      ? 'We\'ll use it to prioritize upcoming product work.'
      : props.feedbackKind === 'say-something-nice'
        ? 'We appreciate the encouragement.'
        : 'We\'ll review it with any details you included.';

  return (
    <div
      className="askem-modal-overlay"
      onClick={() => !props.feedbackSubmitting && props.onClose()}
      role="presentation"
    >
      <section
        className="askem-modal askem-feedback-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {props.feedbackSubmitted ? (
          <>
            <div className="askem-modal-top askem-modal-top-compact">
              <p className="askem-card-label">Feedback</p>
              <button
                className="askem-modal-close"
                onClick={props.onClose}
                type="button"
                disabled={props.feedbackSubmitting}
              >
                Close
              </button>
            </div>
            <div className="askem-modal-state askem-modal-state-compact">
              <p>{successLine}</p>
              <span>{successSubline}</span>
            </div>
          </>
        ) : props.feedbackStep === 'category' ? (
          <>
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
            <p className="askem-feedback-intro">Choose one.</p>
            <div className="askem-feedback-choice-list" role="list">
              {FEEDBACK_KIND_OPTIONS.map((option) => (
                <button
                  key={option.kind}
                  className="askem-feedback-choice-card"
                  onClick={() => props.onSelectFeedbackKind(option.kind)}
                  type="button"
                  disabled={props.feedbackSubmitting}
                >
                  <strong>{option.label}</strong>
                  <span>{option.description}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="askem-modal-top">
              <div>
                <p className="askem-card-label">Feedback</p>
                <h2>{messagePageCopy.heading}</h2>
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
            <button
              className="askem-feedback-back"
              onClick={props.onBack}
              type="button"
              disabled={props.feedbackSubmitting}
            >
              ← Back
            </button>
            <div className="askem-feedback-field">
              <label className="askem-feedback-label" htmlFor="askem-feedback-input">
                {messagePageCopy.fieldLabel}
              </label>
              <textarea
                id="askem-feedback-input"
                className="askem-feedback-textarea"
                placeholder={messagePageCopy.placeholder}
                value={props.feedbackText}
                onChange={(event) => props.onFeedbackTextChange(event.target.value)}
                onPaste={(event) => {
                  const pastedFiles = Array.from(event.clipboardData.files);
                  const hasImage = pastedFiles.some((file) => file.type.startsWith('image/'));

                  if (!hasImage) {
                    return;
                  }

                  event.preventDefault();
                  props.onAddAttachments(pastedFiles);
                }}
                rows={6}
                disabled={props.feedbackSubmitting}
              />
            </div>
            <FeedbackAttachments
              feedbackKind={props.feedbackKind}
              feedbackConfigured={props.feedbackConfigured}
              feedbackSubmitting={props.feedbackSubmitting}
              attachments={props.attachments}
              attachmentError={props.attachmentError}
              onAddAttachments={props.onAddAttachments}
              onRemoveAttachment={props.onRemoveAttachment}
            />
            {props.feedbackKind === 'bug-report' ? (
              <div className={`askem-feedback-log-note ${props.includeLogs ? 'is-attached' : 'is-detached'}`}>
                <div className="askem-feedback-log-copy">
                  <button
                    className="askem-feedback-log-kicker"
                    onClick={() => props.onIncludeLogsChange(!props.includeLogs)}
                    type="button"
                    disabled={props.feedbackSubmitting || !props.feedbackConfigured}
                  >
                    Diagnostics
                  </button>
                  <p>
                    {props.includeLogs
                      ? 'Local debug logs will be attached to help reproduce this issue faster.'
                      : 'Local debug logs will not be attached to this report.'}
                  </p>
                </div>
              </div>
            ) : null}
            {props.feedbackError ? (
              <p className="askem-feedback-error">{props.feedbackError}</p>
            ) : !props.feedbackConfigured ? (
              <p className="askem-feedback-error">Feedback endpoint is not configured.</p>
            ) : null}
            <div className="askem-modal-actions">
              <button
                className="askem-provider-clear"
                onClick={props.onBack}
                type="button"
                disabled={props.feedbackSubmitting}
              >
                Back
              </button>
              <button
                className="askem-clear-workspace"
                onClick={props.onSubmit}
                disabled={!props.canSubmit}
                type="button"
              >
                {props.feedbackSubmitting ? 'Sending' : messagePageCopy.submitLabel}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
