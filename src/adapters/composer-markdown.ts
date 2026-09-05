/**
 * Serialize the editor document, not its layout-dependent innerText. Text nodes
 * may already contain Markdown (including pasted code), so never parse, escape
 * or collapse them globally. Only actual rich-text nodes introduce syntax.
 */
type Part = { text: string; block: boolean };

const BLOCK_TAGS = new Set([
  'P', 'DIV', 'SECTION', 'ARTICLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'HR', 'TABLE',
]);
const OMIT_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']);
const MARKS: Record<string, string> = {
  STRONG: '**', B: '**', EM: '*', I: '*', DEL: '~~', S: '~~', STRIKE: '~~',
};

function omitted(element: Element): boolean {
  return OMIT_TAGS.has(element.tagName) || element.hasAttribute('hidden') ||
    element.getAttribute('aria-hidden') === 'true' ||
    element.classList.contains('ProseMirror-trailingBreak') ||
    element.classList.contains('ql-ui');
}

function isPlaceholderBreak(element: Element): boolean {
  return element.tagName === 'BR' && element.parentElement?.childNodes.length === 1 &&
    ['P', 'DIV'].includes(element.parentElement.tagName);
}

function joinParts(parts: Part[], inListItem = false): string {
  return parts.map((part, index) => {
    if (index === 0) return part.text;
    const previous = parts[index - 1];
    // Paragraphs in composers represent input lines. Empty paragraphs represent
    // explicit blank lines. Semantic blocks need Markdown block boundaries.
    const separator = inListItem
      ? (part.block || previous.block ? '\n' : '\n\n')
      : (part.block || previous.block ? '\n\n' : '\n');
    return separator + part.text;
  }).join('');
}

function children(element: Element, inListItem = false): string {
  const parts: Part[] = [];
  const hasBlocks = Array.from(element.children).some((child) => BLOCK_TAGS.has(child.tagName));
  let inline = '';
  let hasInline = false;
  let previousMark: string | undefined;
  const flushInline = () => {
    if (hasInline) parts.push({ text: inline, block: false });
    inline = '';
    hasInline = false;
  };
  for (const node of Array.from(element.childNodes)) {
    if (!(node instanceof Element) && node.nodeType !== Node.TEXT_NODE) continue;
    if (node instanceof Element && (omitted(node) || isPlaceholderBreak(node))) continue;
    // Pretty-printing between HTML blocks is not an editor input line. Explicit
    // blank lines live in P/BR nodes; literal text-only composers bypass this.
    if (hasBlocks && node.nodeType === Node.TEXT_NODE && /^\s*$/.test(node.nodeValue ?? '')) continue;
    if (node instanceof Element && BLOCK_TAGS.has(node.tagName)) {
      flushInline();
      parts.push(serializeBlock(node));
      previousMark = undefined;
    } else {
      const text = serializeInline(node);
      const mark = node instanceof Element ? MARKS[node.tagName] : undefined;
      if (mark && previousMark === mark && inline.endsWith(mark) && text.startsWith(mark)) {
        inline = inline.slice(0, -mark.length) + text.slice(mark.length);
      } else {
        inline += text;
      }
      hasInline = true;
      previousMark = mark;
    }
  }
  flushInline();
  return joinParts(parts, inListItem);
}

function wrapMark(content: string, delimiter: string): string {
  // Markdown delimiters cannot enclose leading/trailing whitespace.
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(content)!;
  return match[2] ? match[1] + delimiter + match[2] + delimiter + match[3] : content;
}

function codeSpan(content: string): string {
  if (!content) return '';
  const text = content.replace(/\r?\n/g, ' ');
  const fence = '`'.repeat(longestBacktickRun(text) + 1);
  const padding = /^`|`$/.test(text) || (/^ .* $/.test(text) && /\S/.test(text)) ? ' ' : '';
  return fence + padding + text + padding + fence;
}

function longestBacktickRun(text: string): number {
  let longest = 0;
  for (const match of text.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  return longest;
}

function destination(value: string): string {
  // Angle brackets keep spaces and parentheses from terminating a destination.
  return '<' + value.replace(/</g, '%3C').replace(/>/g, '%3E').replace(/\n/g, '%0A') + '>';
}

function title(element: Element): string {
  const value = element.getAttribute('title');
  return value ? ' "' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ') + '"' : '';
}

function serializeInline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? '';
  if (!(node instanceof Element) || omitted(node)) return '';
  if (node.tagName === 'BR') return isPlaceholderBreak(node) ? '' : '\n';
  if (node.tagName === 'CODE') return codeSpan(node.textContent ?? '');
  if (node.tagName === 'IMG') {
    const alt = (node.getAttribute('alt') ?? '').replace(/[\\[\]]/g, '\\$&');
    const src = node.getAttribute('src');
    return src ? `![${alt}](${destination(src)}${title(node)})` : alt;
  }
  const content = children(node);
  if (node.tagName === 'A' && node.hasAttribute('href')) {
    const label = content.replace(/[[\]]/g, '\\$&');
    return `[${label}](${destination(node.getAttribute('href')!)}${title(node)})`;
  }
  return MARKS[node.tagName] ? wrapMark(content, MARKS[node.tagName]) : content;
}

function codeText(element: Element): string {
  // Syntax highlighting may introduce spans/b/marks; those are code characters,
  // not Markdown formatting. Preserve the underlying text and hard line breaks.
  return Array.from(element.childNodes).map((node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? '';
    if (!(node instanceof Element) || omitted(node)) return '';
    if (node.tagName === 'BR') return isPlaceholderBreak(node) ? '' : '\n';
    return codeText(node);
  }).join('');
}

