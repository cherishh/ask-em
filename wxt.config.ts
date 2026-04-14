import { defineConfig } from 'wxt';

function toOriginPermission(urlValue: string | undefined): string | null {
  const normalized = urlValue?.trim();
  if (!normalized) {
    return null;
  }

  try {
    return `${new URL(normalized).origin}/*`;
  } catch {
    return null;
  }
}

function getSupportHostPermissions(): string[] {
  const permissions = [
    toOriginPermission(process.env.WXT_SUPPORT_API_BASE_URL),
    toOriginPermission(process.env.WXT_SUPPORT_API_ORIGIN),
    toOriginPermission(process.env.WXT_MORE_PROVIDERS_REQUEST_ENDPOINT),
    toOriginPermission(process.env.WXT_FEEDBACK_ENDPOINT),
  ].filter((value): value is string => Boolean(value));

  return Array.from(new Set(permissions));
}

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: "ask'em",
    description: 'Sync prompts across AI chat providers',
    version: '0.1.0',
    permissions: ['storage', 'tabs'],
    host_permissions: getSupportHostPermissions(),
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
  },
});
