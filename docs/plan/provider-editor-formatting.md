# Provider 输入框格式保留：实际页面调研

日期：2026-09-05。代码基线：`c4727c3`，v0.1.8。

## 结论

当前问题出在读取和写入两个环节。`innerText` 丢弃列表和加粗等语义，还会把浏览器布局产生的段落间隔混入文本。把得到的字符串重新插入另一个编辑器，也不能保证恢复结构或保持空行。

建议以**提交前输入框的语义结构**为来源，按目标 provider 的实际能力写入，发送前读回核对。使用 Markdown 作为跨平台的文本表示是合理的，但不能假定所有目标都会把粘贴的 Markdown 自动转成富文本。

以下页面观察来自调研阶段。用户随后确认仅关注 Markdown，当前实现范围见文末；历史方案中的跨平台富文本 HTML 导入没有采用。

## 范围与方法

- 在已登录 Chrome 中新建七个测试标签页，未修改已有会话。
- 检查实际 DOM，用真实键盘输入、系统粘贴、复制测试草稿。
- 测试：逐字输入 `- 1`；逐字输入 `**bold** `；粘贴整段 Markdown；同时提供 HTML 和纯文本的富文本粘贴；复制编辑器内容。
- 纯文本样本：`test formatting\n- 1\n- 2\n- 3\n\n**bold**`。
- HTML 样本：`<p>test formatting</p><ul><li><p>1</p></li><li><p>2</p></li><li><p>3</p></li></ul><p><strong>bold</strong></p>`；剪贴板同时带有上面的 Markdown 纯文本。
- 每组测试清空草稿。首次发现清空文字可能留下空列表，重新退出列表并确认空白段落后，重做 Markdown 粘贴测试；下表使用重做结果。
- 未发送模型请求，未验证服务器请求体、发送后的气泡渲染或扩展合成事件的效果。测试草稿最终全部读回为空，测试标签页已关闭。
- 编辑器家族根据实际 DOM 标记识别，未确认库版本；能力结论只覆盖本次页面和样本，不代表完整格式支持。

## 实际页面与编辑器

| Provider | 页面 | 实际输入节点/标记 | 识别的编辑器家族 |
| --- | --- | --- | --- |
| Claude | `https://claude.ai/new` | `[data-testid="chat-input"][contenteditable="true"]`，`data-composer-editor="marlin"`，`.tiptap.ProseMirror` | Tiptap / ProseMirror |
| ChatGPT | `https://chatgpt.com/` | `div#prompt-textarea[contenteditable="true"].ProseMirror`，旁边还有隐藏 textarea | ProseMirror |
| Grok | `https://grok.com/` | `[role="textbox"][aria-label="Ask Grok anything"].tiptap.ProseMirror` | Tiptap / ProseMirror |
| Gemini | `https://gemini.google.com/app` | `.ql-editor[contenteditable="true"]`；另有隐藏 `.ql-clipboard` | Quill |
| Kimi | `https://www.kimi.com/` | `.chat-input-editor[data-lexical-editor="true"]` | Lexical |
| DeepSeek | `https://chat.deepseek.com/` | `textarea[placeholder="Message DeepSeek"]` | 普通 textarea |
| Manus | `https://manus.im/app` | `.tiptap.ProseMirror[contenteditable="true"]` | Tiptap / ProseMirror |

同属 ProseMirror 并不意味着具有相同的格式支持和粘贴规则。

## 实测矩阵

| Provider | 手动输入 `- 1` | 手动输入 `**bold** ` | 粘贴整段 Markdown | 粘贴 HTML + Markdown 纯文本 |
| --- | --- | --- | --- | --- |
| Claude | 转成列表 | 保留星号 | 保留 Markdown 字面量；连续换行间的空段被合并 | 保留列表；移除 strong 格式 |
| ChatGPT | 转成列表 | 转成 strong | 保留字面量和本次样本的换行，使用 `data-prompt-literal-paste` span | 保留列表和 strong；列表前后新增空段 |
| Grok | 转成列表 | 保留星号 | 保留 Markdown 字面量；连续换行间的空段被合并 | 保留列表；移除 strong 格式 |
| Gemini | 保留 `- 1` | 保留星号 | 各行成为 p，空行成为空 p | 本次使用了纯文本表示，未保留富文本列表和 strong |
| Kimi | 保留 `- 1` | 保留星号 | Lexical text span 中保留文字和换行 | 本次使用了纯文本表示 |
| DeepSeek | 保留 `- 1` | 保留星号 | textarea.value 保留样本文本 | 使用纯文本表示 |
| Manus | 转成列表 | 转成 strong | 自动解析成列表和 strong | 保留列表和 strong |

### 列表符号如何丢失

Claude 和 Grok 手动输入 `- 1` 后的实际 DOM：

```html
<ul><li><p>1</p></li></ul>
```

