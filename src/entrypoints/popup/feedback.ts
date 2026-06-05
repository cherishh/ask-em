export type FeedbackStep = 'category' | 'message';

export type FeedbackKind = 'feature-request' | 'bug-report' | 'say-something-nice';

export const FEEDBACK_ATTACHMENT_LIMIT = 3;
export const FEEDBACK_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const FEEDBACK_ATTACHMENT_ACCEPT = 'image/png,image/jpeg,image/webp';

export const FEEDBACK_KIND_OPTIONS: Array<{
  kind: FeedbackKind;
  label: string;
  description: string;
}> = [
  {
    kind: 'feature-request',
    label: 'Feature request',
    description: 'Tell us the next thing ask\'em should build.',
  },
  {
    kind: 'bug-report',
    label: 'Bug report',
    description: 'Report something broken, flaky, or confusing.',
  },
  {
    kind: 'say-something-nice',
    label: 'Say something nice',
    description: 'Share praise, delight, or a small win.',
  },
];
