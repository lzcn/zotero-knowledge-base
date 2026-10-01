# Zettel Knowledge Base

[English](README.md)

[![Built with ChatGPT](https://img.shields.io/badge/Built_with-ChatGPT-10A37F?style=flat)](https://chatgpt.com/)

在 Zotero 中管理相互连接的卡片：一张卡片写一个想法，保留出处，用链接连接相关想法。

本项目主要借助 ChatGPT 构建，也少量使用了 DeepSeek。

## 功能

- 用 Markdown 写卡片，支持图片、链接、表格、代码和实时预览。
- 搜索卡片、插入链接，查看哪些卡片链接到当前卡片。
- 搜索 Zotero 文献，在文献侧栏查看关联卡片。
- 用关系图浏览全部卡片或当前卡片的连接。
- 从 PDF 高亮创建卡片，支持批量操作。

## 安装与使用

需要 Zotero 7 或更新版本。

在 Zotero 的“工具 → 插件”中，点击齿轮菜单，选择“从文件安装插件”，安装 `.xpi` 文件后重启。

通过“工具 → Zettel 知识库”打开卡片库。新建卡片，写下想法，选择来源，再链接相关卡片。`Ctrl/Cmd+S` 保存，`Ctrl/Cmd+K` 搜索要链接的卡片。

## 备份

卡片保存在 Zotero 数据目录中的 `zettel-knowledge-base.sqlite`，图片保存在 `zettel-knowledge-base-assets/`。退出 Zotero 后，同时备份这两项。

卡片目前不通过 Zotero 同步，也不支持 Markdown 导入和导出。

## 开发

需要 Node.js ≥ 22.13。

```sh
npm ci             # 安装依赖
npm run check      # 测试、构建和代码检查
npm run release    # 生成本地安装包
```

## 许可

[AGPL-3.0-or-later](LICENSE)。包含 [Zotero Plugin Template](https://github.com/windingwind/zotero-plugin-template) 的代码。第三方库保留各自的许可证。
