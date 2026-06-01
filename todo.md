
- 总体原则是把复杂度都留给 provider-specific 的逻辑，插件核心逻辑保持尽可能干净鲁棒


- 用户可能直接从已有的session 开始；
- 用户可能开了很多tab，所以意识不到插件开了tab；
- 部分provider 没有登录，发送follow up question 时不停开新的未登录tab；
- 语言会影响adaptor



- 导出为 md(text) & pdf(全页截图)
- 手动新建 set。可以输入 urls，但不复用 tab 而是新开，来收集 tabid
- ~~消息的格式化要保留~~
- ext & 落地页要接 posthog，要获取 什么 work 什么不 work 的信息
- ~~统一 input。可以统一输入 prompt，也可以分开不同 provider 输入不同 prompt 方便首次 fanout 之后的输入~~
- 隐身模式发起