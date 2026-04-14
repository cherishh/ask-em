import { useCallback, useMemo, useState } from 'react';
import { requestFullLogs } from '../popup-runtime';
import {
  type FeedbackKind,
  type FeedbackStep,
  type FeatureRequestChoice,
  getFeatureRequestLabel,
} from '../feedback';
import { getFeedbackEndpoint } from '../support-endpoints';

const FEEDBACK_MAX_LENGTH = 4000;

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

export function useFeedback() {
  const feedbackConfigured = getFeedbackEndpoint().length > 0;
  const [feedbackStep, setFeedbackStep] = useState<FeedbackStep>('category');
  const [feedbackKind, setFeedbackKind] = useState<FeedbackKind | null>(null);
  const [featureRequestChoice, setFeatureRequestChoice] = useState<FeatureRequestChoice | null>(null);
  const [customFeatureRequestText, setCustomFeatureRequestText] = useState('');
  const [feedbackText, setFeedbackText] = useState('');
  const [includeLogs, setIncludeLogs] = useState(true);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  const featureRequestMessage = useMemo(
    () => createFeatureRequestMessage(featureRequestChoice, customFeatureRequestText),
    [customFeatureRequestText, featureRequestChoice],
  );

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
    setFeedbackSubmitted(false);
    setFeedbackError(null);
  }, []);

  const selectFeedbackKind = useCallback((kind: FeedbackKind) => {
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
  }, []);

  const goBack = useCallback(() => {
    if (feedbackSubmitting) {
      return;
    }

    setFeedbackStep('category');
    setFeedbackSubmitted(false);
    setFeedbackError(null);
  }, [feedbackSubmitting]);

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
      const shouldIncludeLogs = feedbackKind !== 'feature-request' && includeLogs;
      const logs = shouldIncludeLogs ? await requestFullLogs() : [];
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
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
        }),
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
  ]);

  return {
    feedbackConfigured,
    feedbackStep,
    feedbackKind,
    featureRequestChoice,
    customFeatureRequestText,
    feedbackText,
    includeLogs,
    feedbackSubmitting,
    feedbackSubmitted,
    feedbackError,
    canSubmit,
    setFeedbackText,
    setIncludeLogs,
    setFeatureRequestChoice,
    setCustomFeatureRequestText,
    resetFeedback,
    selectFeedbackKind,
    goBack,
    submitFeedback,
  };
}
