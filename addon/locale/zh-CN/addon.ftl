startup-begin = 知识库加载中
startup-finish = 知识库已就绪
startup-db-error = 知识库初始化失败，请通过 帮助→调试输出日志 查看详情

menu-open-manager = 知识库
personal-knowledge-title = 个人知识

menu-new-zettel = 新建卡片

section-header =
    .label = 卡片
section-sidenav =
    .tooltiptext = 卡片
section-count =
    { $count } 篇笔记
section-no-item = 选中文献条目后显示其笔记
section-loading = 加载中…
section-new = ＋ 新建卡片

manager-title = 知识库
manager-new = 新建笔记
manager-search-placeholder = 搜索标题、正文或 ID…
manager-empty-detail = 选择笔记查看详情；双击可编辑
manager-outgoing = 链接的笔记
manager-backlinks = 反向链接
manager-preview = 内容
manager-edit = 编辑
manager-delete = 删除
manager-unresolved = 待创建的卡片
manager-unresolved-tip = 点击创建卡片
manager-untitled = 无标题
manager-source = 来源
manager-source-open = 在 Zotero 中打开该条目
manager-source-missing = 来源条目已删除或不可用
manager-count =
    { $count } 篇笔记
manager-updated = 更新于
manager-confirm-delete = 确定删除「{ $title }」吗？指向此笔记的链接会保留，但无法打开。

editor-title-new = 新建笔记
editor-title-edit = 编辑笔记
editor-title-placeholder = 笔记标题
editor-source-label = 来源 · Zotero：
editor-src-none = 尚未关联来源条目
editor-src-pick = 选择来源
editor-src-change = 更换来源
editor-src-jump = 打开条目
editor-src-anno = 插入高亮
editor-src-placeholder = 搜索标题或作者…
editor-anno-empty = 该条目没有可插入的高亮批注
editor-anno-insert = 插入所选
editor-anno-cancel = 取消
editor-cancel = 关闭
editor-save = 保存
editor-confirm-discard = 有未保存的修改，确定丢弃吗？
editor-save-failed = 保存失败：

# 引文渲染（高亮 → 卡片正文）
citation-source = 出处：{ $source }
citation-source-page = 出处：{ $source }，第 { $page } 页
citation-page-note = （p.{ $page }）

# 条目面板：批量从高亮生成
section-import-highlights = 从高亮创建卡片（{ $count }）
section-import-highlights-all-done = 所有高亮均已创建卡片
section-import-highlights-tip = 该条目共 { $total } 条高亮批注

# PDF 阅读器
reader-menu-new-zettel = 创建卡片（{ $count }）
reader-menu-open-zettel = 打开卡片（{ $count }）
reader-anno-new = ＋卡片
reader-anno-open = 卡片 · { $count }
reader-anno-new-tip = 用此高亮新建卡片
reader-anno-open-tip = 打开由此高亮创建的卡片
reader-created = 已创建 { $count } 张卡片
reader-skipped = 已跳过 { $count } 条高亮（卡片已存在）
reader-failed = { $count } 张卡片创建失败
reader-create-failed = 创建卡片失败，详见 帮助→调试输出日志

# 批量生成对话框
picker-title = 从高亮创建卡片
picker-close = 关闭
picker-empty = 该条目没有可转换的高亮批注
picker-create = 生成卡片
picker-create-count = 生成 { $count } 张卡片
picker-toggle = 全选 / 取消全选
picker-no-card = 未创建卡片
picker-cards = 已创建 { $count } 张卡片
picker-created = 已创建 { $count } 张卡片
picker-skipped = 已跳过 { $count } 条高亮（卡片已存在）
picker-failed = { $count } 张卡片创建失败
picker-nothing = 没有可创建的卡片

# Markdown 编辑和链接
editor-src-selected = 使用当前选中条目
editor-src-no-selection = 请先在 Zotero 中选中文献或笔记
editor-src-insert = 插入来源链接
editor-reference-insert = 插入条目或笔记引用
editor-link-pick = 插入笔记链接
editor-link-placeholder = 搜索笔记标题、正文或 ID…
editor-link-empty = 没有匹配的笔记；也可以直接写 [[新概念]]
editor-reading = 浏览模式
editor-mode = 编辑模式
editor-body-placeholder = 用 Markdown 写正文，通过 [[ID]] 引用卡片。
editor-format-text = 文字
editor-searching = 搜索中…
editor-search-empty = 没有匹配的来源文献
editor-search-failed = 搜索失败：
editor-action-failed = 操作失败：
editor-url-insert = 插入链接
editor-url-prompt = 链接地址（https://、mailto: 或 zotero://）
editor-image = 插入图片
editor-relations-empty = 暂无关联笔记

