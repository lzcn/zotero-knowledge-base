# Knowledge Base

<img src="addon/content/icons/icon-256.png" width="64" height="64" alt="Knowledge Base" />

[English](README.md)

[![Built with ChatGPT](https://img.shields.io/badge/Built_with-ChatGPT-10A37F?style=flat)](https://chatgpt.com/) [![Built with DeepSeek](https://img.shields.io/badge/Built_with-DeepSeek-4D6BFE?style=flat)](https://www.deepseek.com/)

在 Zotero 中管理相互连接的想法卡片：用自己的话写下一个想法，保留出处，并链接相关想法。

## 功能

- 链接已有 Zotero 文献和笔记，不复制原内容。

- 用 Markdown 写卡片，支持图片、链接、表格、代码和实时预览。
- 搜索卡片、插入链接，查看反向链接。
- 关联 Zotero 文献，在文献侧栏查看卡片。
- 用关系图浏览全部卡片或当前卡片的连接。
- 从 PDF 高亮创建卡片，支持批量操作。
- 自动清理不再被卡片或打开的草稿使用的图片。

## 安装

需要 Zotero 7–10。

在 Zotero 的“工具 → 插件”中，点击齿轮菜单，选择“从文件安装插件”，选择 `.xpi` 文件后重启。

## 使用

通过“工具 → 知识库”打开卡片库。每张卡片写一个想法，选择来源，再链接相关卡片。`Ctrl/Cmd+S` 保存，`Ctrl/Cmd+K` 搜索要链接的卡片。

## 数据与备份

卡片保存在 Zotero 数据目录中的 `knowledge-base.sqlite`，图片保存在 `knowledge-base/assets/`。退出 Zotero 后，同时备份数据库和图片目录。

卡片目前不通过 Zotero 同步，不支持 Markdown 文件导入或导出。

## 开发

需要 Node.js 22.13+（22.x）或 24+。在插件目录中执行：

```sh
npm ci             # 安装锁定依赖
npm run build      # 类型检查并生成 XPI
npm run check      # 格式、静态检查、测试与构建
npm run release    # 完整检查并准备本地发布文件
```

本地调试：安装 `dist/zotero-knowledge-base.xpi`，重启 Zotero 并检查插件功能。修改后重新构建并安装。

发布文件位于 `release/v0.1.0/`，包含 `zotero-knowledge-base-0.1.0.xpi`、`SHA256SUMS` 和 `updates.json`。`npm run release` 不上传文件；正式发布时，将安装包和 `updates.json` 上传到对应版本的 Release assets。

配置本机 `.env` 中的 Zotero 路径和开发 profile 后，可用 `npm start` 启动开发调试。

## 许可证

Copyright © 2026 Zhi Lu. [AGPL-3.0-or-later](LICENSE)。第三方库保留各自的许可证。
