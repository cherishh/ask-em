import { useState } from 'react';
import type {
  DebugLogEntry,
  Provider,
  ShortcutBinding,
  ShortcutConfig,
  ShortcutId,
  StatusResponseMessage,
} from '../../../runtime/protocol';
import { DEFAULT_SHORTCUTS } from '../../../runtime/protocol';
import { ShortcutRecorder } from './shortcut-recorder';
import { ProviderOrderList } from './provider-order-list';

const SHORTCUT_ROWS = [
  {
    id: 'togglePageParticipation',
    label: 'Pause/resume sync for this tab',
  },
  {
    id: 'previousProviderTab',
    label: 'Go to previous tab',
  },
  {
    id: 'nextProviderTab',
    label: 'Go to next tab',
  },
] as const satisfies Array<{ id: ShortcutId; label: string }>;

const ENABLED_PROVIDER_COLLAPSED_LIMIT = 5;
const TERMS_URL = 'https://askem.chat/terms.html';
const PRIVACY_URL = 'https://askem.chat/privacy.html';

function LogRow({ log }: { log: DebugLogEntry }) {
  return (
    <div className="askem-log-row">
      <div className="askem-log-meta">
        <span className={`askem-log-level is-${log.level}`}>{log.level}</span>
        <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
        <span>{log.scope}</span>
        {log.provider ? <span>{log.provider}</span> : null}
      </div>
      <p>{log.message}</p>
      {log.detail ? <code>{log.detail}</code> : null}
    </div>
  );
}

