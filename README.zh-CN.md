# Knowledge Base

<img src="addon/content/icons/icon-256.png" width="64" height="64" alt="Knowledge Base" />

[English](README.md) | **简体中文**

在 Zotero 中管理笔记、整理标签、发现相似条目。

## 安装

需要 Zotero 10。从 [Releases](https://github.com/lzcn/zotero-knowledge-base/releases/latest) 下载 XPI。在**工具**菜单中打开**插件**，选择**从文件安装插件**，然后重启 Zotero。

## 使用

在**工具**菜单中打开**知识库**，或使用文献库、PDF 工具栏中的按钮。

- **笔记：** 原生或 Markdown 编辑，自动保存。用 `[[ID]]` 连接笔记，支持搜索和图谱，自动继承来源和上级笔记标签。设置中通过**管理模板…**直接浏览、编辑模板，并指定新笔记使用的模板。
- **推荐标签：** 统一按相关度展示最多六个高置信主题，新标签与已有标签使用不同颜色标记；勾选后添加到当前论文。顶部操作栏提供“添加所选标签”和右侧的“标签管理”。
- **相似条目：** 在本地查找相似文献，默认包含无全文条目，不自动连接笔记。macOS 语义检索会自动下载所需文件。

三个切换页共用同一个文献库运行时，各窗口共享索引和结果。启动时直接恢复完成后的检索缓存；未变文献复用向量和已保存结果，新增或变化的文献在后台更新。升级后首次启动会从已有索引生成新的缓存。设置页用浅色分区卡片区分各组配置，缓存状态保持简短。

## 备份

正文使用 Zotero 同步。ID、层级和链接保存在本机 `knowledge-base.sqlite` 数据库中。退出 Zotero 后备份其数据目录，包括此数据库和 `knowledge-base/` 文件夹。

资源统一由存储模块管理，在 Zotero 数据目录中的布局如下：

```text
knowledge-base.sqlite
knowledge-base/
  assets/
  cache/
    similar-items/
    coreml/minilm-l6-v2/
  models/minilm-l6-v2/
  runtime/onnx/
```

图片放在 `assets/`；检索与模型编译缓存放在 `cache/`；下载资源放在 `models/` 和 `runtime/`。目标目录不存在时会接续使用旧检索和 Core ML 缓存。独立 Related Work 的数据保留在原处。`-wal`、`-shm` 由 SQLite 自动管理。

## 开发

需要 Node.js 22.13+（22.x）或 24+。

```sh
npm ci
npm run check
npm run build
```

产物：`dist/zotero-knowledge-base.xpi`。

## 许可证

Copyright 2026 Zhi Lu. [AGPL-3.0-or-later](LICENSE)。代码借助 ChatGPT 和 DeepSeek 开发。
