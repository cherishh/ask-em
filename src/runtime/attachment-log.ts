type AttachmentLogRef = {
  id: string;
  mime?: string;
  size: number;
  source?: string;
};

export function shortAttachmentId(id: string): string {
  return id.slice(0, 8);
}

export function shortSubmitId(id: string): string {
  return id.slice(0, 8);
}

export function formatAttachmentSummary(refs: readonly AttachmentLogRef[]): string {
  if (refs.length === 0) {
    return '0 attachment(s)';
  }

  const items = refs
    .map((ref) => {
      const source = ref.source ? `:${ref.source}` : '';
      return `${shortAttachmentId(ref.id)}:${ref.mime || 'unknown'}:${ref.size}b${source}`;
    })
    .join(', ');

  return `${refs.length} attachment(s) [${items}]`;
}
