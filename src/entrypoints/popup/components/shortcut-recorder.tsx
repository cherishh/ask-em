import { useCallback, useEffect, useRef } from 'react';
import { formatShortcutDisplay } from '../../../runtime/protocol';
import type { ShortcutBinding } from '../../../runtime/protocol';

function normalizeShortcutKey(event: KeyboardEvent): string {
  if (event.code === 'Period') {
    return '.';
  }

  if (event.code === 'Comma') {
    return ',';
  }

  return event.key.length === 1 ? event.key.toLowerCase() : event.key;
}

export function ShortcutRecorder({
  binding,
  recording,
  onRecordingChange,
  onRecord,
  conflict,
}: {
  binding: ShortcutBinding;
  recording: boolean;
  onRecordingChange: (recording: boolean) => void;
  onRecord: (binding: ShortcutBinding) => void;
  conflict: boolean;
}) {
  const isApple = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!recording) return;

      if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return;
      if (!event.metaKey && !event.ctrlKey && !event.altKey) return;

      event.preventDefault();
      event.stopPropagation();

      const newBinding: ShortcutBinding = {
        key: normalizeShortcutKey(event),
        meta: event.metaKey,
        ctrl: event.ctrlKey,
        shift: event.shiftKey,
        alt: event.altKey,
      };

      onRecord(newBinding);
      onRecordingChange(false);
    },
    [recording, onRecord, onRecordingChange],
  );

  useEffect(() => {
    if (!recording) return;
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [recording, handleKeyDown]);

  useEffect(() => {
    if (!recording) return;
    const handleBlur = () => onRecordingChange(false);
    window.addEventListener('blur', handleBlur);
    return () => window.removeEventListener('blur', handleBlur);
  }, [recording, onRecordingChange]);

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`askem-shortcut-keys askem-shortcut-recorder ${recording ? 'is-recording' : ''} ${conflict ? 'is-conflict' : ''}`}
      onClick={() => onRecordingChange(!recording)}
    >
      {recording ? 'Press keys…' : formatShortcutDisplay(binding, isApple)}
    </button>
  );
}
