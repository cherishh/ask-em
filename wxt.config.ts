import { defineConfig } from 'wxt';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type EnvMap = Record<string, string | undefined>;

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

function parseEnvFile(path: string): EnvMap {
  if (!existsSync(path)) {
    return {};
  }

  const env: EnvMap = {};

  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match?.[1] || !match[1].startsWith('WXT_')) {
      continue;
    }

    const rawValue = match[2]?.trim() ?? '';
    const quote = rawValue[0];
    env[match[1]] =
      (quote === '"' || quote === "'") && rawValue.endsWith(quote)
        ? rawValue.slice(1, -1)
        : rawValue.replace(/\s+#.*$/, '').trim();
  }

  return env;
}

function loadWxtEnv(mode: string): EnvMap {
  const root = process.cwd();
  const fileEnv = [
    '.env',
    '.env.local',
    `.env.${mode}`,
    `.env.${mode}.local`,
  ].reduce<EnvMap>(
    (env, filename) => ({
      ...env,
      ...parseEnvFile(join(root, filename)),
    }),
    {},
  );
  const processEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[0].startsWith('WXT_') && entry[1] !== undefined,
    ),
  );

  return {
    ...fileEnv,
    ...processEnv,
  };
}

function getSupportHostPermissions(env: EnvMap): string[] {
  const permissions = [
    toOriginPermission(env.WXT_SUPPORT_API_BASE_URL),
    toOriginPermission(env.WXT_SUPPORT_API_ORIGIN),
    toOriginPermission(env.WXT_MORE_PROVIDERS_REQUEST_ENDPOINT),
    toOriginPermission(env.WXT_FEEDBACK_ENDPOINT),
  ].filter((value): value is string => Boolean(value));

  return Array.from(new Set(permissions));
}

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: ({ mode }) => {
    const env = loadWxtEnv(mode);

    return {
      name: "ask'em",
      description: 'Sync chat messages across AI apps',
      version: '0.1.0',
      permissions: ['storage', 'tabs'],
      host_permissions: getSupportHostPermissions(env),
      icons: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        128: 'icon/128.png',
      },
    };
  },
});
