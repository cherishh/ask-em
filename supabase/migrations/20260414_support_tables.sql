create extension if not exists pgcrypto;

create table if not exists public.feedback_submissions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('feature-request', 'bug-report', 'say-something-nice')),
  message text not null,
  include_logs boolean not null default false,
  log_count integer not null default 0,
  feature_request_choice text null check (
    feature_request_choice in ('multilingual', 'incognito-chat', 'history', 'custom')
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
