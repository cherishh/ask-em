function normalizeOrigin(value: string | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '');
}

export function getSupportApiBaseUrl(): string {
  return normalizeOrigin(
    import.meta.env.WXT_SUPPORT_API_BASE_URL ?? import.meta.env.WXT_SUPPORT_API_ORIGIN,
  );
}

export function getMoreProvidersRequestEndpoint(): string {
  const supportApiBaseUrl = getSupportApiBaseUrl();

  if (supportApiBaseUrl) {
    return `${supportApiBaseUrl}/requests/providers`;
  }

  return import.meta.env.WXT_MORE_PROVIDERS_REQUEST_ENDPOINT?.trim() ?? '';
}

export function getFeedbackEndpoint(): string {
  const supportApiBaseUrl = getSupportApiBaseUrl();

  if (supportApiBaseUrl) {
    return `${supportApiBaseUrl}/feedback`;
  }

  const explicitEndpoint = import.meta.env.WXT_FEEDBACK_ENDPOINT?.trim();
  if (explicitEndpoint) {
    return explicitEndpoint;
  }

  const requestEndpoint = getMoreProvidersRequestEndpoint();
  if (!requestEndpoint) {
    return '';
  }

  return `${new URL(requestEndpoint).origin}/feedback`;
}
