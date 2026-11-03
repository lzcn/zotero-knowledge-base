similar-works-empty = 没有相似条目
similar-works-no-text = 没有全文或摘要
similar-works-unavailable = 相似度索引不可用
similar-works-based-on-weak = 仅元数据


similar-works-progress =
    .aria-label = 相似度计算进度

similar-works-pref-limit =
    .value = 首批显示数量
similar-works-pref-index-heading = 缓存
similar-works-pref-error = 缓存暂不可用
similar-works-pref-index-value = { $known ->
    [1] { $phase } · { $count } / { $total }
   *[0] { $phase } · { $count }
    }
similar-works-pref-index-progress =
    .aria-label = 文本索引进度
similar-works-state-preparing = 正在加载
similar-works-state-waiting = 等待处理
similar-works-state-scanning = 正在检查
similar-works-state-indexing = 正在更新
similar-works-state-idle = 已就绪
similar-works-state-disabled = 已暂停
similar-works-state-stopped = 已停止
similar-works-state-error = 处理失败
similar-works-state-loading = 正在准备
similar-works-state-downloading = 正在下载

similar-works-tags-menu =
    .label = 标签管理
similar-works-tags-search =
    .placeholder = 搜索已有标签…
    .aria-label = 搜索已有标签
similar-works-tags-duplicates = 可能重复
similar-works-tags-keep = 名称
similar-works-tags-preview = 已选 { $tags } 个标签，涉及 { $count } 个条目
similar-works-tags-close =
    .label = 关闭
similar-works-tags-merged = 已将 { $count } 个标签统一为“{ $name }”。
similar-works-tags-readonly = 当前文献库或条目不可编辑。
similar-works-tags-changed = 标签已变化，请刷新后重选。
similar-works-tags-cancelled = 操作已取消。
similar-works-tags-error = 无法更新标签：{ $message }

similar-works-tags-refresh =
    .label = 刷新
similar-works-tags-invalid-name = 请输入有效名称（最多 255 字符）。

similar-works-pref-tags-heading = 标签名称
similar-works-pref-tag-style =
    .value = 名称格式
similar-works-pref-tag-hashtag =
    .label = 在开头加 #

similar-works-pref-exclude-colored-tags =
    .label = 排除有颜色的标签
similar-works-pref-excluded-tags =
    .value = 排除标签
similar-works-pref-excluded-tags-help = 每行一个，同名变体也排除。
similar-works-tags-protected = 标签已被排除，请检查设置。

similar-works-tags-select-all = 全选
similar-works-tags-selection-count = { $visible } / { $total } · 已选 { $selected }
    { $hidden ->
        [0] { "" }
       *[other] · { $hidden } 项隐藏
    }
similar-works-tags-action = 操作
similar-works-tags-format =
    .label = 重命名
similar-works-tags-merge-action =
    .label = 合并
similar-works-tags-preparing = 正在准备预览…
similar-works-tags-format-preview = 改名 { $count } · 条目 { $items } · 合并 { $merges }
similar-works-tags-formatted = 已转换 { $count } 个标签的格式。
similar-works-tags-no-matches = 没有匹配的标签。

similar-works-tags-delete-action =
    .label = 删除

similar-works-tags-delete-button =
    .label = 删除

similar-works-tags-merge-button =
    .label = 合并

similar-works-tags-rename-button =
    .label = 重命名

similar-works-tags-delete-preview = 从 { $count } 个条目移除 { $tags } 个标签？

similar-works-tags-rename-preview = 重命名 { $count } 个条目上的标签。

similar-works-tags-deleted = 已删除 { $count } 个标签。

similar-works-tags-renamed = 已改名为“{ $name }”。

similar-works-pref-tag-sentence =
    .label = 句首大写
similar-works-pref-tag-title =
    .label = 每词首字母大写

similar-works-tags-clear-selection =
    .label = 清除选择




similar-works-source = 来自

similar-works-tags-window =
    .title = 标签管理


similar-works-tags-name-column = 名称
similar-works-tags-count-column = 条目数
similar-works-tags-group-column = 匹配
similar-works-tags-format-action =
    .label = 统一格式
similar-works-tags-match-name = 名称变体
similar-works-tags-match-plural = 单复数
similar-works-tags-match-abbreviation = 缩写
similar-works-tags-match-spelling = 拼写相近

similar-works-tags-collision = 该名称已存在，标签将合并。
similar-works-tags-format-button =
    .label = 统一格式

similar-works-tags-match-alias = 术语别名

similar-works-more = 更多
similar-works-evidence = 匹配依据
similar-works-evidence-current = 当前论文
similar-works-evidence-match = 匹配论文
similar-works-evidence-empty = 尚未在可用文本中定位到共同表述。
similar-works-evidence-failed = 依据未能加载，请重试。

similar-works-pref-cache-ready = 已就绪 · { $count } 篇
