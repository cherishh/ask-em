import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { requestFullLogs } from '../popup-runtime';
import {
  FEEDBACK_ATTACHMENT_ACCEPT,
  FEEDBACK_ATTACHMENT_LIMIT,
  FEEDBACK_ATTACHMENT_MAX_BYTES,
  type FeedbackKind,
  type FeedbackStep,
  type FeatureRequestChoice,
  getFeatureRequestLabel,
} from '../feedback';
import { getFeedbackEndpoint } from '../support-endpoints';

const FEEDBACK_MAX_LENGTH = 4000;
const ACCEPTED_ATTACHMENT_TYPES = new Set(
  FEEDBACK_ATTACHMENT_ACCEPT.split(',').map((value) => value.trim()),
);

export type FeedbackAttachmentDraft = {
  id: string;
  file: File;
  previewUrl: string;
};

function normalizeMessage(value: string): string {
  return value.trim().slice(0, FEEDBACK_MAX_LENGTH);
}

function createFeatureRequestMessage(
  choice: FeatureRequestChoice | null,
  customText: string,
): string {
  if (choice === 'custom') {
    return normalizeMessage(customText);
  }

  return getFeatureRequestLabel(choice).slice(0, FEEDBACK_MAX_LENGTH);
}

function createPreviewUrl(file: File): string {
  return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : '';
}

function revokePreviewUrl(url: string) {
  if (!url || typeof URL.revokeObjectURL !== 'function') {
    return;
  }

  URL.revokeObjectURL(url);
}

