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
  'more-providers',
  'switch-models',
  'image-paste',
  'custom',
]);

const FEEDBACK_ATTACHMENT_BUCKET = 'feedback-attachments';
const FEEDBACK_ATTACHMENT_LIMIT = 3;
const FEEDBACK_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
const FEEDBACK_ATTACHMENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

type NormalizedAttachment = {
  file: File;
  originalName: string;
  contentType: string;
  byteSize: number;
  sortOrder: number;
};

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

function normalizeFileName(value: unknown, fallback: string) {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value
    .trim()
    .replace(/[^\w.\- ]+/g, '')
    .slice(0, 120);

  return normalized.length > 0 ? normalized : fallback;
}

function getAttachmentExtension(contentType: string, originalName: string) {
  if (contentType === 'image/png') {
    return 'png';
  }

  if (contentType === 'image/webp') {
    return 'webp';
  }

  const normalizedName = originalName.toLowerCase();
  if (normalizedName.endsWith('.jpeg')) {
    return 'jpeg';
  }

  return 'jpg';
}

function normalizeAttachmentFiles(files: File[]) {
  if (files.length > FEEDBACK_ATTACHMENT_LIMIT) {
    return {
      attachments: [],
      error: `Attach up to ${FEEDBACK_ATTACHMENT_LIMIT} images.`,
    };
  }

  const attachments: NormalizedAttachment[] = [];

  for (const [index, file] of files.entries()) {
    if (!FEEDBACK_ATTACHMENT_TYPES.has(file.type)) {
      return {
        attachments: [],
        error: 'Only PNG, JPG, or WebP images are supported.',
      };
    }

    if (file.size > FEEDBACK_ATTACHMENT_MAX_BYTES) {
      return {
        attachments: [],
        error: 'Each image must be 5 MB or smaller.',
      };
    }

    attachments.push({
      file,
      originalName: normalizeFileName(file.name, `screenshot-${index + 1}`),
      contentType: file.type,
      byteSize: file.size,
      sortOrder: index,
    });
  }

  return { attachments, error: null };
}

async function cleanupFeedbackSubmission(
  supabase: ReturnType<typeof getSupabaseClient>,
  feedbackId: string,
  storagePaths: string[],
) {
  if (storagePaths.length > 0) {
    await supabase.storage.from(FEEDBACK_ATTACHMENT_BUCKET).remove(storagePaths);
  }

  await supabase.from('feedback_submissions').delete().eq('id', feedbackId);
}

async function uploadFeedbackAttachments(
  supabase: ReturnType<typeof getSupabaseClient>,
  feedbackId: string,
  attachments: NormalizedAttachment[],
) {
  const uploadedPaths: string[] = [];
  const rows: Array<{
    feedback_id: string;
    storage_path: string;
    original_name: string;
    content_type: string;
    byte_size: number;
    sort_order: number;
  }> = [];

  for (const attachment of attachments) {
    const extension = getAttachmentExtension(attachment.contentType, attachment.originalName);
    const storagePath =
      `feedback/${feedbackId}/${attachment.sortOrder + 1}-${crypto.randomUUID()}.${extension}`;
    const bytes = new Uint8Array(await attachment.file.arrayBuffer());
    const { error } = await supabase.storage.from(FEEDBACK_ATTACHMENT_BUCKET).upload(
      storagePath,
      bytes,
      {
        contentType: attachment.contentType,
        upsert: false,
      },
    );

    if (error) {
      return { uploadedPaths, rows: [], error };
    }

    uploadedPaths.push(storagePath);
    rows.push({
      feedback_id: feedbackId,
      storage_path: storagePath,
      original_name: attachment.originalName,
      content_type: attachment.contentType,
      byte_size: attachment.byteSize,
      sort_order: attachment.sortOrder,
    });
  }

  return { uploadedPaths, rows, error: null };
}

async function parseFeedbackRequest(request: Request) {
  const contentType = request.headers.get('content-type') ?? '';

  if (!contentType.includes('multipart/form-data')) {
    return {
      input: null,
      attachments: [],
      error: json({ ok: false, error: 'Feedback must use multipart/form-data' }, 400),
    };
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return { input: null, attachments: [], error: json({ ok: false, error: 'Invalid form body' }, 400) };
  }

  const rawPayload = formData.get('payload');
  if (typeof rawPayload !== 'string') {
    return { input: null, attachments: [], error: json({ ok: false, error: 'payload is required' }, 400) };
  }

  const payload = (() => {
    try {
      return JSON.parse(rawPayload) as Record<string, unknown> | null;
    } catch {
      return null;
    }
  })();
  if (!payload || typeof payload !== 'object') {
    return { input: null, attachments: [], error: json({ ok: false, error: 'Invalid payload' }, 400) };
  }

  const attachments = formData
    .getAll('attachments')
    .filter((entry): entry is File => entry instanceof File);

  return { input: payload, attachments, error: null };
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

async function handleFeedback(body: unknown, attachmentFiles: File[]) {
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

  if (kind === 'feature-request' && attachmentFiles.length > 0) {
    return json({ ok: false, error: 'Attachments are not supported for feature requests' }, 400);
  }

  const { attachments, error: attachmentError } =
    kind === 'feature-request' ? { attachments: [], error: null } : normalizeAttachmentFiles(attachmentFiles);

  if (attachmentError) {
    return json({ ok: false, error: attachmentError }, 400);
  }

  const includeLogs = kind === 'bug-report' && Boolean(input.includeLogs);
  const logs = includeLogs ? normalizeLogs(input.logs) : [];
  const featureRequestChoice =
    typeof input.featureRequestChoice === 'string' && FEATURE_REQUEST_CHOICES.has(input.featureRequestChoice)
      ? input.featureRequestChoice
      : null;
  const featureRequestDetail =
    featureRequestChoice === 'custom' ? normalizeMessage(input.featureRequestDetail) : null;
  const extensionVersion = normalizeExtensionVersion(input.extensionVersion);
  const supabase = getSupabaseClient();
  const feedbackId = crypto.randomUUID();
  const { data: feedbackSubmission, error: feedbackError } = await supabase
    .from('feedback_submissions')
    .insert({
      id: feedbackId,
      kind,
      message,
      include_logs: includeLogs,
      log_count: logs.length,
      attachment_count: attachments.length,
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
      await cleanupFeedbackSubmission(supabase, feedbackSubmission.id, []);
      return json({ ok: false, error: logsError.message }, 500);
    }
  }

  if (attachments.length > 0) {
    const uploaded = await uploadFeedbackAttachments(supabase, feedbackSubmission.id, attachments);
    if (uploaded.error) {
      await cleanupFeedbackSubmission(supabase, feedbackSubmission.id, uploaded.uploadedPaths);
      return json({ ok: false, error: uploaded.error.message }, 500);
    }

    const { error: attachmentRowsError } = await supabase.from('feedback_attachments').insert(uploaded.rows);
    if (attachmentRowsError) {
      await cleanupFeedbackSubmission(supabase, feedbackSubmission.id, uploaded.uploadedPaths);
      return json({ ok: false, error: attachmentRowsError.message }, 500);
    }
  }

  return json({
    ok: true,
    feedbackId: feedbackSubmission.id,
    attachmentCount: attachments.length,
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

  if (request.method === 'POST' && pathname.endsWith('/feedback')) {
    const parsed = await parseFeedbackRequest(request);
    if (parsed.error) {
      return parsed.error;
    }

    return await handleFeedback(parsed.input, parsed.attachments);
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

  return json({ ok: false, error: 'Not found' }, 404);
});
