startup-begin = 知识库加载中
startup-finish = 知识库已就绪
startup-db-error = 知识库初始化失败，请通过 帮助→调试输出日志 查看详情

menu-open-manager = 知识库
pref-workbench-heading = 工作台
pref-workbench-mode = 打开方式
pref-workbench-tab =
    .label = Zotero 标签页
pref-workbench-window =
    .label = 独立窗口
pref-source-heading = 来源引用
pref-source-style = 参考文献格式
pref-source-help = 使用 Zotero 已安装的格式。可在设置 → 引用中添加或管理。
source-style-missing = 参考文献格式不可用，请选择已安装的格式
editor-source-format-failed = 来源格式生成失败：
editor-more = 更多操作
editor-open-window = 在独立窗口中打开
editor-convert-zettel = 转为 Zettel
editor-convert-thinking = 转为 Thinking
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
section-new = ＋ 新建笔记

manager-title = 知识库
manager-new = 新建笔记
manager-search-placeholder = 搜索标题、正文或 ID…
manager-empty-detail = 选择笔记查看详情；双击可编辑
manager-outgoing = 链接的笔记
manager-backlinks = 反向链接
manager-preview = 内容
manager-edit = 编辑
manager-delete = 移入 Zotero 回收站
manager-unresolved = 不可用的链接
manager-unresolved-tip = 打开引用此链接的笔记进行修正
manager-link-trashed = 原笔记在 Zotero 回收站，恢复后此链接会重新连接。
manager-unavailable-note = 笔记（{ $key }）
manager-formula = [公式]
manager-untitled = 无标题
manager-source = 来源
manager-source-open = 在 Zotero 中打开该条目
manager-source-missing = 来源条目已删除或不可用
manager-count =
    { $count } 篇笔记
manager-updated = 更新于
manager-confirm-delete = 将「{ $title }」移入 Zotero 回收站？在 Zotero 中恢复后，笔记会重新显示在 Knowledge Base 中。

editor-title-new = 新建笔记
editor-title-edit = 编辑笔记
editor-source-label = 来源：
editor-src-none = 未关联来源
editor-src-pick = 选择来源
editor-src-change = 更换
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
editor-reading = 阅读视图
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

relations-hierarchy = 层级
panel-resize = 调整面板宽度
health-note-trashed = 笔记在 Zotero 回收站中，恢复后自动继续使用原卡片。
health-note-missing = 找不到原 Zotero 笔记。
health-source-trashed = 来源在回收站中，原链接仍保留。
health-source-missing = 来源不可用，可选择其他来源重新关联。
health-restore = 恢复原记录
health-read-only = 此文献库为只读。
editor-format-native = 富文本
editor-format-markdown = Markdown
graph-outline = 层级
graph-references = 引用
graph-sources = 来源
graph-hide-isolated = 隐藏孤立节点

preview-image-missing = 图片不可用

native-markdown-label = Markdown 笔记
native-markdown-reload = 重新载入
native-markdown-conflict = 笔记已在其他位置修改，草稿已保留。
native-markdown-failed = 保存失败，草稿已保留。
native-markdown-draft = 已恢复草稿
native-markdown-close = 关闭前保存修改吗？

editor-outline-parent = 上级

manager-source-item = 来源 · Zotero

note-reference-copy = 复制笔记引用

markdown-node-citation = 引用
markdown-node-annotation = 标注
markdown-node-note-link = 笔记链接
markdown-node-image = 图片

editor-key = Key

editor-key-auto = 自动生成

editor-parent-none = 无上级

editor-change-source = 修改来源…

editor-change-parent = 修改上级…

editor-key-invalid = Key 不能含空格、方括号、|，或以 @ 开头。

editor-key-exists = 此 Key 已被另一篇笔记使用。


pref-tags-heading = 笔记标签
pref-inherit-tags =
    .label = 继承父级标签
