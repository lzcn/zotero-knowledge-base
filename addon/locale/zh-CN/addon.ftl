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
    .tooltiptext = 在设置 → 引用中管理格式。
source-style-missing = 请选择可用的引用格式。
editor-source-format-failed = 来源格式生成失败：
editor-more = 更多
editor-open-window = 在独立窗口中打开
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
section-new = 新建笔记
section-new-zettel = 新建 Zettel
section-zettels = Zettel · { $count }

manager-title = 知识库
manager-new = 新建笔记
manager-copy-zettels = 复制笔记目录
manager-copy-zettels-done = 已复制 { $count } 条笔记
manager-copy-zettels-empty = 没有可复制的笔记
manager-search-placeholder = 搜索笔记…
manager-empty-detail = 选择笔记
manager-outgoing = 链接的笔记
manager-backlinks = 反向链接
manager-preview = 内容
manager-edit = 编辑
manager-delete = 移入回收站
manager-unresolved = 不可用的链接
manager-unresolved-tip = 打开引用此链接的笔记进行修正
manager-link-trashed = 从 Zotero 回收站恢复笔记后重新连接。
manager-unavailable-note = 笔记（{ $key }）
manager-formula = [公式]
manager-untitled = 无标题
manager-source = 来源
manager-source-open = 打开来源
manager-source-missing = 来源不可用
manager-count =
    { $count } 篇笔记
manager-updated = 更新于
manager-confirm-delete = 将「{ $title }」移入回收站？

editor-title-new = 新建笔记
editor-title-edit = 编辑笔记
editor-source-label = 来源：
editor-src-none = 未关联来源
editor-src-pick = 选择来源
editor-src-change = 更换
editor-src-jump = 打开条目
editor-src-anno = 插入高亮
editor-src-placeholder = 搜索标题或作者…
editor-anno-empty = 没有高亮批注
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
picker-empty = 没有高亮批注
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
editor-link-placeholder = 搜索笔记…
editor-link-empty = 没有匹配的笔记
editor-reading = 阅读视图
editor-mode = 编辑模式
editor-body-placeholder = 写笔记… 用 [[ID]] 链接笔记。
editor-format-text = 文字
editor-searching = 搜索中…
editor-search-empty = 没有匹配的来源文献
editor-search-failed = 搜索失败：
editor-action-failed = 操作失败：
editor-url-insert = 插入链接
editor-url-prompt = 链接地址
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
graph-hint = 单击选择，双击打开。
graph-empty = 没有匹配的笔记
graph-stats = { $cards } 篇笔记 · { $links } 条连接
graph-kind-card = 笔记
graph-kind-source = 来源文献
graph-kind-unresolved = 待创建的卡片
graph-legend-cards = ● 笔记 · 实线：父子层级 · 虚线：卡片链接
graph-legend-sources = ◈ 来源
graph-legend-unresolved = ○ 待创建的卡片

section-load-error = 加载失败，请重新选择条目。

editor-relations = 笔记关联

editor-visual = 所见即所得

hierarchy = 知识脉络
parent = 父节点
children = 子节点
root = 无上级
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

graph-hierarchy = 层级

graph-links = 笔记链接

graph-outgoing = 链接到

graph-backlinks = 反向链接

graph-open-card = 编辑笔记

graph-open-source = 打开来源文献

column-card-count = 笔记

editor-source-mode = Markdown 源码
editor-unsaved = 等待保存…
editor-saving = 正在保存…
editor-saved = 已保存
editor-save-conflict = 笔记已在别处修改。草稿已保留，请重新打开后合并。
editor-close-unsaved = 保存修改，或保留草稿后关闭？
editor-close-cancel = 取消
editor-save-close = 保存并关闭
editor-draft-close = 保留草稿并关闭
citation-unresolved = 引用键 { $key } 未对应唯一条目。请检查引用键，或使用条目直链。
editor-draft-restored = 草稿已恢复，保存后生效。
editor-draft-missing = 此草稿已保存或不可用。
manager-back = 后退
manager-forward = 前进
manager-drafts = 可恢复草稿
manager-restore-draft = 打开草稿
editor-save-copy = 另存为新卡片
editor-remove-source = 移除来源

editor-note-missing = 笔记不可用，请检查 Zotero 回收站。

editor-browse = 浏览
editor-edit = 编辑

