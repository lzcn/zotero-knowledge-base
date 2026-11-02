# Knowledge Base

<img src="addon/content/icons/icon-256.png" width="64" height="64" alt="Knowledge Base" />

[English](README.md) | **简体中文**

在 Zotero 中管理笔记、整理标签、发现相似条目。

## 安装

需要 Zotero 10。从 [Releases](https://github.com/lzcn/zotero-knowledge-base/releases/latest) 下载 XPI。在**工具**菜单中打开**插件**，选择**从文件安装插件**，然后重启 Zotero。

## 使用

在**工具**菜单中打开**知识库**，或使用文献库、PDF 工具栏中的按钮。

- **笔记：** 原生或 Markdown 编辑，自动保存。用 `[[ID]]` 连接笔记，支持搜索和图谱，模板可选。
- **标签：** 通过标签管理器重命名、合并或删除 Zotero 原生标签。
- **相似条目：** 在本地查找相似文献，不自动连接笔记。macOS 语义检索会自动下载所需文件。

选项集中在 Knowledge Base 设置中。

## 备份

正文使用 Zotero 同步。ID、层级和链接保存在本机 `knowledge-base.sqlite` 数据库中。退出 Zotero 后备份其数据目录，包括此数据库和 `knowledge-base/` 文件夹。

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