export function AdvancedView(props: {
  status: StatusResponseMessage | null;
  loading: boolean;
  providerOptions: Provider[];
  selectedProviders: Provider[];
  resolvedShortcuts: ShortcutConfig;
  recordingShortcutId: ShortcutId | null;
  logActionBusy: boolean;
  showDiagnostics: boolean;
  onOpenRequestModal: () => void;
  onToggleProvider: (provider: Provider) => void;
  onUpdateProviderOrder: (providers: Provider[]) => void;
  onResetProviderOrder: () => void;
  onTogglePauseAfterFirstFanOut: () => void;
  onToggleCloseTabsOnDeleteSet: () => void;
  onResetIndicatorPositions: () => void;
  onSetRecordingShortcutId: (id: ShortcutId | null) => void;
  onUpdateShortcut: (id: ShortcutId, binding: ShortcutBinding) => void;
  onResetShortcuts: () => void;
  onToggleDebugLogging: () => void;
  onDownloadLogs: () => void;
  onClearLogs: () => void;
}) {
  const [providerOptionsExpanded, setProviderOptionsExpanded] = useState(false);
  const hasProviderOverflow = props.providerOptions.length > ENABLED_PROVIDER_COLLAPSED_LIMIT;
  const visibleProviderOptions = providerOptionsExpanded
    ? props.providerOptions
    : props.providerOptions.slice(0, ENABLED_PROVIDER_COLLAPSED_LIMIT);

  return (
    <>
      <section className="askem-advanced-heading">
        <div>
          <h2>Settings</h2>
        </div>
      </section>

      <section className="askem-card askem-unified-settings">
        <p className="askem-card-label">Preferences</p>

        <div className="askem-us-group">
          <div className="askem-us-row-header askem-ep-header">
            <div>
              <span className="askem-us-row-title">Default chats</span>
              <span className="askem-us-row-sub">Choose which AI chats are included in new sync sets.</span>
            </div>
            <div className="askem-ep-header-actions">
              <span className="askem-ep-count">{props.selectedProviders.length} selected</span>
              <button className="askem-request-link" onClick={props.onOpenRequestModal} type="button">
                + more
              </button>
            </div>
          </div>
          <ProviderOrderList
            providers={props.providerOptions}
            visibleProviders={visibleProviderOptions}
            selectedProviders={props.selectedProviders}
            loading={props.loading}
            onToggleProvider={props.onToggleProvider}
            onChange={props.onUpdateProviderOrder}
          />
          <div className="askem-ep-footer-actions">
            {hasProviderOverflow ? (
              <button
                type="button"
                className="askem-ep-expand"
                onClick={() => setProviderOptionsExpanded((expanded) => !expanded)}
              >
                {providerOptionsExpanded ? 'Show fewer' : `Show ${props.providerOptions.length - ENABLED_PROVIDER_COLLAPSED_LIMIT} more`}
              </button>
            ) : null}
            <button
              type="button"
              className="askem-ep-expand"
              onClick={props.onResetProviderOrder}
              disabled={props.loading}
            >
              Reset order
            </button>
          </div>
        </div>

        <div className="askem-us-divider" />

        <div className="askem-us-group">
          <div className="askem-us-toggle-row">
            <div>
              <span className="askem-us-row-title">Sync first prompt only</span>
              <span className="askem-us-row-sub">
                Only the first message syncs, then ask each model its own follow-up.
              </span>
            </div>
            <button
              type="button"
              className="askem-us-switch"
              data-enabled={String(props.status?.pauseAfterFirstFanOutEnabled ?? false)}
              onClick={props.onTogglePauseAfterFirstFanOut}
              disabled={props.loading}
              aria-label={
                props.status?.pauseAfterFirstFanOutEnabled ?? false
                  ? 'Disable pausing after first fan-out'
                  : 'Enable pausing after first fan-out'
              }
            />
          </div>
        </div>

        <div className="askem-us-divider" />

        <div className="askem-us-group">
          <div className="askem-us-toggle-row">
            <div>
              <span className="askem-us-row-title">Close tabs with set</span>
              <span className="askem-us-row-sub">
                When you delete an active sync set, closes its tabs too.
              </span>
            </div>
            <button
              type="button"
              className="askem-us-switch"
              data-enabled={String(Boolean(props.status?.closeTabsOnDeleteSet))}
              onClick={props.onToggleCloseTabsOnDeleteSet}
              disabled={props.loading}
              aria-label={
                props.status?.closeTabsOnDeleteSet
                  ? 'Disable closing tabs when deleting a set'
                  : 'Enable closing tabs when deleting a set'
              }
            />
          </div>
        </div>

        <div className="askem-us-divider" />

        <div className="askem-us-group">
          <div className="askem-us-row-header">
            <div>
              <span className="askem-us-row-title">Indicator position</span>
              <span className="askem-us-row-sub">
                Drag the indicator anywhere. Reset it here.
              </span>
            </div>
            <button
              type="button"
              className="askem-us-reset"
              onClick={props.onResetIndicatorPositions}
            >
              Reset
            </button>
          </div>
        </div>

        <div className="askem-us-divider" />

        <div className="askem-us-group">
          <div className="askem-us-row-header">
            <span className="askem-us-row-title">Shortcut</span>
            {JSON.stringify(props.resolvedShortcuts) !== JSON.stringify(DEFAULT_SHORTCUTS) && (
              <button
                type="button"
                className="askem-us-reset"
                onClick={props.onResetShortcuts}
              >
                Reset
              </button>
            )}
          </div>
          <div className="askem-shortcut-list">
            {SHORTCUT_ROWS.map(({ id, label }) => (
              <div className="askem-shortcut-row" key={id}>
                <span className="askem-shortcut-action">{label}</span>
                <ShortcutRecorder
                  binding={props.resolvedShortcuts[id]}
                  recording={props.recordingShortcutId === id}
                  onRecordingChange={(recording) =>
                    props.onSetRecordingShortcutId(recording ? id : null)
                  }
                  onRecord={(binding) => props.onUpdateShortcut(id, binding)}
                  conflict={false}
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {props.showDiagnostics ? (
        <section className="askem-card askem-logs-card">
          <div className="askem-debug-top">
            <div className="askem-debug-copy">
              <p className="askem-card-label">Diagnostics</p>
              <h2>Bug Report Trace</h2>
              <p className="askem-card-copy">Keep trace on so sync issues can be fixed faster.</p>
            </div>
            <div className="askem-log-actions">
              <button
                className={`askem-provider-chip askem-log-toggle ${props.status?.debugLoggingEnabled ? 'is-active' : ''}`}
                onClick={props.onToggleDebugLogging}
                disabled={props.logActionBusy}
              >
                <span>Trace</span>
                <span>{props.status?.debugLoggingEnabled ? 'on' : 'off'}</span>
              </button>
              {props.status?.debugLoggingEnabled ? (
                <>
                  <button
                    className="askem-provider-clear"
                    onClick={props.onDownloadLogs}
                    disabled={props.logActionBusy}
                  >
                    Download Logs
                  </button>
                  <button
                    className="askem-provider-clear"
                    onClick={props.onClearLogs}
                    disabled={props.logActionBusy}
                  >
                    Clear Logs
                  </button>
                </>
              ) : null}
            </div>
          </div>
          {props.status?.debugLoggingEnabled ? (
            <div className="askem-logs-panel">
              <div className="askem-logs-list">
                {props.status?.recentLogs.length ? (
                  props.status.recentLogs.map((log) => <LogRow key={log.id} log={log} />)
                ) : (
                  <p className="askem-logs-empty">Trace is on, but nothing has been captured yet.</p>
                )}
              </div>
            </div>
          ) : (
            <p className="askem-settings-note">
              Keep trace on, then export logs when something breaks.
            </p>
          )}
        </section>
      ) : null}

      <footer className="askem-footer">
        <div className="askem-legal-links">
          <a className="askem-legal-link" href={TERMS_URL} target="_blank" rel="noreferrer">
            Terms of Service
          </a>
          <span className="askem-legal-sep">·</span>
          <a className="askem-legal-link" href={PRIVACY_URL} target="_blank" rel="noreferrer">
            Privacy Policy
          </a>
        </div>
        <div className="askem-author">
          <span>by </span>
          <a href="https://tuxi.dev/" target="_blank" rel="noreferrer">
            Tuxi
          </a>
          <span> · one77r@gmail.com</span>
        </div>
      </footer>
    </>
  );
}
