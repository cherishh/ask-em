// @vitest-environment jsdom

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHookHarness } from './test-utils';
import { useFeedback } from './use-feedback';

const { requestFullLogs } = vi.hoisted(() => ({
  requestFullLogs: vi.fn(async () => [
    {
      id: 'log-1',
      timestamp: 1,
      level: 'info' as const,
      scope: 'background' as const,
      message: 'test log',
    },
  ]),
}));

vi.mock('../popup-runtime', () => ({
  requestFullLogs,
}));

describe('useFeedback', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('WXT_FEEDBACK_ENDPOINT', 'https://support.example.com/feedback');
    requestFullLogs.mockClear();
    globalThis.fetch = vi.fn(async () => ({ ok: true } as Response)) as unknown as typeof fetch;
    globalThis.chrome = {
      permissions: {
        contains: vi.fn(async () => true),
        request: vi.fn(async () => true),
      },
      runtime: {
        getManifest: () => ({ version: '0.1.0' }),
      },
    } as unknown as typeof chrome;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('switches between the new feedback steps and applies per-kind log defaults', async () => {
    const hook = renderHookHarness(() => useFeedback());

    expect(hook.current.feedbackStep).toBe('category');
    expect(hook.current.feedbackKind).toBeNull();

    await act(async () => {
      hook.current.selectFeedbackKind('say-something-nice');
    });

    expect(hook.current.feedbackStep).toBe('message');
    expect(hook.current.feedbackKind).toBe('say-something-nice');
    expect(hook.current.includeLogs).toBe(false);

    await act(async () => {
      hook.current.goBack();
      hook.current.selectFeedbackKind('bug-report');
    });

    expect(hook.current.feedbackStep).toBe('message');
    expect(hook.current.feedbackKind).toBe('bug-report');
    expect(hook.current.includeLogs).toBe(true);

    await act(async () => {
      hook.current.goBack();
      hook.current.selectFeedbackKind('feature-request');
    });

    expect(hook.current.feedbackStep).toBe('feature-request');
    expect(hook.current.feedbackKind).toBe('feature-request');
    expect(hook.current.includeLogs).toBe(false);
    expect(hook.current.canSubmit).toBe(false);

    await act(async () => {
      hook.current.setFeatureRequestChoice('more-providers');
    });

    expect(hook.current.canSubmit).toBe(true);
    hook.unmount();
  });

  it('submits feature requests as structured payloads without logs', async () => {
    const hook = renderHookHarness(() => useFeedback());

    await act(async () => {
      hook.current.selectFeedbackKind('feature-request');
      hook.current.setFeatureRequestChoice('custom');
      hook.current.setCustomFeatureRequestText('Custom workspace history filters');
    });

    await act(async () => {
      await hook.current.submitFeedback();
    });

    expect(requestFullLogs).not.toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    const payload = JSON.parse(String(init?.body));

    expect(payload).toMatchObject({
      kind: 'feature-request',
      message: 'Custom workspace history filters',
      includeLogs: false,
      logs: [],
      featureRequestChoice: 'custom',
      featureRequestDetail: 'Custom workspace history filters',
      extensionVersion: '0.1.0',
    });

    expect(hook.current.feedbackSubmitted).toBe(true);
    hook.unmount();
  });

  it('keeps logs enabled by default for bug reports and disabled for praise', async () => {
    const hook = renderHookHarness(() => useFeedback());

    await act(async () => {
      hook.current.selectFeedbackKind('bug-report');
      hook.current.setFeedbackText('Gemini delivery sometimes stalls.');
    });

    await act(async () => {
      await hook.current.submitFeedback();
    });

    expect(requestFullLogs).toHaveBeenCalledTimes(1);

    await act(async () => {
      hook.current.resetFeedback();
      hook.current.selectFeedbackKind('say-something-nice');
      hook.current.setIncludeLogs(true);
      hook.current.setFeedbackText('The workspace indicator feels great.');
    });

    await act(async () => {
      await hook.current.submitFeedback();
    });

    expect(requestFullLogs).toHaveBeenCalledTimes(1);

    const [, secondInit] = vi.mocked(globalThis.fetch).mock.calls[1];
    const secondPayload = JSON.parse(String(secondInit?.body));

    expect(secondPayload).toMatchObject({
      kind: 'say-something-nice',
      includeLogs: false,
      logs: [],
      message: 'The workspace indicator feels great.',
    });

    hook.unmount();
  });

  it('supports the new feature request presets', async () => {
    const hook = renderHookHarness(() => useFeedback());

    await act(async () => {
      hook.current.selectFeedbackKind('feature-request');
      hook.current.setFeatureRequestChoice('more-providers');
    });

    await act(async () => {
      await hook.current.submitFeedback();
    });

    let [, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    let payload = JSON.parse(String(init?.body));

    expect(payload).toMatchObject({
      kind: 'feature-request',
      message: 'More providers',
      includeLogs: false,
      featureRequestChoice: 'more-providers',
      featureRequestDetail: null,
    });

    await act(async () => {
      hook.current.resetFeedback();
      hook.current.selectFeedbackKind('feature-request');
      hook.current.setFeatureRequestChoice('switch-models');
    });

    await act(async () => {
      await hook.current.submitFeedback();
    });

    [, init] = vi.mocked(globalThis.fetch).mock.calls[1];
    payload = JSON.parse(String(init?.body));

    expect(payload).toMatchObject({
      kind: 'feature-request',
      message: 'Switch models',
      includeLogs: false,
      featureRequestChoice: 'switch-models',
      featureRequestDetail: null,
    });

    hook.unmount();
  });
});
