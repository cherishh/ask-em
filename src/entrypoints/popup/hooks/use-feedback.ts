import { useCallback, useState } from 'react';
import { requestFullLogs } from '../popup-runtime';

const FEEDBACK_MAX_LENGTH = 4000;

function getFeedbackEndpoint(): string {
  const explicitEndpoint = import.meta.env.WXT_FEEDBACK_ENDPOINT?.trim();
  if (explicitEndpoint) {
    return explicitEndpoint;
  }

  const requestEndpoint = import.meta.env.WXT_MORE_PROVIDERS_REQUEST_ENDPOINT?.trim();
  if (!requestEndpoint) {
    return '';
  }

  return `${new URL(requestEndpoint).origin}/feedback`;
}

async function ensureHostPermission(endpoint: string): Promise<void> {
  const originPattern = `${new URL(endpoint).origin}/*`;
  const hasPermission = await chrome.permissions?.contains?.({
    origins: [originPattern],
  });

  if (hasPermission) {
    return;
  }

  const granted = await chrome.permissions?.request?.({
    origins: [originPattern],
  });

  if (!granted) {
    throw new Error(`Host permission denied for ${originPattern}`);
  }
}

export function useFeedback() {
  const [feedbackText, setFeedbackText] = useState('');
  const [includeLogs, setIncludeLogs] = useState(true);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  const resetFeedback = useCallback(() => {
    setFeedbackText('');
    setIncludeLogs(true);
    setFeedbackSubmitted(false);
    setFeedbackError(null);
  }, []);

  const submitFeedback = useCallback(async () => {
    const endpoint = getFeedbackEndpoint();
    const message = feedbackText.trim();

    if (!endpoint || !message || feedbackSubmitting) {
      return;
    }

    setFeedbackSubmitting(true);
    setFeedbackError(null);

    try {
      await ensureHostPermission(endpoint);

      const logs = includeLogs ? await requestFullLogs() : [];
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: message.slice(0, FEEDBACK_MAX_LENGTH),
          includeLogs,
          logs,
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
  }, [feedbackSubmitting, feedbackText, includeLogs]);

  return {
    feedbackText,
    includeLogs,
    feedbackSubmitting,
    feedbackSubmitted,
    feedbackError,
    setFeedbackText,
    setIncludeLogs,
    resetFeedback,
    submitFeedback,
  };
}
