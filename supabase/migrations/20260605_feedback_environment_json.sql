alter table if exists public.feedback_submissions
  add column if not exists environment_json jsonb null;
