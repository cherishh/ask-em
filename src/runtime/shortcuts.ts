export type ShortcutBinding = {
  key: string;
  meta: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
};

export type ShortcutId = 'togglePageParticipation' | 'nextProviderTab' | 'previousProviderTab';

export type ShortcutConfig = Record<ShortcutId, ShortcutBinding>;

export const DEFAULT_SHORTCUTS: ShortcutConfig = {
  togglePageParticipation: { key: '.', meta: false, ctrl: true, shift: false, alt: false },
  nextProviderTab: { key: '.', meta: false, ctrl: true, shift: true, alt: false },
  previousProviderTab: { key: ',', meta: false, ctrl: true, shift: true, alt: false },
};

export function resolveShortcutConfig(
  shortcuts?: Partial<Record<ShortcutId, ShortcutBinding>> | null,
): ShortcutConfig {
  return {
    ...DEFAULT_SHORTCUTS,
    ...shortcuts,
  };
}

export function formatShortcutDisplay(binding: ShortcutBinding, isApple: boolean): string {
  const parts: string[] = [];
  if (binding.ctrl || binding.meta) parts.push(isApple ? '⌘' : 'Ctrl');
  if (binding.alt) parts.push(isApple ? '⌥' : 'Alt');
  if (binding.shift) parts.push('Shift');
  parts.push(binding.key === ' ' ? 'Space' : binding.key.length === 1 ? binding.key.toUpperCase() : binding.key);
  return parts.join(' + ');
}
