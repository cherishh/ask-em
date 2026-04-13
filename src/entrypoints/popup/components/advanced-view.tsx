import type {
  DebugLogEntry,
  Provider,
  ShortcutBinding,
  ShortcutConfig,
  ShortcutId,
  StatusResponseMessage,
} from '../../../runtime/protocol';
import { ALL_PROVIDERS, DEFAULT_SHORTCUTS } from '../../../runtime/protocol';
import { ShortcutRecorder } from './shortcut-recorder';

const SHORTCUT_ROWS = [
  {
    id: 'togglePageParticipation',
    label: 'Single tab sync on/off',
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
  selectedProviders: Provider[];
  resolvedShortcuts: ShortcutConfig;
  recordingShortcutId: ShortcutId | null;
  logActionBusy: boolean;
  autoSyncNewChatsEnabled: boolean;
  onOpenRequestModal: () => void;
  onToggleDefaultProvider: (provider: Provider) => void;
  onToggleAutoSyncNewChats: () => void;
  onToggleCloseTabsOnDeleteSet: () => void;
  onResetIndicatorPositions: () => void;
  onSetRecordingShortcutId: (id: ShortcutId | null) => void;
  onUpdateShortcut: (id: ShortcutId, binding: ShortcutBinding) => void;
  onResetShortcuts: () => void;
  onToggleDebugLogging: () => void;
  onDownloadLogs: () => void;
  onClearLogs: () => void;
  onOpenTerms: () => void;
  onOpenPrivacy: () => void;
}) {
  return (
    <>
      <section className="askem-advanced-heading">
        <div>
          <h2>Advanced Tools</h2>
        </div>
      </section>

      <section className="askem-card askem-unified-settings">
        <p className="askem-card-label">Settings</p>

        <div className="askem-us-group">
          <div className="askem-us-row-header">
            <span className="askem-us-row-title">Default models</span>
            <button className="askem-request-link" onClick={props.onOpenRequestModal} type="button">
              + more
            </button>
          </div>
          <div className="askem-dm-list">
            {ALL_PROVIDERS.map((provider) => {
              const active = props.selectedProviders.includes(provider);
              return (
                <button
                  key={provider}
                  className={`askem-dm-item ${active ? 'is-active' : ''}`}
                  onClick={() => props.onToggleDefaultProvider(provider)}
                  disabled={props.loading}
                  type="button"
                >
                  <span className="askem-dm-name">{provider}</span>
                  <span className="askem-dm-check" aria-hidden="true">
                    {active ? '✓' : ''}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="askem-us-divider" />

        <div className="askem-us-group">
          <div className="askem-us-toggle-row">
            <div>
              <span className="askem-us-row-title">Default auto-sync new chats</span>
              <span className="askem-us-row-sub">
                {props.autoSyncNewChatsEnabled
                  ? 'New chats automatically fan-out.'
                  : 'New chats stay solo.'}
              </span>
            </div>
            <button
              type="button"
              className="askem-us-switch"
              data-enabled={String(props.autoSyncNewChatsEnabled)}
              onClick={props.onToggleAutoSyncNewChats}
              disabled={props.loading}
              aria-label={
                props.autoSyncNewChatsEnabled
                  ? 'Disable auto-sync for new chats'
                  : 'Enable auto-sync for new chats'
              }
            />
          </div>
        </div>

        <div className="askem-us-divider" />

        <div className="askem-us-group">
          <div className="askem-us-toggle-row">
            <div>
              <span className="askem-us-row-title">Close tabs used by this set</span>
              <span className="askem-us-row-sub">
                {props.status?.closeTabsOnDeleteSet
                  ? 'Delete Set also closes tabs currently used by this set.'
                  : 'Delete Set keeps those tabs open.'}
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
                  ? 'Disable closing provider tabs when deleting a set'
                  : 'Enable closing provider tabs when deleting a set'
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
                Drag the page indicator anywhere. Reset it here.
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

      <section className="askem-card askem-logs-card">
        <div className="askem-debug-top">
          <div className="askem-debug-copy">
            <p className="askem-card-label">Diagnostics</p>
            <h2>Bug Report Trace</h2>
            <p className="askem-card-copy">Turn this on only when you need to report a bug.</p>
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
            Turn it on only when something breaks, then export the JSON file.
          </p>
        )}
      </section>

      <footer className="askem-footer">
        <div className="askem-legal-links">
          <button type="button" className="askem-legal-link" onClick={props.onOpenTerms}>
            Terms of Service
          </button>
          <span className="askem-legal-sep">·</span>
          <button type="button" className="askem-legal-link" onClick={props.onOpenPrivacy}>
            Privacy Policy
          </button>
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