function codeBlock(element: Element): string {
  const code = element.querySelector('code');
  const quillLines = Array.from(element.children).filter((child) => child.classList.contains('ql-code-block'));
  const content = quillLines.length
    ? quillLines.map((line) => codeText(line)).join('\n')
    : codeText(code ?? element);
  const languageNode = code ?? quillLines[0] ?? element;
  const language = languageNode.getAttribute('data-language') ?? element.getAttribute('data-language') ??
    /(?:^|\s)language-([^\s]+)/.exec(languageNode.className)?.[1] ?? '';
  const safeLanguage = language.replace(/[\s`~]/g, '');
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(content) + 1));
  return fence + safeLanguage + '\n' + content + (content.endsWith('\n') ? '' : '\n') + fence;
}

function taskState(item: Element): boolean | null {
  const checkbox = Array.from(item.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
    .find((input) => input.closest('li') === item);
  const checked = item.getAttribute('data-checked') ?? item.getAttribute('aria-checked');
  const quill = item.getAttribute('data-list');
  if (checkbox) return checkbox.checked;
  if (checked !== null) return checked === 'true';
  if (quill === 'checked' || quill === 'unchecked') return quill === 'checked';
  return item.getAttribute('data-type') === 'taskItem' ? false : null;
}

function list(element: Element): string {
  const start = Number.parseInt(element.getAttribute('start') ?? '1', 10);
  const numbers: (number | undefined)[] = [Number.isFinite(start) ? start : 1];
  const indents = [''];
  return Array.from(element.children).filter((item) => item.tagName === 'LI').map((item) => {
    // Quill puts all list items into one OL and encodes their kind/level on LI.
    const depth = Math.min(Number(/(?:^|\s)ql-indent-(\d+)(?:\s|$)/.exec(item.className)?.[1] ?? 0), 20);
    numbers.length = depth + 1;
    const explicit = Number.parseInt(item.getAttribute('value') ?? '', 10);
    const number = Number.isFinite(explicit) ? explicit : numbers[depth] ?? 1;
    const kind = item.getAttribute('data-list');
    const ordered = kind ? kind === 'ordered' : element.tagName === 'OL';
    const marker = ordered ? `${number}. ` : '- ';
    numbers[depth] = ordered ? number + 1 : undefined;
    const baseIndent = indents[depth] ?? '    '.repeat(depth);
    indents[depth + 1] = baseIndent + ' '.repeat(Math.max(4, marker.length));
    const clone = item.cloneNode(true) as Element;
    // Tiptap task labels contain checkbox UI, outside the editable item body.
    for (const label of Array.from(clone.querySelectorAll('label'))) {
      if (label.closest('li') === clone && label.querySelector('input[type="checkbox"]')) label.remove();
    }
    const content = children(clone, true);
    const checked = taskState(item);
    if (!content.trim() && checked === null) return '';
    const task = checked === null ? '' : `[${checked ? 'x' : ' '}] `;
    const lines = (task + content).split('\n');
    const indent = baseIndent + ' '.repeat(marker.length);
    return baseIndent + marker + lines[0] + lines.slice(1).map((line) => '\n' + (line ? indent + line : '')).join('');
  }).filter(Boolean).join('\n');
}

function table(element: Element): string {
  const rows = Array.from(element.querySelectorAll('tr')).filter((row) => row.closest('table') === element);
  if (!rows.length) return children(element);
  const cells = rows.map((row) => Array.from(row.children).filter((cell) => ['TD', 'TH'].includes(cell.tagName)));
  const width = Math.max(...cells.map((row) => row.length));
  if (!width) return '';
  const formatRow = (row: Element[]) => '| ' + Array.from({ length: width }, (_, index) => {
    const cell = row[index];
    return cell ? children(cell).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>') : '';
  }).join(' | ') + ' |';
  const hasHeader = cells[0].some((cell) => cell.tagName === 'TH') || rows[0].parentElement?.tagName === 'THEAD';
  const header = hasHeader ? cells[0] : [];
  const delimiter = '| ' + Array.from({ length: width }, (_, index) => {
    const cell = cells[0][index] as HTMLElement | undefined;
    const align = cell?.getAttribute('align') ?? cell?.style.textAlign;
    return align === 'center' ? ':---:' : align === 'right' ? '---:' : align === 'left' ? ':---' : '---';
  }).join(' | ') + ' |';
  return [formatRow(header), delimiter, ...cells.slice(hasHeader ? 1 : 0).map(formatRow)].join('\n');
}

function serializeBlock(element: Element): Part {
  const tag = element.tagName;
  if (/^H[1-6]$/.test(tag)) {
    const content = children(element).replace(/(\s)(#+)(\s*)$/, (_match, space: string, hashes: string, trailing: string) =>
      space + hashes.replace(/#/g, '\\#') + trailing);
    return { text: '#'.repeat(Number(tag[1])) + ' ' + content, block: true };
  }
  if (tag === 'PRE' || element.classList.contains('ql-code-block-container')) return { text: codeBlock(element), block: true };
  if (tag === 'UL' || tag === 'OL') return { text: list(element), block: true };
  if (tag === 'TABLE') return { text: table(element), block: true };
  if (tag === 'HR') return { text: '---', block: true };
  if (tag === 'BLOCKQUOTE') {
    return { text: children(element).split('\n').map((line) => line ? '> ' + line : '>').join('\n'), block: true };
  }
  return { text: children(element), block: false };
}

export function getComposerMarkdown(element: HTMLElement): string {
  return children(element);
}
