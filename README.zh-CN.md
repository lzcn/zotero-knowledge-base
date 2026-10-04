# Knowledge Base

<img src="addon/content/icons/icon-256.png" width="64" height="64" alt="Knowledge Base" />

[![AI-assisted development: ChatGPT](https://img.shields.io/badge/AI--assisted-ChatGPT-10A37F?style=flat)](https://chatgpt.com/) [![AI-assisted development: DeepSeek](https://img.shields.io/badge/AI--assisted-DeepSeek-4D6BFE?style=flat)](https://www.deepseek.com/)

本项目的代码几乎全部由 ChatGPT 和 DeepSeek 生成。

[English](README.md) | **简体中文**

在 Zotero 中管理想法卡片，保留来源，并链接相关想法。

## 安装

manifest 支持 Zotero 7–10。从 [Releases](https://github.com/lzcn/zotero-knowledge-base/releases) 下载 XPI，通过 **工具 → 插件 → 从文件安装插件** 安装，然后重启 Zotero。

## 使用

打开 **工具 → 知识库**。每张卡片写一个想法，选择来源，用 `[[ID]]` 连接相关卡片。`[[ID]]` 保持原样且可点击；用 `[[ID|自定文字]]` 或 `[自定文字](knowledge-base://card/ID)` 指定链接文字。用 `[@CitationKey]` 引用条目，阅读时显示可点击的作者年份；引用键来自 Zotero、Better BibTeX 或 Extra 中的 `Citation Key:`。Zotero 笔记用普通的 `[自定标题](zotero://select/…)` 超链接。卡片库默认显示全部卡片，可筛选入口点；列表摘要和前进／后退帮助返回之前的想法。每张卡片最多一个父卡片，图谱分别展示层级、引用和来源。在 Zotero 设置中选择显示内容，选择自动保存。也可从 PDF 高亮创建卡片。

卡片现在使用 Zotero 原生笔记编辑器。直接使用原生排版、表格、图片、引用和公式编辑；选中公式即可就地修改 LaTeX。第一个标题就是卡片标题。正文由 Zotero 自动保存，来源和卡片关系在停止操作片刻后保存。“保存”与 `Ctrl/Cmd+S` 保持窗口打开。`Ctrl/Cmd+K` 搜索要链接的卡片；**插入** 菜单添加引用，不会替换主要来源。Markdown 源码模式支持行首 `/` 命令。

选择浏览、所见即所得或 Markdown 源码，三种模式均独占正文区域，使用白色纸张、原生控件和紧凑关系区。源码是原生 HTML 笔记的 Markdown 表达：简单引用保留 `[@CitationKey]`，复杂引用、批注和嵌入图片保留结构化 HTML。应用源码修改时，排版可能被规范化。`Ctrl/Cmd+E` 切换浏览与编辑；Ctrl/Cmd 点击链接跳转。`Ctrl/Cmd+W` 在源码或卡片信息尚未保存时提供保存、取消、保留草稿；原生编辑器已经保存的正文会保留。冲突的源码修改保留为恢复草稿，**另存为新卡片** 保留两个版本，并复制嵌入图片。

## 数据与备份

已有卡片首次打开编辑时转换为真正的 Zotero 笔记，原 Markdown 保留在 `knowledge-base.sqlite` 中。转换后的正文和嵌入图片使用 Zotero 的存储和正常同步。卡片 ID、来源、层级、图谱链接和草稿仍位于 `knowledge-base.sqlite`，暂不通过 Zotero 同步。在 Zotero 中编辑关联笔记会刷新本机卡片。删除卡片会将关联原生笔记移入 Zotero 回收站；关联笔记缺失时，请先在 Zotero 中恢复。

退出 Zotero 后备份整个 Zotero 数据目录，包括 `knowledge-base.sqlite` 和旧图片目录 `knowledge-base/assets/`。不支持 Markdown 文件导入或导出。

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
