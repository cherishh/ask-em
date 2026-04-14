export type FeedbackStep = 'category' | 'feature-request' | 'message';

export type FeedbackKind = 'feature-request' | 'bug-report' | 'say-something-nice';

export type FeatureRequestChoice = 'multilingual' | 'incognito-chat' | 'history' | 'custom';

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
    description: 'Translate the extension UI and related product copy.',
  },
  {
    choice: 'incognito-chat',
    label: 'Start chats in incognito',
    description: 'Open and sync provider tabs from an incognito window.',
  },
  {
    choice: 'history',
    label: 'History',
    description: 'Keep a browsable record of synced sets and status.',
  },
  {
    choice: 'custom',
    label: 'Something else',
    description: 'Enter a custom request in your own words.',
  },
];

export function getFeatureRequestLabel(choice: FeatureRequestChoice | null): string {
  return FEATURE_REQUEST_OPTIONS.find((option) => option.choice === choice)?.label ?? '';
}