graph-title = 笔记关系图
graph-all = 全部笔记
graph-local-one = 在关系图中查看
graph-local-two = 间接关联
graph-unresolved = 待创建的卡片
graph-fit = 适应视图
graph-refresh = 刷新
graph-focus = 聚焦此节点
graph-open = 打开
graph-create = 创建卡片
graph-connections = 链接与反向链接
graph-search = 搜索笔记…
graph-hint = 单击查看，双击打开。实线为父 → 子，虚线为双链。
graph-empty = 当前筛选下没有节点。新建卡片，并在正文中插入卡片链接来建立连接。
graph-stats = { $cards } 篇笔记 · { $links } 条连接
graph-kind-card = 笔记
graph-kind-source = 来源文献
graph-kind-unresolved = 待创建的卡片
graph-legend-cards = ● 笔记 · 实线：父子层级 · 虚线：卡片链接
graph-legend-sources = ◈ 来源
graph-legend-unresolved = ○ 待创建的卡片

section-load-error = 笔记加载失败，请重新选择条目重试。


editor-relations = 笔记关联

editor-visual = 所见即所得

hierarchy = 知识脉络
parent = 父节点
children = 子节点
entries = 入口点
root = 入口点
parent-search = 用编号或标题查找父节点
references = 双链
both = 脉络 + 双链

new-child = 新建子卡片

command-menu = 插入
command-search = 搜索命令…
command-empty = 没有匹配的命令
command-heading = 标题
command-list = 列表
command-task = 待办
command-quote = 引用块
command-code = 代码块
command-table = 表格
more-actions = 更多操作

manager-show-graph = 在关系图中定位

graph-display = 显示设置

graph-hierarchy = 卡片父子层级

graph-links = 卡片链接（双链）

graph-outgoing = 链接到

graph-backlinks = 反向链接

graph-open-card = 编辑笔记

graph-open-source = 打开来源文献

column-card-count = 笔记

editor-source-mode = Markdown 源码
editor-unsaved = 等待保存…
editor-saving = 正在保存…
editor-saved = 已保存
editor-save-conflict = 此卡片已在其他位置修改，草稿已保留。请打开最新卡片后合并修改。
editor-close-unsaved = 保存修改，或保留草稿后关闭？
editor-close-cancel = 取消
editor-save-close = 保存并关闭
editor-draft-close = 保留草稿并关闭
citation-unresolved = 引用键 { $key } 未对应唯一条目。请检查引用键，或使用条目直链。
editor-draft-restored = 已恢复草稿。点击保存，将其应用到笔记。
editor-draft-missing = 此草稿已保存或不可用。
manager-back = 后退
manager-forward = 前进
manager-drafts = 可恢复草稿
manager-restore-draft = 打开草稿
editor-save-copy = 另存为新卡片
editor-remove-source = 移除来源

editor-note-missing = 关联的 Zotero 笔记不存在或已移入回收站。请先在 Zotero 中恢复笔记。

editor-browse = 浏览
editor-edit = 编辑

note-kind = 笔记类型
note-kind-all = 全部笔记
note-kind-literature = 文献笔记
note-kind-zettel = 卡片
note-kind-thinking = 思考笔记
literature-source-required = 请先选择文献条目作为来源。
literature-exists = 这个条目已有文献笔记，请从条目侧栏打开。
manager-confirm-remove = 从 Knowledge Base 移除“{ $title }”？原 Zotero 笔记会保留。

relations-hierarchy = 层级
panel-resize = 调整面板宽度
health-note-trashed = 原笔记在回收站中，内容缓存仍保留。
health-note-missing = 原笔记不可用，可以将缓存另存为新笔记。
health-source-trashed = 来源在回收站中，原链接仍保留。
health-source-missing = 来源不可用，可选择其他来源重新关联。
health-restore = 恢复原记录
health-open-cache = 打开缓存笔记
health-read-only = 此文献库为只读。
editor-format-native = 原生编辑器
editor-format-markdown = Markdown
graph-outline = 层级
graph-references = 引用
graph-sources = 来源

preview-image-missing = 图片不可用

native-markdown-label = Markdown 笔记
native-markdown-reload = 重新载入
native-markdown-conflict = 笔记已在其他位置修改，草稿已保留。
native-markdown-failed = 保存失败，草稿已保留。
native-markdown-draft = 已恢复草稿
native-markdown-close = 关闭前保存修改吗？

editor-outline-parent = 上级笔记

manager-source-item = 来源 · Zotero