ChatGPT：

```html
<ul data-spread="false"><li><p dir="auto">1</p></li></ul>
```

Manus：

```html
<ul style="list-style-type: disc;"><li><p>1</p></li></ul>
```

这四者的 `innerText` 和 `textContent` 都只有 `1`。列表信息仍在 DOM 中，字符串提取时才被丢弃。它不是只能从发送后的气泡提取文字导致的限制。

### 换行不能由 innerText 决定

Claude 粘贴纯文本样本后：

```html
<p dir="auto">test formatting</p><p>- 1</p><p>- 2</p><p>- 3</p><p dir="auto">**bold**</p>
```

其 `innerText` 为 `test formatting\n\n- 1\n\n- 2\n\n- 3\n\n**bold**`。原始单换行被读成双换行，而原始显式空行又不能从这个 DOM 还原。单纯调整 `.trim()` 或空白正则无法同时解决两者。

ChatGPT 对同一纯文本粘贴则产生：

```html
<p dir="auto"><span data-prompt-literal-paste="">test formatting<br>- 1<br>- 2<br>- 3<br><br>**bold**</span></p>
```

这一样本的换行保留完整。读取时也必须识别文字原本就是字面量，不能再次把其中的 Markdown 解析为用户已应用的格式。

### 原生复制不是通用 Markdown 导出

Claude、ChatGPT、Grok、Manus 在复制富文本列表时提供了结构化 `text/html`，但 `text/plain` 都没有列表符号。Claude 复制单项列表的纯文本甚至是 `\n\n\n\n1`。

Gemini、Kimi、DeepSeek 复制本次纯文本草稿能得到原来的 Markdown 字面量；这是文字本来就没有被转换，不能据此推断它们能导出任意富文本为 Markdown。

## 当前代码对应位置

- `src/adapters/dom.ts:getEditableText`：textarea/input 读取 value；其他节点直接读取 innerText，导致以上语义丢失和多余空行。
- `src/adapters/dom.ts:setEditableText`：富文本节点调用 `execCommand('insertText')`，失败后手动创建 p/textContent；不携带列表或 marks，也没有核对编辑器接纳的最终结构。
- `src/adapters/factory.ts:handleKeydown`：在提交事件中读取 composer。提取时机可以获得未清空的输入框，不需要以发送后的消息气泡作为主要来源。
- `src/adapters/types.ts:UserSubmissionPayload / ComposerPayload`：目前只有 text 和 attachments；若要保留目标端富文本结构，需要额外表达结构，而不只是替换一个字符串读取函数。

真实粘贴与现有 `execCommand`/合成事件是不同写入路径。本次结果可用来确定能力边界，不能当成扩展实现已经通过验证。

## 方案取舍

| 方案 | 判断 |
| --- | --- |
| 保持 innerText，只修正换行 | 排除：列表、加粗语义在提取时就消失 |
| 自动复制整个输入框，取 text/plain | 排除为主路径：实测仍丢列表，且会干扰选区/剪贴板 |
| 保存所有键盘输入，重放原始 Markdown | 不推荐：粘贴、撤销、选区替换、输入法、语音和恢复草稿都会改变内容，按键记录不是最终文档 |
| 直接读取编辑器原生文档/Markdown serializer | 有条件可用：必须证明该 provider 的实例可稳定取得、相关扩展已启用；此次未验证到可供扩展调用的稳定入口 |
| 拦截提交请求体，取网站最终序列化的内容 | 可做独立验证方向；此次未检查请求。需要分别维护私有协议和时序，不能直接判定更稳定 |
| 读取 composer 的语义 DOM，按 provider 适配 | 推荐基线：此次所需列表信息明确存在，可使用真实节点样本建立回归；仍需处理未知节点和页面变更 |
| 把原始 innerHTML 原封不动搬到目标 | 排除为通用方案：实测有删格式、新增空段、只接纳纯文本等差异 |