literature-source-required = 请先选择文献条目作为来源。
literature-exists = 这个条目已有文献笔记，请从条目侧栏打开。

relations-hierarchy = 层级
panel-resize = 调整面板宽度
health-note-trashed = 笔记在回收站中，恢复后重新连接。
health-note-missing = 找不到原 Zotero 笔记。
health-source-trashed = 来源在 Zotero 回收站中
health-source-missing = 来源不可用，请重新选择。
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
note-reference-copied = 已复制引用。

markdown-node-citation = 引用
markdown-node-annotation = 标注
markdown-node-note-link = 笔记链接
markdown-node-image = 图片

editor-key = 笔记 ID
editor-key-edit = 修改笔记 ID

editor-key-auto = 自动生成

editor-parent-none = 无上级

editor-change-source = 修改来源…

editor-change-parent = 修改上级…

editor-key-invalid = ID 不能含空格、方括号、|，或以 @ 开头。

editor-key-exists = 此 ID 已被另一篇笔记使用。
editor-key-resolve = 使用可用 ID

pref-inherit-tags =
    .label = 继承来源和上级笔记标签
pref-groups-heading = 分组
pref-graph-label-length = 标题长度
pref-graph-label-length-unit = 个字符
pref-groups-help = 首个匹配的分组优先。
pref-add-group =
    .label = 新建分组
graph-group-tag = 选择标签
graph-group-color = 分组颜色
graph-group-up = 上移
graph-group-remove = 移除分组

graph-global = 全局图谱
graph-local = 局部图谱
pref-graph-local-depth = 局部图深度

manager-sort = 笔记排序
manager-sort-updated-desc = 最近修改
manager-sort-updated-asc = 最早修改
manager-sort-created-desc = 最近创建
manager-sort-created-asc = 最早创建
manager-sort-title-asc = 标题：升序
manager-sort-title-desc = 标题：降序
manager-sort-id-asc = ID：升序
manager-sort-id-desc = ID：降序
pref-ai-heading = AI（实验性）
pref-ai-provider = 服务
pref-ai-model = 模型
pref-ai-key = API 密钥
pref-ai-show-key = 显示 API 密钥
pref-ai-hide-key = 隐藏 API 密钥
pref-ai-path = CLI 路径
ai-remove-key =
    .label = 移除
ai-connect = 建立联系
ai-apply = 应用
ai-close = 关闭
ai-cancel = 取消
ai-parent = 建议上级
ai-review = 上级建议 { $parents } 项 · 联系 { $links } 项 · 已核对 { $read } 篇全文。对照双方原文后勾选，高亮文字将变为链接。
ai-evidence-current = 本篇原文
ai-evidence-target = 目标笔记原文
ai-parent-from = 当前上级：{ $parent }
ai-parent-none = 无上级
ai-link-preview = 在原位为“{ $anchor }”添加链接。
ai-relation-supports = 支持
ai-relation-contradicts = 反驳
ai-relation-qualifies = 限定
ai-relation-applies = 应用
ai-relation-extends = 延伸
ai-relation-shared-mechanism = 共同机制
ai-no-connections = 暂无建议
ai-preparing = 保存中…
ai-progress-titles = 查找笔记 · { $count } / { $total }
ai-progress-retrieval = 正在检索笔记正文和缓存摘要…
ai-progress-evidence = 正在核对双方原文证据…
ai-progress-summaries = 读取摘要 · { $count } / { $total }
ai-progress-reading = 读取笔记 · { $count }
ai-applied = 已应用
ai-zettel-required = 请打开可编辑的笔记。
ai-save-required = 请先保存笔记。
ai-plan-stale = 笔记已变化，请重新分析。
ai-note-too-long = 笔记超过 60,000 字符，未应用修改。
ai-response-invalid = 回答无效，请重试或更换模型。
ai-json-invalid = 回答格式有误，请重试或更换模型。
ai-response-empty = 未收到回答，请重试或更换模型。
ai-response-truncated = 回答不完整，未应用修改。请更换模型。
ai-settings-invalid = 请检查 AI 服务设置。
ai-key-required = 请在设置中填写 { $provider } API 密钥。
ai-busy = 此分析正在进行。
ai-cancelled = 已取消分析。
ai-timeout = AI 请求超时，请重试。
ai-cli-failed = { $provider } 调用失败（{ $code }）。请在设置中测试连接。
ai-http-failed = { $provider } 请求失败（{ $code }）。请检查服务设置。
ai-key-stored = 已保存密钥；输入可替换
ai-key-placeholder = API 密钥
ai-test = 测试连接
ai-testing = 正在测试连接…
ai-test-success = 连接成功。

