# Knowledge Base

<img src="addon/content/icons/icon-256.png" width="64" height="64" alt="Knowledge Base" />

[English](README.md) | **简体中文**

在 Zotero 中管理文献笔记、想法卡片和思考笔记。

## 安装

支持 Zotero 7–10。从 [Releases](https://github.com/lzcn/zotero-knowledge-base/releases/latest) 下载 XPI，通过 **工具 → 插件 → 从文件安装插件** 安装，然后重启 Zotero。

## 使用

通过 **工具 → 知识库** 或工具栏按钮打开。

- 创建 **文献笔记**、**卡片（Zettel）** 或 **思考笔记**。使用 Zotero 原生编辑器或 Markdown，修改自动保存。
- 用 `[[ID]]` 连接笔记，`[[ID|文字]]` 自定义链接文字，`[@CitationKey]` 引用文献。输入 `[[` 可选择笔记。
- 按标题、正文或 ID 搜索，浏览上级、子笔记、反向链接和局部／全局图谱。

在设置中调整工作台窗口、引用格式、标签继承和图谱外观。实验性 AI 联系建议默认关闭，启用时需配置服务；核对并勾选建议后才会应用。

## 数据与备份

正文和图片使用 Zotero 存储与同步。卡片 ID、层级、链接和恢复草稿保存在本机 `knowledge-base.sqlite`，不通过 Zotero 同步。

删除卡片会将关联的 Zotero 笔记移入回收站；恢复原笔记后重新连接，永久删除后清除关联。编辑冲突会保留恢复草稿。

退出 Zotero 后备份完整数据目录，包括 `knowledge-base.sqlite` 和 `knowledge-base/assets/`。插件从空知识库开始，不自动导入已有笔记；不支持的数据库格式会被拒绝，不改写数据。

## 开发

需要 Node.js 22.13+（22.x）或 24+。

```sh
npm ci
npm run check
npm run build
```

产物：`dist/zotero-knowledge-base.xpi`。`npm run test:host` 使用临时 Zotero 目录；`npm run release` 在 `release/v<版本>/` 准备本地文件，不上传。

## 许可证

Copyright © 2026 Zhi Lu. [AGPL-3.0-or-later](LICENSE)。代码借助 ChatGPT 和 DeepSeek 开发。
