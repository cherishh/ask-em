import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { trimDebugLogsForFeedback } from '../../../runtime/debug-log-retention';
import type { DebugLogEntry, StatusResponseMessage } from '../../../runtime/protocol';
import { requestFullLogs, requestStatus } from '../popup-runtime';
import {
  FEEDBACK_ATTACHMENT_ACCEPT,
  FEEDBACK_ATTACHMENT_LIMIT,
  FEEDBACK_ATTACHMENT_MAX_BYTES,
  type FeedbackKind,
  type FeedbackStep,
} from '../feedback';
import { getFeedbackEndpoint } from '../support-endpoints';
import { ensureSupportEndpointPermission } from '../support-permissions';

const FEEDBACK_MAX_LENGTH = 4000;
const ACCEPTED_ATTACHMENT_TYPES = new Set(
  FEEDBACK_ATTACHMENT_ACCEPT.split(',').map((value) => value.trim()),
);

export type FeedbackAttachmentDraft = {
  id: string;
  file: File;
  previewUrl: string;
};

type BugReportEnvironment = {
  clientTimestamp: string;
  ianaTimeZone: string | null;
  browserLanguage: string | null;
  browserLanguages: string[];
  browserName: string | null;
  browserVersion: string | null;
  os: string | null;
  activeTabTitle: string | null;
};

function normalizeMessage(value: string): string {
  return value.trim().slice(0, FEEDBACK_MAX_LENGTH);
}

function normalizeEnvironmentString(value: unknown, maxLength = 120): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().slice(0, maxLength);
  return normalized.length > 0 ? normalized : null;
}

function parseBrowserFromUserAgent(userAgent: string): Pick<BugReportEnvironment, 'browserName' | 'browserVersion'> {
  const patterns: Array<{ name: string; pattern: RegExp }> = [
    { name: 'Microsoft Edge', pattern: /\bEdg\/([\d.]+)/ },
    { name: 'Opera', pattern: /\bOPR\/([\d.]+)/ },
    { name: 'Firefox', pattern: /\bFirefox\/([\d.]+)/ },
    { name: 'Chrome', pattern: /\bChrome\/([\d.]+)/ },
    { name: 'Safari', pattern: /\bVersion\/([\d.]+).*?\bSafari\// },
  ];

  for (const { name, pattern } of patterns) {
    const match = userAgent.match(pattern);
    if (match?.[1]) {
      return {
        browserName: name,
        browserVersion: match[1].slice(0, 64),
      };
    }
  }

  return {
    browserName: null,
    browserVersion: null,
  };
}

function getIanaTimeZone(): string | null {
  try {
    return normalizeEnvironmentString(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return null;
  }
}

async function getPlatformOs(): Promise<string | null> {
  if (typeof chrome === 'undefined' || typeof chrome.runtime?.getPlatformInfo !== 'function') {
    return null;
  }

  return await new Promise((resolve) => {
    chrome.runtime.getPlatformInfo((platformInfo) => {
      resolve(normalizeEnvironmentString(platformInfo.os));
    });
  });
}

async function getActiveTabTitle(): Promise<string | null> {
  if (typeof chrome === 'undefined' || typeof chrome.tabs?.query !== 'function') {
    return null;
  }

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return normalizeEnvironmentString(tabs[0]?.title, 500);
  } catch {
    return null;
  }
}

async function createBugReportEnvironment(): Promise<BugReportEnvironment> {
  const userAgent = normalizeEnvironmentString(navigator.userAgent, 1000) ?? '';
  const browser = parseBrowserFromUserAgent(userAgent);
  const [os, activeTabTitle] = await Promise.all([
    getPlatformOs(),
    getActiveTabTitle(),
  ]);

  return {
    clientTimestamp: new Date().toISOString(),
    ianaTimeZone: getIanaTimeZone(),
    browserLanguage: normalizeEnvironmentString(navigator.language),
    browserLanguages: Array.isArray(navigator.languages)
      ? navigator.languages
          .map((language) => normalizeEnvironmentString(language))
          .filter((language): language is string => Boolean(language))
          .slice(0, 10)
      : [],
    browserName: browser.browserName,
    browserVersion: browser.browserVersion,
    os,
    activeTabTitle,
  };
}

function createFeedbackContextLog(
  status: StatusResponseMessage | null,
  attachmentCount: number,
): DebugLogEntry {
  const detail = status
    ? {
        workspaceCount: status.workspaces.length,
        workspaceLimit: status.workspaceLimit,
        globalSyncEnabled: status.globalSyncEnabled,
        autoSyncNewChatsEnabled: status.autoSyncNewChatsEnabled,
        pauseAfterFirstFanOutEnabled: status.pauseAfterFirstFanOutEnabled,
        debugLoggingEnabled: status.debugLoggingEnabled,
        showDiagnostics: status.showDiagnostics,
        closeTabsOnDeleteSet: status.closeTabsOnDeleteSet,
        defaultEnabledProviders: status.defaultEnabledProviders,
        defaultFanOutProviders: status.defaultFanOutProviders,
        attachmentCount,
        workspaces: status.workspaces.map((workspaceSummary) => ({
          workspaceId: workspaceSummary.workspace.id,
          enabledProviders: workspaceSummary.workspace.enabledProviders,
          pendingSource: workspaceSummary.workspace.pendingSource ?? null,
          memberStates: workspaceSummary.memberStates,
          memberIssues: workspaceSummary.memberIssues,
        })),
      }
    : {
        statusUnavailable: true,
        attachmentCount,
      };

  return {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    level: 'info',
    scope: 'background',
    message: 'Feedback context snapshot',
    detail: JSON.stringify(detail),
  };
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

    return normalizeMessage(feedbackText).length > 0;
  }, [
    feedbackConfigured,
    feedbackKind,
    feedbackSubmitting,
    feedbackText,
  ]);

  const resetFeedback = useCallback(() => {
    setFeedbackStep('category');
    setFeedbackKind(null);
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
    const message = normalizeMessage(feedbackText);

    if (!endpoint || !feedbackKind || !message || feedbackSubmitting) {
      return;
    }

    try {
      const permissionRequest = ensureSupportEndpointPermission(endpoint);
      setFeedbackSubmitting(true);
      setFeedbackError(null);

      const hasEndpointPermission = await permissionRequest;
      if (!hasEndpointPermission) {
        throw new Error('Allow support endpoint access to send feedback.');
      }

      const shouldIncludeLogs = feedbackKind === 'bug-report' && includeLogs;
      const [rawLogs, status] = shouldIncludeLogs
        ? await Promise.all([requestFullLogs(), requestStatus()])
        : [[], null] as const;
      const logs = shouldIncludeLogs
        ? trimDebugLogsForFeedback([
            ...rawLogs,
            createFeedbackContextLog(status, attachmentsRef.current.length),
          ])
        : [];
      const payload = {
        kind: feedbackKind,
        message,
        includeLogs: shouldIncludeLogs,
        logs,
        environment: feedbackKind === 'bug-report' ? await createBugReportEnvironment() : null,
        featureRequestChoice: null,
        featureRequestDetail: null,
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
    includeLogs,
  ]);

  return {
    feedbackConfigured,
    feedbackStep,
    feedbackKind,
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
    resetFeedback,
    selectFeedbackKind,
    goBack,
    submitFeedback,
  };
}
