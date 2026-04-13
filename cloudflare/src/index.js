const ALLOWED_PROVIDERS = new Set([
  'Perplexity',
  'Grok',
  'Meta AI',
  'Mistral',
  'Qwen',
  'Kimi',
  'Doubao',
  'Poe',
]);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, init = {}) {
  const headers = new Headers(init.headers ?? {});
  headers.set('Content-Type', 'application/json; charset=utf-8');

  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value);
  }

  return new Response(JSON.stringify(data), {
    ...init,
    headers,
  });
}

function normalizeRequestedProviders(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .filter((provider) => typeof provider === 'string')
        .map((provider) => provider.trim())
        .filter((provider) => ALLOWED_PROVIDERS.has(provider)),
    ),
  ).slice(0, ALLOWED_PROVIDERS.size);
}

function normalizeFeedbackMessage(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().slice(0, 4000);
}

function normalizeLogs(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 350).map((entry) => ({
    id: typeof entry?.id === 'string' ? entry.id : crypto.randomUUID(),
    timestamp: Number.isFinite(entry?.timestamp) ? entry.timestamp : Date.now(),
    level: entry?.level === 'warn' || entry?.level === 'error' ? entry.level : 'info',
    scope: entry?.scope === 'content' ? 'content' : 'background',
    provider: typeof entry?.provider === 'string' ? entry.provider : null,
    workspaceId: typeof entry?.workspaceId === 'string' ? entry.workspaceId : null,
    message: typeof entry?.message === 'string' ? entry.message.slice(0, 500) : '',
    detail: typeof entry?.detail === 'string' ? entry.detail.slice(0, 4000) : null,
  })).filter((entry) => entry.message.length > 0);
}

async function handleCreateRequest(request, env) {
  let body;

  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const requestedProviders = normalizeRequestedProviders(body?.requestedProviders);
  if (requestedProviders.length === 0) {
    return json({ ok: false, error: 'requestedProviders must include at least one supported provider' }, { status: 400 });
  }

  const extensionVersion =
    typeof body?.extensionVersion === 'string' && body.extensionVersion.trim().length > 0
      ? body.extensionVersion.trim().slice(0, 32)
      : null;
  const submissionId = crypto.randomUUID();

  const statements = requestedProviders.map((provider) =>
    env.DB.prepare(
      'INSERT INTO model_requests (submission_id, provider, extension_version) VALUES (?, ?, ?)',
    ).bind(submissionId, provider, extensionVersion),
  );

  await env.DB.batch(statements);

  return json({
    ok: true,
    submissionId,
    submittedProviders: requestedProviders,
  });
}

async function handleStats(env) {
  const counts = await env.DB.prepare(
    'SELECT provider, COUNT(*) AS total FROM model_requests GROUP BY provider ORDER BY total DESC, provider ASC',
  ).all();
  const submissionCount = await env.DB.prepare(
    'SELECT COUNT(DISTINCT submission_id) AS total FROM model_requests',
  ).first();

  return json({
    ok: true,
    submissions: Number(submissionCount?.total ?? 0),
    providers: (counts.results ?? []).map((row) => ({
      provider: row.provider,
      total: Number(row.total ?? 0),
    })),
  });
}

async function handleFeedback(request, env) {
  let body;

  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const message = normalizeFeedbackMessage(body?.message);
  if (!message) {
    return json({ ok: false, error: 'message is required' }, { status: 400 });
  }

  const includeLogs = Boolean(body?.includeLogs);
  const logs = includeLogs ? normalizeLogs(body?.logs) : [];
  const extensionVersion =
    typeof body?.extensionVersion === 'string' && body.extensionVersion.trim().length > 0
      ? body.extensionVersion.trim().slice(0, 32)
      : null;
  const feedbackId = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO feedback_submissions (id, message, include_logs, log_count, extension_version)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(feedbackId, message, includeLogs ? 1 : 0, logs.length, extensionVersion).run();

  if (includeLogs && logs.length > 0) {
    await env.DB.prepare(
      'INSERT INTO feedback_logs (feedback_id, payload_json) VALUES (?, ?)',
    ).bind(feedbackId, JSON.stringify(logs)).run();
  }

  return json({
    ok: true,
    feedbackId,
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    const url = new URL(request.url);

    if (url.pathname === '/requests/models' && request.method === 'POST') {
      return handleCreateRequest(request, env);
    }

    if (url.pathname === '/requests/models/stats' && request.method === 'GET') {
      return handleStats(env);
    }

    if (url.pathname === '/feedback' && request.method === 'POST') {
      return handleFeedback(request, env);
    }

    return json({ ok: false, error: 'Not found' }, { status: 404 });
  },
};
