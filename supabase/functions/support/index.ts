import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const ALLOWED_PROVIDER_REQUESTS = new Set([
  'Perplexity',
  'Grok',
  'Meta AI',
  'Mistral',
  'Qwen',
  'Kimi',
  'Doubao',
  'Poe',
]);

const FEEDBACK_KINDS = new Set([
  'feature-request',
  'bug-report',
  'say-something-nice',
]);

const FEATURE_REQUEST_CHOICES = new Set([
  'multilingual',
  'incognito-chat',
  'history',
  'custom',
]);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

function getSupabaseClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!url || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function normalizeMessage(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 4000) : '';
}

function normalizeExtensionVersion(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().slice(0, 32);
  return normalized.length > 0 ? normalized : null;
}

function normalizeProviderList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .filter((provider): provider is string => typeof provider === 'string')
        .map((provider) => provider.trim())
        .filter((provider) => ALLOWED_PROVIDER_REQUESTS.has(provider)),
    ),
  ).slice(0, ALLOWED_PROVIDER_REQUESTS.size);
}

function normalizeLogs(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, 350)
    .map((entry) => ({
      id: typeof entry?.id === 'string' ? entry.id : crypto.randomUUID(),
      timestamp: Number.isFinite(entry?.timestamp) ? entry.timestamp : Date.now(),
      level: entry?.level === 'warn' || entry?.level === 'error' ? entry.level : 'info',
      scope: entry?.scope === 'content' ? 'content' : 'background',
      provider: typeof entry?.provider === 'string' ? entry.provider : null,
      workspaceId: typeof entry?.workspaceId === 'string' ? entry.workspaceId : null,
      message: typeof entry?.message === 'string' ? entry.message.slice(0, 500) : '',
      detail: typeof entry?.detail === 'string' ? entry.detail.slice(0, 4000) : null,
    }))
    .filter((entry) => entry.message.length > 0);
}

async function handleProviderRequest(body: unknown) {
  const requestedProviders = normalizeProviderList((body as { requestedProviders?: unknown })?.requestedProviders);

  if (requestedProviders.length === 0) {
    return json(
      { ok: false, error: 'requestedProviders must include at least one supported provider' },
      400,
    );
  }

  const submissionId = crypto.randomUUID();
  const extensionVersion = normalizeExtensionVersion((body as { extensionVersion?: unknown })?.extensionVersion);
  const supabase = getSupabaseClient();
  const rows = requestedProviders.map((provider) => ({
    submission_id: submissionId,
    provider,
    extension_version: extensionVersion,
  }));
  const { error } = await supabase.from('provider_requests').insert(rows);

  if (error) {
    return json({ ok: false, error: error.message }, 500);
  }

  return json({
    ok: true,
    submissionId,
    submittedProviders: requestedProviders,
  });
}

async function handleProviderStats() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('provider_requests').select('provider,submission_id');

  if (error) {
    return json({ ok: false, error: error.message }, 500);
  }

  const providerTotals = new Map<string, number>();
  const submissionIds = new Set<string>();

  for (const row of data ?? []) {
    providerTotals.set(row.provider, (providerTotals.get(row.provider) ?? 0) + 1);
    if (typeof row.submission_id === 'string') {
      submissionIds.add(row.submission_id);
    }
  }

  return json({
    ok: true,
    submissions: submissionIds.size,
    providers: Array.from(providerTotals.entries())
      .map(([provider, total]) => ({ provider, total }))
      .sort((left, right) => right.total - left.total || left.provider.localeCompare(right.provider)),
  });
}

async function handleFeedback(body: unknown) {
  const input = body as {
    kind?: unknown;
    message?: unknown;
    includeLogs?: unknown;
    logs?: unknown;
    featureRequestChoice?: unknown;
    featureRequestDetail?: unknown;
    extensionVersion?: unknown;
  };

  const kind = typeof input.kind === 'string' ? input.kind : '';
  const message = normalizeMessage(input.message);

  if (!FEEDBACK_KINDS.has(kind)) {
    return json({ ok: false, error: 'kind is required' }, 400);
  }

  if (!message) {
    return json({ ok: false, error: 'message is required' }, 400);
  }

  const includeLogs = kind !== 'feature-request' && Boolean(input.includeLogs);
  const logs = includeLogs ? normalizeLogs(input.logs) : [];
  const featureRequestChoice =
    typeof input.featureRequestChoice === 'string' && FEATURE_REQUEST_CHOICES.has(input.featureRequestChoice)
      ? input.featureRequestChoice
      : null;
  const featureRequestDetail =
    featureRequestChoice === 'custom' ? normalizeMessage(input.featureRequestDetail) : null;
  const extensionVersion = normalizeExtensionVersion(input.extensionVersion);
  const supabase = getSupabaseClient();
  const { data: feedbackSubmission, error: feedbackError } = await supabase
    .from('feedback_submissions')
    .insert({
      kind,
      message,
      include_logs: includeLogs,
      log_count: logs.length,
      feature_request_choice: featureRequestChoice,
      feature_request_detail: featureRequestDetail,
      extension_version: extensionVersion,
    })
    .select('id')
    .single();

  if (feedbackError || !feedbackSubmission?.id) {
    return json({ ok: false, error: feedbackError?.message ?? 'Insert failed' }, 500);
  }

  if (logs.length > 0) {
    const { error: logsError } = await supabase.from('feedback_logs').insert({
      feedback_id: feedbackSubmission.id,
      payload_json: logs,
    });

    if (logsError) {
      return json({ ok: false, error: logsError.message }, 500);
    }
  }

  return json({
    ok: true,
    feedbackId: feedbackSubmission.id,
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }

  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/+$/, '');

  if (request.method === 'GET' && pathname.endsWith('/health')) {
    return json({ ok: true });
  }

  let body: unknown = null;

  if (request.method === 'POST') {
    body = await request.json().catch(() => null);
    if (body === null) {
      return json({ ok: false, error: 'Invalid JSON body' }, 400);
    }
  }

  if (request.method === 'POST' && pathname.endsWith('/requests/providers')) {
    return await handleProviderRequest(body);
  }

  if (request.method === 'GET' && pathname.endsWith('/requests/providers/stats')) {
    return await handleProviderStats();
  }

  if (request.method === 'POST' && pathname.endsWith('/feedback')) {
    return await handleFeedback(body);
  }

  return json({ ok: false, error: 'Not found' }, 404);
});
