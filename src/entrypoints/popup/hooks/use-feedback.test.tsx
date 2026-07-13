// @vitest-environment jsdom

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FEEDBACK_DEBUG_LOG_MAX_BYTES,
  getDebugLogsByteLength,
} from '../../../runtime/debug-log-retention';
import type { DebugLogEntry, StatusResponseMessage } from '../../../runtime/protocol';
import { renderHookHarness } from './test-utils';
import { useFeedback } from './use-feedback';

const { requestFullLogs, requestStatus } = vi.hoisted(() => ({
  requestFullLogs: vi.fn(async (): Promise<DebugLogEntry[]> => [
    {
      id: 'log-1',
      timestamp: 1,
      level: 'info' as const,
      scope: 'background' as const,
      message: 'test log',
    },
  ]),
  requestStatus: vi.fn(async (): Promise<StatusResponseMessage> => ({
    type: 'STATUS_RESPONSE',
    globalSyncEnabled: true,
    autoSyncNewChatsEnabled: true,
    pauseAfterFirstFanOutEnabled: false,
    debugLoggingEnabled: true,
    showDiagnostics: true,
    closeTabsOnDeleteSet: false,
    workspaceLimit: 5,
    defaultEnabledProviders: {
      claude: true,
      chatgpt: true,
      gemini: true,
      deepseek: true,
      manus: true,
      grok: false,
    },
    defaultFanOutProviders: null,
    shortcuts: {
      togglePageParticipation: { key: '.', meta: false, ctrl: true, shift: false, alt: false },
      nextProviderTab: { key: '.', meta: false, ctrl: true, shift: true, alt: false },
      previousProviderTab: { key: ',', meta: false, ctrl: true, shift: true, alt: false },
    },
    workspaces: [
      {
        workspace: {
          id: 'workspace-1',
          members: {},
          enabledProviders: ['claude', 'chatgpt'],
          createdAt: 1,
          updatedAt: 2,
        },
        memberStates: {
          claude: 'ready',
          chatgpt: 'not-ready',
        },
        memberIssues: {
          chatgpt: 'loading',
        },
      },
    ],
    recentLogs: [],
  })),
}));

vi.mock('../popup-runtime', () => ({
  requestFullLogs,
  requestStatus,
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
    vi.stubGlobal('navigator', {
      ...navigator,
      language: 'zh-CN',
      languages: ['zh-CN', 'en-US'],
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    });
    requestFullLogs.mockClear();
    requestStatus.mockClear();
    globalThis.fetch = vi.fn(async () => ({ ok: true } as Response)) as unknown as typeof fetch;
    globalThis.chrome = {
      permissions: {
        contains: vi.fn(async () => true),
        request: vi.fn(async () => true),
      },
      runtime: {
        getManifest: () => ({ version: '0.1.0' }),
        getPlatformInfo: (callback: (platformInfo: chrome.runtime.PlatformInfo) => void) => {
          callback({ os: 'mac', arch: 'arm', nacl_arch: 'arm' });
        },
      },
      tabs: {
        query: vi.fn(async () => [{ title: 'Ask\'em test tab title' }]),
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

    expect(hook.current.feedbackStep).toBe('message');
    expect(hook.current.feedbackKind).toBe('feature-request');
    expect(hook.current.includeLogs).toBe(false);
    expect(hook.current.canSubmit).toBe(false);

    await act(async () => {
      hook.current.setFeedbackText('More provider coverage');
    });

    expect(hook.current.canSubmit).toBe(true);
    hook.unmount();
  });

  it('submits feature requests as structured payloads without logs', async () => {
    const hook = renderHookHarness(() => useFeedback());

    await act(async () => {
      hook.current.selectFeedbackKind('feature-request');
      hook.current.setFeedbackText('Custom workspace history filters');
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
      environment: null,
      featureRequestChoice: null,
      featureRequestDetail: null,
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
      environment: {
        clientTimestamp: expect.any(String),
        ianaTimeZone: expect.any(String),
        browserLanguage: 'zh-CN',
        browserLanguages: ['zh-CN', 'en-US'],
        browserName: 'Chrome',
        browserVersion: '142.0.0.0',
        os: 'mac',
        activeTabTitle: 'Ask\'em test tab title',
      },
    });
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toBeInstanceOf(File);
    expect(requestStatus).toHaveBeenCalledTimes(1);
    const contextLog = payload.logs.find(
      (log: DebugLogEntry) => log.message === 'Feedback context snapshot',
    );
    expect(contextLog).toBeTruthy();
    expect(JSON.parse(contextLog.detail)).toMatchObject({
      workspaceCount: 1,
      workspaceLimit: 5,
      globalSyncEnabled: true,
      attachmentCount: 1,
      workspaces: [
        {
          workspaceId: 'workspace-1',
          enabledProviders: ['claude', 'chatgpt'],
          memberIssues: {
            chatgpt: 'loading',
          },
        },
      ],
    });

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
      environment: null,
    });
    expect(attachments).toHaveLength(1);
    expect(requestStatus).toHaveBeenCalledTimes(1);

    hook.unmount();
  });

  it('trims bug report logs to the feedback byte budget before submitting', async () => {
    const hugeLogs: DebugLogEntry[] = Array.from({ length: 120 }, (_, index) => ({
      id: `log-${index}`,
      timestamp: index,
      level: 'info',
      scope: 'background',
      message: `message-${index}`,
      detail: 'x'.repeat(10_000),
    }));
    requestFullLogs.mockResolvedValueOnce(hugeLogs);
    const hook = renderHookHarness(() => useFeedback());

    await act(async () => {
      hook.current.selectFeedbackKind('bug-report');
      hook.current.setFeedbackText('A provider failed during sync.');
    });

    await act(async () => {
      await hook.current.submitFeedback();
    });

    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    const { payload } = readPayloadFromFormData(init?.body);

    expect(payload.includeLogs).toBe(true);
    expect(getDebugLogsByteLength(payload.logs)).toBeLessThanOrEqual(FEEDBACK_DEBUG_LOG_MAX_BYTES);
    expect(payload.logs.at(-1).message).toBe('Feedback context snapshot');
    const lastOriginalLog = [...payload.logs].reverse().find(
      (log: DebugLogEntry) => log.id.startsWith('log-'),
    );
    expect(lastOriginalLog?.id).toBe('log-119');
    expect(lastOriginalLog?.detail).toContain('...[truncated ');

    hook.unmount();
  });

  it('submits typed feature requests with screenshots', async () => {
    const hook = renderHookHarness(() => useFeedback());

    await act(async () => {
      hook.current.selectFeedbackKind('feature-request');
      hook.current.setFeedbackText('Please support more providers.');
      hook.current.addAttachmentFiles([new File(['request'], 'request.png', { type: 'image/png' })]);
    });

    await act(async () => {
      await hook.current.submitFeedback();
    });

    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    const { payload, attachments } = readPayloadFromFormData(init?.body);

    expect(payload).toMatchObject({
      kind: 'feature-request',
      message: 'Please support more providers.',
      includeLogs: false,
      logs: [],
      environment: null,
      featureRequestChoice: null,
      featureRequestDetail: null,
    });
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toBeInstanceOf(File);

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
