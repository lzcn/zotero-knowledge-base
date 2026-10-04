# Knowledge Base

<img src="addon/content/icons/icon-256.png" width="64" height="64" alt="Knowledge Base" />

[![AI-assisted development: ChatGPT](https://img.shields.io/badge/AI--assisted-ChatGPT-10A37F?style=flat)](https://chatgpt.com/) [![AI-assisted development: DeepSeek](https://img.shields.io/badge/AI--assisted-DeepSeek-4D6BFE?style=flat)](https://www.deepseek.com/)

本项目的代码几乎全部由 ChatGPT 和 DeepSeek 生成。

[English](README.md) | **简体中文**

在 Zotero 中统一管理文献笔记、想法卡片和自己的思考。

## 安装

manifest 支持 Zotero 7–10。从 [Releases](https://github.com/lzcn/zotero-knowledge-base/releases) 下载 XPI，通过 **工具 → 插件 → 从文件安装插件** 安装，然后重启 Zotero。

## 使用

打开 **工具 → 知识库**，按类型筛选和新建笔记。

- **文献笔记（Literature Note）**：每个文献条目一篇。从条目侧栏打开，首次使用时创建，再次打开复用同一篇；必须关联文献来源。
- **卡片（Zettel）**：记录一个想法，同一条目可有多张卡片。
- **思考笔记（Thinking Note）**：容纳 Ideas、Projects、综述、文章草稿和导航，来源可留空。

三类笔记共用原生编辑器、搜索、链接、层级和图谱。编辑器中的类型选择可以重新分类；文献笔记会检查来源和唯一性。

每张卡片写一个想法，选择来源，用 `[[ID]]` 连接相关卡片。`[[ID]]` 保持原样且可点击；用 `[[ID|自定文字]]` 或 `[自定文字](knowledge-base://card/ID)` 指定链接文字。用 `[@CitationKey]` 引用条目，阅读时显示可点击的作者年份；引用键来自 Zotero、Better BibTeX 或 Extra 中的 `Citation Key:`。Zotero 笔记用普通的 `[自定标题](zotero://select/…)` 超链接。卡片库默认显示全部卡片，可筛选入口点；列表摘要和前进／后退帮助返回之前的想法。每张卡片最多一个父卡片，图谱分别展示层级、引用和来源。在 Zotero 设置中选择显示内容，选择自动保存。

卡片现在使用 Zotero 原生笔记编辑器。直接使用原生排版、表格、图片、引用和公式编辑；选中公式即可就地修改 LaTeX。第一个标题就是卡片标题。正文由 Zotero 自动保存，来源和卡片关系在停止操作片刻后保存。“保存”与 `Ctrl/Cmd+S` 保持窗口打开。`Ctrl/Cmd+K` 搜索要链接的卡片；**插入** 菜单添加引用，不会替换主要来源。

使用**浏览／编辑**按钮或 `Ctrl/Cmd+E` 切换，两种状态都使用 Zotero 原生笔记组件，保留白色纸张和紧凑关系区。Ctrl/Cmd 点击链接跳转。`Ctrl/Cmd+W` 在卡片信息尚未保存时提供保存、取消、保留草稿；原生编辑器已经保存的正文会保留。恢复草稿先以只读预览显示，点击保存后应用到笔记。冲突草稿仍可恢复，**另存为新卡片** 保留两个版本，并复制嵌入图片。

来源可留空。有文献条目来源的笔记放在该条目下面；无来源的放进 **Knowledge Base** 集合。来源若是附属笔记，则放在它所属的文献条目下；独立来源笔记、缺失来源或其他文献库的来源仍保留链接，卡片笔记放在自身文献库的集合中。更换或清除来源时调整归属，保持笔记 ID。插件新建的笔记在启动时整理，旧 Markdown 卡片在打开时迁移。已经登记的现有 Zotero 笔记保留原来的位置；只有主动更换来源时调整归属。Zotero 文献库总览仍会显示集合中的笔记。

## 数据与备份

已有卡片首次打开编辑时转换为真正的 Zotero 笔记，原 Markdown 保留在 `knowledge-base.sqlite` 中。转换后的正文和嵌入图片使用 Zotero 的存储和正常同步。卡片 ID、来源、层级、图谱链接和草稿仍位于 `knowledge-base.sqlite`，暂不通过 Zotero 同步。在 Zotero 中编辑关联笔记会刷新本机卡片。删除插件新建的笔记会将关联原生笔记移入 Zotero 回收站；从知识库移除登记的现有笔记时，原笔记会保留。关联笔记缺失时，请先在 Zotero 中恢复。

退出 Zotero 后备份整个 Zotero 数据目录，包括 `knowledge-base.sqlite` 和旧图片目录 `knowledge-base/assets/`。不提供导入入口。现有 Zotero 笔记可以直接按原笔记身份纳入管理，不复制正文，保留图片、引用、标签和原链接。原自建编辑器保留在 `src/ui/markdown-editor/`，仅供开发使用，没有界面入口，不参与构建或 XPI 打包。

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
