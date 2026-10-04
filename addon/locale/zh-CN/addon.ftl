startup-begin = 知识库加载中
startup-finish = 知识库已就绪
startup-db-error = 知识库初始化失败，请通过 帮助→调试输出日志 查看详情

menu-open-manager = 知识库
menu-new-zettel = 新建卡片

section-header =
    .label = 卡片
section-sidenav =
    .tooltiptext = 卡片
section-count =
    { $count } 张卡片
section-no-item = 选中文献条目后显示其卡片
section-loading = 加载中…
section-new = ＋ 新建卡片

manager-title = 知识库
manager-new = 新建卡片
manager-search-placeholder = 搜索标题、正文或 ID…
manager-empty-detail = 选择左侧卡片查看详情；双击卡片可编辑
manager-outgoing = 引用的卡片
manager-backlinks = 引用此卡片
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
    { $count } 张卡片
manager-updated = 更新于
manager-confirm-delete = 确定删除「{ $title }」吗？其他卡片中指向它的链接将保留，但无法打开。

editor-title-new = 新建卡片
editor-title-edit = 编辑卡片
editor-title-placeholder = 卡片标题
editor-source-label = 来源：
editor-src-none = 尚未关联文献条目
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
editor-link-pick = 插入卡片链接
editor-link-placeholder = 搜索卡片标题、正文或 ID…
editor-link-empty = 没有匹配的卡片；也可以直接写 [[新概念]]
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
editor-relations-empty = 暂无关联卡片

graph-title = 卡片关系图
graph-all = 全部卡片
graph-local-one = 在关系图中查看
graph-local-two = 间接关联
graph-unresolved = 待创建的卡片
graph-fit = 适应视图
graph-refresh = 刷新
graph-focus = 聚焦此节点
graph-open = 打开
graph-create = 创建卡片
graph-connections = 链接与反向链接
graph-search = 搜索卡片…
graph-hint = 单击查看，双击打开。实线为父 → 子，虚线为双链。
graph-empty = 当前筛选下没有节点。新建卡片，并在正文中插入卡片链接来建立连接。
graph-stats = { $cards } 张卡片 · { $links } 条连接
graph-kind-card = 卡片
graph-kind-source = 来源文献
graph-kind-unresolved = 待创建的卡片
graph-legend-cards = ● 卡片 · 实线：父子层级 · 虚线：卡片链接
graph-legend-sources = ◈ 来源
graph-legend-unresolved = ○ 待创建的卡片

section-load-error = 卡片加载失败，请重新选择条目重试。


editor-relations = 卡片关联

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

graph-open-card = 编辑卡片

graph-open-source = 打开来源文献

column-card-count = 卡片

preferences-graph = 图谱显示
pref-outline =
    .label = 显示父子关系
pref-references =
    .label = 显示卡片链接
pref-sources =
    .label = 显示来源文献

editor-source-mode = Markdown 源码
editor-unsaved = 等待保存…
editor-saving = 正在保存…
editor-saved = 已保存
editor-save-conflict = 此卡片已在其他位置修改，草稿已保留。请打开最新卡片后合并修改。
editor-close-with-draft = 卡片未能保存。关闭窗口并保留恢复草稿？
editor-draft-restored = 已恢复草稿，请检查后保存。
editor-draft-missing = 此草稿已保存或不可用。
manager-back = 后退
manager-forward = 前进
manager-drafts = 可恢复草稿
manager-restore-draft = 打开草稿
editor-save-copy = 另存为新卡片
editor-remove-source = 移除来源