编辑器库确实有结构化接口：Tiptap 的 Markdown 扩展提供 `getMarkdown()`；Quill 的 `getContents()` 返回带格式的 Delta；Lexical 有 Markdown 转换函数。但“库有 API”不等于“某网站向浏览器扩展公开了 API”。[Tiptap 文档](https://tiptap.dev/docs/editor/markdown/getting-started/basic-usage)、[Quill 文档](https://quilljs.com/docs/api#getcontents)、[Lexical 文档](https://lexical.dev/docs/packages/lexical-markdown)。

Chrome content script 默认与页面 JavaScript 隔离。读取页面变量需要另外的集成方式；注入 MAIN world 也不会自动提供稳定的编辑器实例入口。[Chrome 文档](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts#isolated_world)。

ProseMirror 允许网站分别定制 HTML、纯文本粘贴和复制规则，这与本次不同站点的实测差异一致。[ProseMirror 文档](https://prosemirror.net/docs/ref/#view.EditorProps)。

## 调研阶段的建议（后续收敛为 Markdown）

1. **源端保留结构。** 提交前抓取 composer，识别真实的段落、硬换行、列表及其嵌套、代码和 marks。textarea 直接保留 value。列表是明确的 ul/li 节点，不需要根据屏幕外观猜测。不要给普通文字中已经存在的 Markdown 重复加转义或再次格式化。
2. **保留一份小型语义表示，并能输出 Markdown。** 显式区分普通文本、列表和格式；空段与排版间隔分别处理。Markdown 表示用于不支持对应结构的目标，保留列表标记、代码缩进和内容语义。不能承诺恢复用户最初输入的 `-`、`*`、`+`：它们转换为同一列表后，原始拼写可能已经不存在。
3. **目标按已验证能力写入。** 对支持的节点生成最小 HTML，通过目标编辑器认可的路径导入；不搬运原页面 class、style、附件 UI 或任意 HTML。对不支持的格式保留 Markdown 字面量，例如 Claude/Grok 对本次 strong 的处理。Gemini/Kimi/DeepSeek 以保留文字和明确换行为基线。ChatGPT 的 HTML 粘贴新增空段必须专门验证和处理。
4. **读回核对后才发送。** 与目标应保留的结构/文字比较，不能只检查 innerText 非空或插入命令返回成功。若格式丢失，尝试已经验证过的 Markdown 表示并再次核对；仍不匹配时保留待发送草稿并明确失败，避免静默丢内容或重复发送。
5. **按完整路径验收。** 用此次真实 DOM 建立回归样本，再验证“实际输入 → 提取 → 目标写入 → 编辑器重渲染 → 提交后的消息”。必须覆盖手动 Markdown、字面量粘贴、富文本粘贴、嵌套列表、空行、代码缩进、混合格式、撤销和输入法完成。此次只验证了前三类的真实编辑器行为，其他仍是验收待办。

产品承诺应是“保留内容、结构和可支持的格式”。各家输入框及发送后气泡的排版能力不同，不能承诺像素级一致。

## 已确认范围与当前实现：Markdown

源端的普通文字按原字符保留，已格式化节点通过 `src/adapters/composer-markdown.ts` 输出 Markdown；同步协议仍传递 Markdown 字符串，目标使用原有文本输入路径。没有加入富文本 HTML 传输或要求目标即时渲染 Markdown。

结构化转换覆盖：

- H1–H6（统一输出 ATX 标题）、有序/无序及嵌套列表、任务列表、嵌套引用。
- 加粗、斜体、组合强调、删除线、行内代码、链接和图片及其标题。
- 围栏代码块及语言、缩进/Tab/空行、代码内的反引号；分隔线。
- GFM 表格、对齐、单元格中的竖线和格式；单元格换行使用 Markdown 中的 `<br>`。
- 编辑器段落、显式空段和换行；忽略 ProseMirror 占位换行及 Quill 列表控件。读取代码时忽略语法高亮包装。

普通文本中的 Markdown 不重新解析或全局转义。因此 Setext 标题、引用式链接、自动链接、缩进代码、转义符、数学公式和脚注等原本仍以文本存在的语法也会保留。没有实现对任意公式/脚注渲染 DOM 的反向识别；已被源编辑器丢弃的信息无法恢复。例如列表原先使用 `*` 还是 `-`、链接原先是否使用引用定义、被网站合并的空行。

输出规则针对编辑器输入行设计：相邻普通 p/div 用一个换行，显式空段保留；列表/引用/围栏等结构之间添加 Markdown 必需的块边界。没有保留 CSS 布局产生的段落间距。

写入富文本输入框后立即读回核对 Markdown：浏览器插入命令返回成功但仍残留旧列表结构时，使用现有文本后备写入路径；事件处理后仍不一致则抛出错误，沿既有投递失败路径处理。这不等于已经验证所有网站延迟重渲染和发送后的内容。

验证分为三层：真实 provider DOM 形状的回归；捕获 → 路由 → 目标写入测试；真实 Chromium 中运行项目读写函数的本地回归页。另用仅开发依赖 Marked 独立解析生成的 Markdown，核对嵌套列表、引用、任务状态、代码和表格。浏览器页验证了真实 innerText 差异及 execCommand 的换行行为，但没有装载各家实际编辑器库，不能称为七个平台完整同步验收。

随后按用户要求将版本升级为 0.1.9，并打包 Chrome 生产版本。未修改超时及其他同步行为。

最终验证：新增 61 项回归；全项目 485 项通过、11 项跳过；TypeScript 类型检查及本次改动的 ESLint 通过。本地真实 Chromium 回归 5 项通过（源端列表结构，以及三种 contenteditable 形状和 textarea 的文本读写）。
