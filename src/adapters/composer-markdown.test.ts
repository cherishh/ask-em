// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { marked } from 'marked';
import { getEditableText, setEditableText } from './dom';

function editor(html: string, className = 'tiptap ProseMirror'): HTMLElement {
  const element = document.createElement('div');
  element.className = className;
  element.setAttribute('contenteditable', 'true');
  element.innerHTML = html;
  document.body.append(element);
  return element;
}

function read(html: string): string {
  return getEditableText(editor(html));
}

function parse(markdown: string): HTMLElement {
  const element = document.createElement('div');
  element.innerHTML = marked.parse(markdown, { async: false });
  return element;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('composer Markdown from actual editor shapes', () => {
  it.each([
    '<p>test formatting</p><ul><li><p>1</p></li><li><p>2</p></li><li><p>3</p></li></ul>',
    '<p dir="auto">test formatting</p><ul data-spread="false"><li><p dir="auto">1</p></li><li><p dir="auto">2</p></li><li><p dir="auto">3</p></li></ul>',
    '<p>test formatting</p><ul style="list-style-type: disc;"><li><p>1</p></li><li><p>2</p></li><li><p>3</p></li></ul>',
  ])('captures real Claude/Grok, ChatGPT and Manus lists without losing markers', (html) => {
    expect(read(html)).toBe('test formatting\n\n- 1\n- 2\n- 3');
  });

  it('uses structure even when innerText omits bullets and adds spacing', () => {
    const source = editor('<p>test formatting</p><ul><li><p>1</p></li></ul>');
    Object.defineProperty(source, 'innerText', { value: 'test formatting\n\n1' });
    expect(getEditableText(source)).toBe('test formatting\n\n- 1');
  });

  it.each([
    '<p>line 1</p><p><br></p><p>line 2<br>line 3<br class="ProseMirror-trailingBreak"></p>',
    '<p dir="auto"><span data-prompt-literal-paste="">line 1<br><br>line 2<br>line 3</span></p>',
    '<p dir="ltr"><span data-lexical-text="true">line 1\n\nline 2\nline 3</span></p>',
  ])('retains explicit breaks from ProseMirror/Quill, ChatGPT paste and Lexical', (html) => {
    expect(read(html)).toBe('line 1\n\nline 2\nline 3');
  });

  it.each(['<p><br class="ProseMirror-trailingBreak"></p>', '<p><br></p>', '<ul><li><p><br class="ProseMirror-trailingBreak"></p></li></ul>', ''])('reads empty composers as empty', (html) => {
    expect(read(html)).toBe('');
  });

  it('keeps leading/trailing blank lines and repeated spaces', () => {
    expect(read('<p><br></p><p>  one\t two  </p><p><br></p><p><br></p>')).toBe('\n  one\t two  \n\n');
  });
});

describe('common Markdown and GFM structures', () => {
  it.each([1, 2, 3, 4, 5, 6])('serializes heading level %i', (level) => {
    const md = read(`<h${level}>heading</h${level}><p>body</p>`);
    expect(md).toBe('#'.repeat(level) + ' heading\n\nbody');
    expect(parse(md).querySelector(`h${level}`)?.textContent).toBe('heading');
  });

  it('keeps literal trailing hashes in a formatted heading', () => {
    expect(parse(read('<h2>literal ##</h2>')).querySelector('h2')?.textContent).toBe('literal ##');
  });

  it('retains nested ordered/unordered lists and a non-default start', () => {
    const md = read('<p>Before</p><ol start="3"><li><p>outer</p><ul><li><p>nested</p></li></ul></li><li><p>next</p></li></ol><p>After</p>');
    expect(md).toBe('Before\n\n3. outer\n   - nested\n4. next\n\nAfter');
    const result = parse(md);
    expect(result.querySelector('ol')?.getAttribute('start')).toBe('3');
    expect(result.querySelector('ol > li > ul > li')?.textContent).toBe('nested');
    expect(result.querySelectorAll('ol > li')).toHaveLength(2);
  });

  it('retains multiple paragraphs and fenced code in a list item', () => {
    const md = read('<ul><li><p>first</p><p>second</p><pre><code>  a\n  b</code></pre></li><li><p>next</p></li></ul>');
    const result = parse(md);
    expect(result.querySelectorAll('ul > li')).toHaveLength(2);
    expect(result.querySelectorAll('li:first-child > p')).toHaveLength(2);
    expect(result.querySelector('li > pre > code')?.textContent).toBe('  a\n  b\n');
  });

  it.each([
    '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked><span></span></label><div><p>done</p></div></li><li data-type="taskItem" data-checked="false"><div><p>todo</p></div></li></ul>',
    '<ul><li><input type="checkbox" checked>done</li><li><input type="checkbox">todo</li></ul>',
    '<ul><li role="checkbox" aria-checked="true">done</li><li role="checkbox" aria-checked="false">todo</li></ul>',
    '<ol><li data-list="checked"><span class="ql-ui" contenteditable="false"></span>done</li><li data-list="unchecked"><span class="ql-ui"></span>todo</li></ol>',
  ])('serializes checked and unchecked task items', (html) => {
    const md = read(html);
    expect(md).toBe('- [x] done\n- [ ] todo');
    const boxes = parse(md).querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(Array.from(boxes, (box) => box.checked)).toEqual([true, false]);
  });

  it('respects Quill list kind rather than the OL wrapper', () => {
    expect(read('<ol><li data-list="bullet">outer</li><li class="ql-indent-1" data-list="bullet">nested</li></ol>'))
      .toBe('- outer\n    - nested');
  });

  it('retains nested task checkboxes inside label wrappers', () => {
    const md = read('<ul><li><label><input type="checkbox" checked></label><p>parent</p><ul><li><label><input type="checkbox" checked></label><p>child</p></li></ul></li></ul>');
    expect(md).toBe('- [x] parent\n  - [x] child');
    expect(Array.from(parse(md).querySelectorAll<HTMLInputElement>('input'), (box) => box.checked)).toEqual([true, true]);
  });

  it('tracks Quill numbering independently at each nesting level', () => {
    const md = read('<ol><li data-list="ordered">outer</li><li data-list="ordered" class="ql-indent-1">inner 1</li><li data-list="ordered" class="ql-indent-1">inner 2</li><li data-list="ordered">outer 2</li><li data-list="ordered" class="ql-indent-1">restarted</li></ol>');
    expect(md).toBe('1. outer\n    1. inner 1\n    2. inner 2\n2. outer 2\n    1. restarted');
    expect(parse(md).querySelectorAll('ol > li > ol')).toHaveLength(2);
  });

  it('retains nested quotes, lists and code', () => {
    const md = read('<blockquote><p>quote</p><blockquote><p>nested</p></blockquote><ul><li>item</li></ul><pre><code>  code</code></pre></blockquote>');
    const result = parse(md);
    expect(result.querySelector('blockquote > blockquote > p')?.textContent).toBe('nested');
    expect(result.querySelector('blockquote > ul > li')?.textContent).toBe('item');
    expect(result.querySelector('blockquote > pre > code')?.textContent).toBe('  code\n');
  });

  it('serializes inline emphasis, nesting and strikethrough', () => {
    const md = read('<p><strong>bold</strong> <em>italic</em> <strong><em>both</em></strong> <del>deleted</del></p>');
    expect(md).toBe('**bold** *italic* ***both*** ~~deleted~~');
    const result = parse(md);
    expect(result.querySelector('strong > em, em > strong')?.textContent).toBe('both');
    expect(result.querySelector('del')?.textContent).toBe('deleted');
  });

  it('puts whitespace outside emphasis delimiters', () => {
    expect(read('<p>a<strong> bold </strong>b<em> </em>c</p>')).toBe('a **bold** b c');
  });

  it('joins adjacent equivalent marks without producing ambiguous delimiters', () => {
    const md = read('<p><strong>a</strong><b>b</b> <em>c</em><i>d</i> <s>e</s><del>f</del></p>');
    expect(md).toBe('**ab** *cd* ~~ef~~');
    const result = parse(md);
    expect(result.querySelector('strong')?.textContent).toBe('ab');
    expect(result.querySelector('em')?.textContent).toBe('cd');
    expect(result.querySelector('del')?.textContent).toBe('ef');
  });

  it('serializes links, images and titles with Markdown punctuation', () => {
    const md = read('<p><a href="https://example.com/a_(b)?x=1&amp;y=2" title="a &quot;title&quot;">[link]</a> <img src="https://example.com/my image.png" alt="[alt]" title="picture"></p>');
    const result = parse(md);
    expect(result.querySelector('a')?.textContent).toBe('[link]');
    expect(result.querySelector('a')?.getAttribute('href')).toBe('https://example.com/a_(b)?x=1&y=2');
    expect(result.querySelector('a')?.getAttribute('title')).toBe('a "title"');
    expect(result.querySelector('img')?.getAttribute('alt')).toBe('[alt]');
    expect(result.querySelector('img')?.getAttribute('src')).toBe('https://example.com/my%20image.png');
  });

  it.each(['a  b', '`a`', '``nested``', ' leading and trailing ', '   '])('keeps inline code %j valid', (code) => {
    const source = editor('<p><code></code></p>');
    source.querySelector('code')!.textContent = code;
    expect(parse(getEditableText(source)).querySelector('code')?.textContent).toBe(code);
  });

  it('preserves fenced code language, tabs, blank lines, and longer embedded fences', () => {
    const source = editor('<pre><code class="language-markdown"></code></pre>');
    const code = '```js\n\tconst a = "a  b";  \n\n```\n';
    source.querySelector('code')!.textContent = code;
    const md = getEditableText(source);
    expect(md.startsWith('````markdown\n')).toBe(true);
    expect(parse(md).querySelector('code')?.textContent).toBe(code);
    expect(parse(md).querySelector('code')?.className).toBe('language-markdown');
  });

  it('preserves empty code blocks', () => {
    expect(parse(read('<pre><code></code></pre>')).querySelector('pre > code')).not.toBeNull();
  });

  it('does not turn code highlighting into Markdown syntax', () => {
    const md = read('<pre><code class="language-js"><span><b>const</b> x = 1;</span><br><span>  // comment</span>\n</code></pre>');
    expect(parse(md).querySelector('code')?.textContent).toBe('const x = 1;\n  // comment\n');
  });

  it('ignores formatting whitespace between rendered HTML blocks', () => {
    expect(read('\n<h1>Heading</h1>\n<p>body</p>\n<ul>\n<li>one</li>\n<li>two</li>\n</ul>\n'))
      .toBe('# Heading\n\nbody\n\n- one\n- two');
  });

  it('serializes Quill code lines as a single code block', () => {
    const md = read('<div class="ql-code-block-container"><div class="ql-code-block" data-language="python">def f():</div><div class="ql-code-block">    return 1</div></div>');
    expect(parse(md).querySelector('code')?.textContent).toBe('def f():\n    return 1\n');
    expect(parse(md).querySelector('code')?.className).toBe('language-python');
  });

  it('separates horizontal rules from paragraphs', () => {
    const result = parse(read('<p>before</p><hr><p>after</p>'));
    expect(result.querySelector('hr')).not.toBeNull();
    expect(result.querySelector('h2')).toBeNull();
  });

  it('serializes GFM tables with alignment, pipes, formatting and cell breaks', () => {
    const md = read('<table><thead><tr><th align="left">Name</th><th style="text-align: right">Value</th></tr></thead><tbody><tr><td><strong>A</strong> | B</td><td><code>x|y</code><br>next</td></tr></tbody></table>');
    const result = parse(md);
    expect(result.querySelectorAll('table')).toHaveLength(1);
    expect(result.querySelectorAll('td')).toHaveLength(2);
    expect(result.querySelector('td > strong')?.textContent).toBe('A');
    expect(result.querySelector('td > code')?.textContent).toBe('x|y');
    expect(result.querySelector('td > br')).not.toBeNull();
    expect(result.querySelector('th:last-child')?.getAttribute('align')).toBe('right');
  });

  it('keeps headerless table data in the body with an empty Markdown header', () => {
    const result = parse(read('<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>'));
    expect(Array.from(result.querySelectorAll('td'), (cell) => cell.textContent)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('ignores editor controls but retains text in unfamiliar wrappers', () => {
    expect(read('<p><custom-wrapper>keep</custom-wrapper><button>Copy</button><span hidden>hidden</span><span aria-hidden="true">decoration</span><script>bad()</script></p>')).toBe('keep');
  });
});

const LITERAL_MARKDOWN = '\n# Heading\n\n**bold** _italic_ ~~strike~~\n\n- [x] done\n  1. nested\n\n> quote\n\n```python\n\tprint("a  b")  \n```\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n[ref][id]\n[id]: https://example.com/ "Title"\n\n![alt](image.png)\n<https://example.com/>\n\\*literal\\*\n\n$E=mc^2$\n$$\nx^2\n$$\n\nfootnote[^1]\n[^1]: note\n\n---\n\n';

describe('literal Markdown capture and target writing', () => {
  it.each(['ProseMirror', 'ql-editor', 'chat-input-editor', ''])('keeps every literal character in %s', (className) => {
    const source = editor('', className);
    source.textContent = LITERAL_MARKDOWN;
    expect(getEditableText(source)).toBe(LITERAL_MARKDOWN);
  });

  it('preserves Markdown within real ChatGPT paste spans', () => {
    const source = editor('<p><span data-prompt-literal-paste=""></span></p>');
    const span = source.querySelector('span')!;
    LITERAL_MARKDOWN.split('\n').forEach((line, index) => {
      if (index) span.append(document.createElement('br'));
      span.append(document.createTextNode(line));
    });
    expect(getEditableText(source)).toBe(LITERAL_MARKDOWN);
  });

  it.each(['ProseMirror', 'ql-editor', 'chat-input-editor', 'textarea'])('round-trips all literal syntax through the %s fallback writer', (kind) => {
    const target = kind === 'textarea' ? document.createElement('textarea') : editor('', kind);
    setEditableText(target, LITERAL_MARKDOWN);
    expect(getEditableText(target)).toBe(LITERAL_MARKDOWN);
  });

  it('serializes converted structure alongside untouched literal Markdown', () => {
    expect(read('<p>literal **bold** and $x$</p><ul><li><p>converted</p></li></ul><p>[link](url)</p>'))
      .toBe('literal **bold** and $x$\n\n- converted\n\n[link](url)');
  });

  it('repairs a successful browser insertion that retained an old list wrapper', () => {
    const target = editor('<ul><li><p>old draft</p></li></ul>');
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn((command: string, _showUi: boolean, text: string) => {
        if (command === 'insertText') target.querySelector('p')!.textContent = text;
        return true;
      }),
    });
    try {
      setEditableText(target, '- new\n- items');
      expect(getEditableText(target)).toBe('- new\n- items');
      expect(target.querySelector('li')).toBeNull();
    } finally {
      Reflect.deleteProperty(document, 'execCommand');
    }
  });

  it('reports an editor that drops text instead of silently submitting it', () => {
    const target = editor('');
    target.addEventListener('input', () => { target.textContent = 'truncated'; });
    expect(() => setEditableText(target, LITERAL_MARKDOWN)).toThrow('Composer did not preserve Markdown text');
  });
});
