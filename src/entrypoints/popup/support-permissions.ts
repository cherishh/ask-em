function getEndpointOriginPermission(endpoint: string): string | null {
  try {
    return `${new URL(endpoint).origin}/*`;
  } catch {
    return null;
  }
}

export async function ensureSupportEndpointPermission(endpoint: string): Promise<boolean> {
  const origin = getEndpointOriginPermission(endpoint);

  if (
    !origin ||
    typeof chrome === 'undefined' ||
    typeof chrome.permissions?.request !== 'function'
  ) {
    return true;
  }

  const permission: chrome.permissions.Permissions = {
    origins: [origin],
  };

  return chrome.permissions.request(permission);
}
