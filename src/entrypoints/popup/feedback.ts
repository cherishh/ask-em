export type FeedbackStep = 'category' | 'feature-request' | 'message';

export type FeedbackKind = 'feature-request' | 'bug-report' | 'say-something-nice';

export const FEEDBACK_ATTACHMENT_LIMIT = 3;
export const FEEDBACK_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const FEEDBACK_ATTACHMENT_ACCEPT = 'image/png,image/jpeg,image/webp';

export type FeatureRequestChoice =
  | 'multilingual'
  | 'incognito-chat'
  | 'more-providers'
  | 'switch-models'
  | 'custom';

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

export const FEATURE_REQUEST_OPTIONS: Array<{
  choice: FeatureRequestChoice;
  label: string;
  description: string;
}> = [
  {
    choice: 'multilingual',
    label: 'Multi-language support',
    description: 'Use ask\'em in your preferred language.',
  },
  {
    choice: 'incognito-chat',
    label: 'Start chats in incognito',
    description: 'Open and sync chats from an incognito window.',
  },
  {
    choice: 'more-providers',
    label: 'More providers',
    description: 'Use ask\'em with more AI apps and websites.',
  },
  {
    choice: 'switch-models',
    label: 'Switch models',
    description: 'Choose different models or plan tiers inside one provider.',
  },
  {
    choice: 'custom',
    label: 'Something else',
    description: 'Describe the feature you want in your own words.',
  },
];

export function getFeatureRequestLabel(choice: FeatureRequestChoice | null): string {
  return FEATURE_REQUEST_OPTIONS.find((option) => option.choice === choice)?.label ?? '';
}
