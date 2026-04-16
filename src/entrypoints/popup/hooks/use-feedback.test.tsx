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
  function readPayloadFromFormData(body: unknown) {
    expect(body).toBeInstanceOf(FormData);
    const formData = body as FormData;
    return {
      payload: JSON.parse(String(formData.get('payload'))),
      attachments: formData.getAll('attachments'),
    };
  }

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
    const { payload, attachments } = readPayloadFromFormData(init?.body);

    expect(payload).toMatchObject({
      kind: 'feature-request',
      message: 'Custom workspace history filters',
      includeLogs: false,
      logs: [],
      featureRequestChoice: 'custom',
      featureRequestDetail: 'Custom workspace history filters',
      extensionVersion: '0.1.0',
    });
    expect(attachments).toHaveLength(0);

    expect(hook.current.feedbackSubmitted).toBe(true);
    hook.unmount();
  });

  it('keeps logs enabled by default for bug reports, includes screenshots, and disables logs for praise', async () => {
    const hook = renderHookHarness(() => useFeedback());
    const bugScreenshot = new File(['bug'], 'bug.png', { type: 'image/png' });
    const praiseScreenshot = new File(['nice'], 'nice.png', { type: 'image/png' });

    await act(async () => {
      hook.current.selectFeedbackKind('bug-report');
      hook.current.setFeedbackText('Gemini delivery sometimes stalls.');
      hook.current.addAttachmentFiles([bugScreenshot]);
    });

    await act(async () => {
      await hook.current.submitFeedback();
    });

    expect(requestFullLogs).toHaveBeenCalledTimes(1);
    let [, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    let { payload, attachments } = readPayloadFromFormData(init?.body);

    expect(payload).toMatchObject({
      kind: 'bug-report',
      includeLogs: true,
      message: 'Gemini delivery sometimes stalls.',
    });
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toBeInstanceOf(File);

    await act(async () => {
      hook.current.resetFeedback();
      hook.current.selectFeedbackKind('say-something-nice');
      hook.current.setIncludeLogs(true);
      hook.current.setFeedbackText('The workspace indicator feels great.');
      hook.current.addAttachmentFiles([praiseScreenshot]);
    });

    await act(async () => {
      await hook.current.submitFeedback();
    });

    expect(requestFullLogs).toHaveBeenCalledTimes(1);

    [, init] = vi.mocked(globalThis.fetch).mock.calls[1];
    ({ payload, attachments } = readPayloadFromFormData(init?.body));

    expect(payload).toMatchObject({
      kind: 'say-something-nice',
      includeLogs: false,
      logs: [],
      message: 'The workspace indicator feels great.',
    });
    expect(attachments).toHaveLength(1);

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
    let { payload, attachments } = readPayloadFromFormData(init?.body);

    expect(payload).toMatchObject({
      kind: 'feature-request',
      message: 'More providers',
      includeLogs: false,
      featureRequestChoice: 'more-providers',
      featureRequestDetail: null,
    });
    expect(attachments).toHaveLength(0);

    await act(async () => {
      hook.current.resetFeedback();
      hook.current.selectFeedbackKind('feature-request');
      hook.current.setFeatureRequestChoice('switch-models');
    });

    await act(async () => {
      await hook.current.submitFeedback();
    });

    [, init] = vi.mocked(globalThis.fetch).mock.calls[1];
    ({ payload, attachments } = readPayloadFromFormData(init?.body));

    expect(payload).toMatchObject({
      kind: 'feature-request',
      message: 'Switch models',
      includeLogs: false,
      featureRequestChoice: 'switch-models',
      featureRequestDetail: null,
    });
    expect(attachments).toHaveLength(0);

    await act(async () => {
      hook.current.resetFeedback();
      hook.current.selectFeedbackKind('feature-request');
      hook.current.setFeatureRequestChoice('image-paste');
    });

    await act(async () => {
      await hook.current.submitFeedback();
    });

    [, init] = vi.mocked(globalThis.fetch).mock.calls[2];
    ({ payload, attachments } = readPayloadFromFormData(init?.body));

    expect(payload).toMatchObject({
      kind: 'feature-request',
      message: 'Image paste',
      includeLogs: false,
      featureRequestChoice: 'image-paste',
      featureRequestDetail: null,
    });
    expect(attachments).toHaveLength(0);

    hook.unmount();
  });

  it('limits attachments to three images', async () => {
    const hook = renderHookHarness(() => useFeedback());

    await act(async () => {
      hook.current.selectFeedbackKind('bug-report');
      hook.current.addAttachmentFiles([
        new File(['1'], '1.png', { type: 'image/png' }),
        new File(['2'], '2.png', { type: 'image/png' }),
        new File(['3'], '3.png', { type: 'image/png' }),
        new File(['4'], '4.png', { type: 'image/png' }),
      ]);
    });

    expect(hook.current.attachments).toHaveLength(3);
    expect(hook.current.attachmentError).toBe('You can attach up to 3 images.');
    hook.unmount();
  });
});