pref-ai-advanced = 高级
pref-ai-api-help = 可用已设置的环境密钥。
pref-ai-opencode-go-help = 使用 Go 订阅密钥。
ai-context-too-long = 候选全文超过本次分析的上下文上限，未应用任何修改。
ai-free-restricted = OpenCode 拒绝在其客户端以外调用此 Free 模型。请选择支持的 Go 或 API 模型，已保存的密钥不变。
pref-ai-cli-help = 使用已有的 { $provider } 登录。
pref-ai-privacy = 将当前及相关笔记发送至所选服务。
ai-cli-auto-path = 自动查找
ai-cli-not-found = 请安装 { $provider }，或在高级设置中指定路径。
ai-balance-required = { $provider } 余额不足。
ai-models-unavailable = 无法加载模型，请手动输入。
ai-show-key-short = 显示
ai-hide-key-short = 隐藏

pref-graph-appearance = 图谱

ai-list-models = 选择模型
ai-listing-models = 加载模型…
ai-models-listed = { $count } 个模型
ai-default-model = 默认模型

ai-provider-unavailable = 服务不可用，请重新选择。
pref-ai-open =
    .label = AI 设置…
pref-ai-enabled = 启用 AI 功能
ai-disabled = 请先在设置中启用 AI 功能。

pref-literature-template = 笔记模板
pref-template-choice = 新建时使用
template-none = 不使用模板
pref-template-edit = 正文（Markdown）
pref-template-name = 名称
template-untitled = 未命名模板
template-delete-confirm = 删除模板“{ $name }”？已有笔记保持不变。
literature-template-invalid = 模板设置无效，未覆盖已保存的模板。
literature-template-name-invalid = 请输入非空且不重复的模板名称。
pref-template-new =
    .label = 新增
pref-template-delete =
    .label = 删除

note-tags = 标签
note-tags-edit = 编辑标签…
note-tag-add = 输入标签，按回车添加
note-tag-remove = 移除标签 { $tag }
section-source-note = 文献笔记
section-source-note-open = 打开文献笔记
section-source-note-new = 新建文献笔记

manager-view = 笔记视图
manager-notes = 笔记
trash-title = 回收站
trash-restore = 恢复
trash-empty = 清空回收站…
trash-cancel = 取消
trash-delete = 永久删除…
trash-select-note = 选择已删除的笔记以查看或恢复
trash-confirm-delete = 永久删除“{ $title }”及其附件？此操作无法撤销。
trash-confirm-empty = 永久删除 Knowledge Base 回收站中的 { $count } 条笔记及其附件？此操作无法撤销。来源文献和 Knowledge Base 以外的笔记会保留。
trash-progress = 正在删除笔记：{ $done } / { $total }
trash-delete-done = 已永久删除 { $count } 条笔记。
trash-delete-cancelled = 已取消，已永久删除 { $count } 条笔记。
trash-delete-skipped = 已保留 { $count } 条已恢复、不可用或只读的笔记。
trash-delete-failed = 已删除 { $count } 条笔记，删除 { $note } 时失败：{ $error }
trash-restored = 笔记已恢复。

manager-open-note = 打开笔记
manager-open-note-window = 在新窗口打开
manager-copy-note-link = 复制笔记链接

pref-ui-style = 界面风格

text-tools-normalize = 整理格式
text-tools-find = 查找替换
text-tools-unchanged = 未发现需要整理的格式。
text-tools-failed = 无法完成文本操作。
text-tools-done = 已整理 { $count } 处格式。
text-search-find = 查找
text-search-replace = 替换
text-search-next = 下一个
text-search-previous = 上一个
text-search-all = 全部选择
text-search-case = 区分大小写
text-search-regexp = 正则表达式
text-search-word = 全词匹配
text-search-replace-all = 全部替换
text-search-close = 关闭
text-search-line = 跳转到行
text-search-go = 跳转
text-search-current = 当前匹配项
text-search-on-line = 所在行
text-search-replaced-line = 已替换第 $ 行的匹配项
text-search-replaced-count = 已替换 $ 处
