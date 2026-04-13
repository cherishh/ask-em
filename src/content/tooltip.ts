export type ContentTooltipSpec = {
  message: string;
  secondaryHtml?: string;
};

export function renderContentTooltipHtml(spec: ContentTooltipSpec): string {
  return `
    <p class="ask-em-panel-note">${spec.message}</p>
    ${
      spec.secondaryHtml
        ? `<div class="ask-em-panel-tooltip-secondary">
            ${spec.secondaryHtml}
          </div>`
        : ''
    }
  `;
}
