# Knowledge Base

<img src="addon/content/icons/icon-256.png" width="64" height="64" alt="Knowledge Base" />

[![AI-assisted development: ChatGPT](https://img.shields.io/badge/AI--assisted-ChatGPT-10A37F?style=flat)](https://chatgpt.com/) [![AI-assisted development: DeepSeek](https://img.shields.io/badge/AI--assisted-DeepSeek-4D6BFE?style=flat)](https://www.deepseek.com/)

本项目的代码几乎全部由 ChatGPT 和 DeepSeek 生成。

[English](README.md) | **简体中文**

在 Zotero 中管理想法卡片，保留来源，并链接相关想法。

## 安装

manifest 支持 Zotero 7–10。从 [Releases](https://github.com/lzcn/zotero-knowledge-base/releases) 下载 XPI，通过 **工具 → 插件 → 从文件安装插件** 安装，然后重启 Zotero。

## 使用

打开 **工具 → 知识库**。每张卡片写一个想法，选择来源，用 `[[ID]]` 连接相关卡片。链接显示当前标题并保留稳定编号。卡片库默认显示全部卡片，可筛选入口点；列表摘要和前进／后退帮助返回之前的想法。每张卡片最多一个父卡片，图谱分别展示层级、引用和来源。在 Zotero 设置中选择显示内容，选择自动保存。也可从 PDF 高亮创建卡片。

使用 Markdown 或可视编辑器插入图片、表格、代码及公式（`$…$` 或 `$$…$$`）；点击公式修改 LaTeX。停止输入片刻后自动保存，“保存”与 `Ctrl/Cmd+S` 保持编辑窗口打开。恢复草稿保存在数据库中，可从卡片库重新打开。冲突修改保留为草稿，使用 **另存为新卡片** 保留两个版本。`Ctrl/Cmd+K` 搜索要链接的卡片；点击 **插入** 或在 Markdown 行首输入 `/` 使用插入命令。

操作控件遵循 Zotero 原生样式，阅读与编辑区域使用白色底，导航区域用浅灰和蓝色区分层级。通过原生模式菜单选择浏览、所见即所得或 Markdown 源码，三种模式均独占正文区域；Ctrl/Cmd+E 切换浏览与编辑。关系展开为紧凑、可滚动的列表。所见即所得模式中按住 Ctrl/Cmd 点击链接跳转。

## 数据与备份

卡片位于 Zotero 数据目录的 `knowledge-base.sqlite`，图片位于 `knowledge-base/assets/`。退出 Zotero 后同时备份两者。卡片目前不通过 Zotero 同步，不支持 Markdown 文件导入或导出。

## 开发

需要 Node.js 22.13+（22.x）或 24+。依次运行 `npm ci`、`npm run check`。

- `npm run build`：输入未变化时复用有效产物。
- `npm run build:force`：强制重建。
- `npm run check`：格式、静态检查、测试和类型检查；复用有效 XPI。
- `npm run release`：完整检查后，在 `release/v<版本>/` 准备 XPI、`SHA256SUMS` 和 `updates.json`。

构建产物：`dist/zotero-knowledge-base.xpi`。安装后在 Zotero 中验证改动。`npm run test:host` 使用临时配置和数据目录检查启动、保存及退出；通过 `ZOTERO_BINARY` 指定其他宿主程序。在 `.env` 中配置本地路径后可用 `npm start` 开发。

本地发布准备不创建 tag 或上传文件。共同开发规范见工作区根目录 `AGENTS.md`。

## 许可证

Copyright © 2026 Zhi Lu. [AGPL-3.0-or-later](LICENSE)。第三方库保留各自许可证。