pref-inherit-tags-help = 包含 Zotero 父条目和上级卡片的标签，保留笔记原有标签。
pref-groups-heading = 图谱分组
pref-graph-label-length = 图谱标题长度
pref-graph-label-length-unit = 个字符
pref-groups-help = 为每组选择标签和颜色；先匹配的分组优先，同组笔记在图谱中聚集。
pref-add-group =
    .label = 新建分组
graph-group-tag = 选择标签
graph-group-color = 分组颜色
graph-group-up = 上移
graph-group-remove = 移除分组

graph-global = 全局图谱
graph-local = 局部图谱
pref-graph-local-depth = 局部图跳数

manager-sort = 笔记排序
manager-sort-updated-desc = 最近修改
manager-sort-updated-asc = 最早修改
manager-sort-created-desc = 最近创建
manager-sort-created-asc = 最早创建
manager-sort-title-asc = 标题：升序
manager-sort-title-desc = 标题：降序

pref-codex-heading = 用 Codex 阅读论文
pref-codex-enabled = 启用 Codex 论文阅读
    .label = 启用 Codex 论文阅读
pref-codex-path = 可执行文件路径
pref-codex-model = 模型
pref-codex-test = 测试连接
pref-codex-help = 请先安装新版 Codex CLI 并登录。路径留空自动检测，模型留空使用 CLI 默认模型。每次阅读会通过你的账号将所选 PDF 提取的文字发送给 Codex，不加载用户 CLI 的工具和 MCP 配置。
codex-read-paper = 用 Codex 阅读
codex-reading-help = 将这篇论文的 PDF 文字发送给已登录的 Codex。保存前可以预览和修改。关闭窗口会丢弃尚未保存的阅读稿。
codex-extracting = 正在读取本地 PDF…
codex-reading = Codex 正在阅读论文…
codex-checking = 正在检查 Codex…
codex-ready = 阅读稿已生成 · { $pages } 页 PDF。文字提取可能遗漏图表和数学符号。
codex-ready-partial = 部分阅读稿 · 已读取 { $pages } / { $total } 页 PDF。请查看阅读局限。
codex-partial-note = 部分阅读：本阅读稿依据 PDF 的前 { $pages } 页，共 { $total } 页。
codex-preserve-existing = 保存会追加阅读稿，保留已有正文。
codex-draft = 文献笔记阅读稿
codex-preview = 阅读视图
codex-edit = 编辑 Markdown
codex-cancel = 取消
codex-close = 关闭
codex-save-note = 保存文献笔记
codex-append-note = 追加到文献笔记
codex-saving = 正在保存文献笔记…
codex-not-found = 未找到 Codex CLI。请在设置 → Knowledge Base 指定可执行文件路径。
codex-path-invalid = 请在设置 → Knowledge Base 填写现有 Codex 可执行文件的绝对路径。
codex-settings-invalid = Codex 设置包含无效字符。
codex-cancelled = 已取消阅读，已有笔记已保留。
codex-disabled = Codex 论文阅读已关闭。
codex-timeout = Codex 阅读超时，已有笔记已保留。请稍后重试。
codex-failed = Codex 未能完成。请在设置 → Knowledge Base 测试连接，检查 CLI 登录、网络、模型是否可用，以及 CLI 是否需要更新。
codex-output-invalid = Codex 返回的阅读稿或页码引用无效，已有笔记已保留。
codex-source-unavailable = 来源论文或 PDF 已删除。请先在 Zotero 恢复，再保存。
codex-read-only = 当前文献库只读，无法在这里保存文献笔记。
codex-note-unavailable = 文献笔记不可用。请先在 Zotero 恢复原笔记，再重新阅读。
codex-note-changed = 阅读期间原文献笔记已变化，本阅读稿未保存。请先复制阅读稿，再关闭窗口并重新生成。
codex-pdf-missing = 没有可用的本地 PDF。请先下载或为论文添加 PDF 附件。
codex-pdf-empty = PDF 缺少可读取的文字。请先执行 OCR，或添加包含文字的 PDF。
codex-pdf-unreadable = Zotero 无法提取 PDF 文字。请检查 PDF 是否损坏或需要密码。
codex-pdf-too-large = PDF 超出阅读上限，请先添加较短的论文 PDF。
