create extension if not exists pgcrypto;

create table if not exists public.feedback_submissions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('feature-request', 'bug-report', 'say-something-nice')),
  message text not null,
  include_logs boolean not null default false,
  log_count integer not null default 0,
  attachment_count integer not null default 0,
  feature_request_choice text null check (
    feature_request_choice in (
      'multilingual',
      'incognito-chat',
      'more-providers',
      'switch-models',
      'custom'
    )
  ),
  feature_request_detail text null,
  extension_version text null,
  created_at timestamptz not null default now()
);

create table if not exists public.feedback_logs (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.feedback_submissions(id) on delete cascade,
  payload_json jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_feedback_submissions_created_at
  on public.feedback_submissions(created_at desc);

create index if not exists idx_feedback_submissions_kind_created_at
  on public.feedback_submissions(kind, created_at desc);

create table if not exists public.feedback_attachments (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.feedback_submissions(id) on delete cascade,
  storage_path text not null unique,
  original_name text not null,
  content_type text not null,
  byte_size integer not null,
  sort_order integer not null check (sort_order between 0 and 2),
  created_at timestamptz not null default now()
);

create index if not exists idx_feedback_attachments_feedback_id_sort_order
  on public.feedback_attachments(feedback_id, sort_order);

create table if not exists public.provider_requests (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null,
  provider text not null,
  extension_version text null,
  created_at timestamptz not null default now()
);

create index if not exists idx_provider_requests_submission_id
  on public.provider_requests(submission_id);

create index if not exists idx_provider_requests_provider_created_at
  on public.provider_requests(provider, created_at desc);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'feedback-attachments',
  'feedback-attachments',
  false,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