export function useFeedback() {
  const feedbackConfigured = getFeedbackEndpoint().length > 0;
  const [feedbackStep, setFeedbackStep] = useState<FeedbackStep>('category');
  const [feedbackKind, setFeedbackKind] = useState<FeedbackKind | null>(null);
  const [featureRequestChoice, setFeatureRequestChoice] = useState<FeatureRequestChoice | null>(null);
  const [customFeatureRequestText, setCustomFeatureRequestText] = useState('');
  const [feedbackText, setFeedbackText] = useState('');
  const [includeLogs, setIncludeLogs] = useState(true);
  const [attachments, setAttachments] = useState<FeedbackAttachmentDraft[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const attachmentsRef = useRef<FeedbackAttachmentDraft[]>([]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => () => {
    attachmentsRef.current.forEach((attachment) => revokePreviewUrl(attachment.previewUrl));
  }, []);

  const featureRequestMessage = useMemo(
    () => createFeatureRequestMessage(featureRequestChoice, customFeatureRequestText),
    [customFeatureRequestText, featureRequestChoice],
  );

  const clearAttachments = useCallback(() => {
    const current = attachmentsRef.current;
    current.forEach((attachment) => revokePreviewUrl(attachment.previewUrl));
    attachmentsRef.current = [];
    setAttachments([]);
    setAttachmentError(null);
  }, []);

  const canSubmit = useMemo(() => {
    if (!feedbackConfigured || feedbackSubmitting || !feedbackKind) {
      return false;
    }

    if (feedbackKind === 'feature-request') {
      return featureRequestMessage.length > 0;
    }

    return normalizeMessage(feedbackText).length > 0;
  }, [
    feedbackConfigured,
    feedbackKind,
    feedbackSubmitting,
    feedbackText,
    featureRequestMessage,
  ]);

  const resetFeedback = useCallback(() => {
    setFeedbackStep('category');
    setFeedbackKind(null);
    setFeatureRequestChoice(null);
    setCustomFeatureRequestText('');
    setFeedbackText('');
    setIncludeLogs(true);
    clearAttachments();
    setFeedbackSubmitted(false);
    setFeedbackError(null);
  }, [clearAttachments]);

  const selectFeedbackKind = useCallback((kind: FeedbackKind) => {
    clearAttachments();
    setFeedbackKind(kind);
    setFeedbackSubmitted(false);
    setFeedbackError(null);

    if (kind === 'feature-request') {
      setFeedbackStep('feature-request');
      setIncludeLogs(false);
      return;
    }

    setFeedbackStep('message');
    setIncludeLogs(kind === 'bug-report');
  }, [clearAttachments]);

  const goBack = useCallback(() => {
    if (feedbackSubmitting) {
      return;
    }

    clearAttachments();
    setFeedbackStep('category');
    setFeedbackSubmitted(false);
    setFeedbackError(null);
  }, [clearAttachments, feedbackSubmitting]);

  const addAttachmentFiles = useCallback((files: FileList | File[] | null) => {
    const nextFiles = Array.from(files ?? []);
    if (nextFiles.length === 0) {
      return;
    }

    const current = attachmentsRef.current;
    const availableSlots = FEEDBACK_ATTACHMENT_LIMIT - current.length;

    if (availableSlots <= 0) {
      setAttachmentError(`You can attach up to ${FEEDBACK_ATTACHMENT_LIMIT} images.`);
      return;
    }

    const accepted: FeedbackAttachmentDraft[] = [];
    let nextError: string | null = null;

    for (const file of nextFiles) {
      if (accepted.length >= availableSlots) {
        nextError = `You can attach up to ${FEEDBACK_ATTACHMENT_LIMIT} images.`;
        break;
      }

      if (!ACCEPTED_ATTACHMENT_TYPES.has(file.type)) {
        nextError = 'Use PNG, JPG, or WebP images.';
        continue;
      }

      if (file.size > FEEDBACK_ATTACHMENT_MAX_BYTES) {
        nextError = 'Each image must be 5 MB or smaller.';
        continue;
      }

      accepted.push({
        id: crypto.randomUUID(),
        file,
        previewUrl: createPreviewUrl(file),
      });
    }

    if (accepted.length > 0) {
      const nextAttachments = [...current, ...accepted];
      attachmentsRef.current = nextAttachments;
      setAttachments(nextAttachments);
    }

    setAttachmentError(nextError);
  }, []);

  const removeAttachment = useCallback((attachmentId: string) => {
    const current = attachmentsRef.current;
    const target = current.find((attachment) => attachment.id === attachmentId);

    if (!target) {
      return;
    }

    revokePreviewUrl(target.previewUrl);
    const nextAttachments = current.filter((attachment) => attachment.id !== attachmentId);
    attachmentsRef.current = nextAttachments;
    setAttachments(nextAttachments);
    setAttachmentError(null);
  }, []);

  const submitFeedback = useCallback(async () => {
    const endpoint = getFeedbackEndpoint();
    const message =
      feedbackKind === 'feature-request'
        ? featureRequestMessage
        : normalizeMessage(feedbackText);

    if (!endpoint || !feedbackKind || !message || feedbackSubmitting) {
      return;
    }

    setFeedbackSubmitting(true);
    setFeedbackError(null);

    try {
      const shouldIncludeLogs = feedbackKind === 'bug-report' && includeLogs;
      const logs = shouldIncludeLogs ? await requestFullLogs() : [];
      const payload = {
        kind: feedbackKind,
        message,
        includeLogs: shouldIncludeLogs,
        logs,
        featureRequestChoice:
          feedbackKind === 'feature-request' ? featureRequestChoice : null,
        featureRequestDetail:
          feedbackKind === 'feature-request' && featureRequestChoice === 'custom'
            ? message
            : null,
        extensionVersion: chrome.runtime.getManifest().version,
      };
      const formData = new FormData();
      formData.append('payload', JSON.stringify(payload));

      for (const attachment of attachmentsRef.current) {
        formData.append('attachments', attachment.file, attachment.file.name);
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Feedback request failed (${response.status})`);
      }

      setFeedbackSubmitted(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFeedbackError(message);
      console.error('ask-em: failed to submit feedback', error);
    } finally {
      setFeedbackSubmitting(false);
    }
  }, [
    feedbackKind,
    feedbackSubmitting,
    feedbackText,
    featureRequestChoice,
    featureRequestMessage,
    includeLogs,
    clearAttachments,
  ]);

  return {
    feedbackConfigured,
    feedbackStep,
    feedbackKind,
    featureRequestChoice,
    customFeatureRequestText,
    feedbackText,
    includeLogs,
    attachments,
    attachmentError,
    feedbackSubmitting,
    feedbackSubmitted,
    feedbackError,
    canSubmit,
    setFeedbackText,
    setIncludeLogs,
    addAttachmentFiles,
    removeAttachment,
    setFeatureRequestChoice,
    setCustomFeatureRequestText,
    resetFeedback,
    selectFeedbackKind,
    goBack,
    submitFeedback,
  };
}
