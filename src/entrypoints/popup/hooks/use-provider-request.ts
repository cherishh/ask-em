import { useCallback, useState } from 'react';
import { getMoreProvidersRequestEndpoint } from '../support-endpoints';

const MORE_PROVIDERS_REQUEST_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const MORE_PROVIDERS_REQUEST_STORAGE_KEY = 'askem-more-providers-last-submitted-at';

function getMoreProvidersCooldownUntil(): number | null {
  const rawValue = window.localStorage.getItem(MORE_PROVIDERS_REQUEST_STORAGE_KEY);

  if (!rawValue) {
    return null;
  }

  const submittedAt = Number(rawValue);
  if (!Number.isFinite(submittedAt)) {
    return null;
  }

  const cooldownUntil = submittedAt + MORE_PROVIDERS_REQUEST_COOLDOWN_MS;
  return cooldownUntil > Date.now() ? cooldownUntil : null;
}

function setMoreProvidersSubmittedNow() {
  window.localStorage.setItem(MORE_PROVIDERS_REQUEST_STORAGE_KEY, String(Date.now()));
}

export function formatCooldownRemaining(cooldownUntil: number): string {
  const remainingMs = Math.max(0, cooldownUntil - Date.now());
  const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));

  if (remainingDays <= 1) {
    return 'tomorrow';
  }

  return `in ${remainingDays} days`;
}

async function submitMoreProviderRequest(
  requestedProviders: string[],
): Promise<'submitted' | 'not-configured'> {
  const endpoint = getMoreProvidersRequestEndpoint();

  if (!endpoint) {
    return 'not-configured';
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requestedProviders,
      extensionVersion: chrome.runtime.getManifest().version,
    }),
  });

  if (!response.ok) {
    throw new Error(`More provider request failed (${response.status})`);
  }

  return 'submitted';
}

export function useProviderRequest() {
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [requestedProviders, setRequestedProviders] = useState<string[]>([]);
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [requestSubmitted, setRequestSubmitted] = useState(false);
  const [requestEndpointNotConfigured, setRequestEndpointNotConfigured] = useState(false);
  const [requestCooldownUntil, setRequestCooldownUntil] = useState<number | null>(null);

  const toggleRequestedProvider = useCallback((provider: string) => {
    setRequestedProviders((current) =>
      current.includes(provider)
        ? current.filter((item) => item !== provider)
        : [...current, provider],
    );
  }, []);

  const openRequestModal = useCallback(() => {
    setRequestedProviders([]);
    setRequestSubmitted(false);
    setRequestEndpointNotConfigured(false);
    setRequestCooldownUntil(getMoreProvidersCooldownUntil());
    setRequestModalOpen(true);
  }, []);

  const closeRequestModal = useCallback(() => {
    if (requestSubmitting) {
      return;
    }

    setRequestModalOpen(false);
  }, [requestSubmitting]);

  const submitRequestModal = useCallback(async () => {
    if (requestSubmitting || requestedProviders.length === 0 || requestCooldownUntil) {
      return;
    }

    setRequestSubmitting(true);

    try {
      const status = await submitMoreProviderRequest(requestedProviders);
      if (status === 'not-configured') {
        setRequestEndpointNotConfigured(true);
        return;
      }

      setMoreProvidersSubmittedNow();
      setRequestCooldownUntil(getMoreProvidersCooldownUntil());
      setRequestSubmitted(true);
    } catch (error) {
      console.error('ask-em: failed to submit more provider request', error);
    } finally {
      setRequestSubmitting(false);
    }
  }, [requestCooldownUntil, requestSubmitting, requestedProviders]);

  const resetRequestCooldownForDev = useCallback(() => {
    window.localStorage.removeItem(MORE_PROVIDERS_REQUEST_STORAGE_KEY);
    setRequestCooldownUntil(null);
  }, []);

  return {
    requestModalOpen,
    requestedProviders,
    requestSubmitting,
    requestSubmitted,
    requestEndpointNotConfigured,
    requestCooldownUntil,
    toggleRequestedProvider,
    openRequestModal,
    closeRequestModal,
    submitRequestModal,
    resetRequestCooldownForDev,
  };
}
