# Knowledge Base

<img src="addon/content/icons/icon-256.png" width="64" height="64" alt="Knowledge Base" />

[![AI-assisted development: ChatGPT](https://img.shields.io/badge/AI--assisted-ChatGPT-10A37F?style=flat)](https://chatgpt.com/) [![AI-assisted development: DeepSeek](https://img.shields.io/badge/AI--assisted-DeepSeek-4D6BFE?style=flat)](https://www.deepseek.com/)

本项目的代码几乎全部由 ChatGPT 和 DeepSeek 生成。

[English](README.md) | **简体中文**

在 Zotero 中统一管理文献笔记、想法卡片和自己的思考。

## 安装

manifest 支持 Zotero 7–10。从 [Releases](https://github.com/lzcn/zotero-knowledge-base/releases) 下载 XPI，通过 **工具 → 插件 → 从文件安装插件** 安装，然后重启 Zotero。

确认退出 Zotero 时取消 AI 任务并等待 CLI 子进程结束；退出屏障先完成本地草稿和排队写入，再关闭数据库，重启后可恢复草稿。

## 使用

通过 **工具 → 知识库** 或文献库工具栏按钮打开。在设置中选择 **Zotero 标签页** 或 **独立窗口**。

- **文献笔记**：每篇文献一份，从条目侧栏打开。
- **卡片（Zettel）**：一张卡片记录一个想法，可关联来源。
- **思考笔记**：记录问题、项目、草稿和导航。

选择笔记后直接使用 Zotero 原生编辑器，首行作为标题。修改自动保存，`Ctrl/Cmd+S` 立即保存。工具栏按钮可切换 Markdown；通过 **更多** 更换来源、上级，转换卡片／思考笔记，或在独立窗口中编辑。

可按标题、正文或 ID 搜索，在列表工具栏排序，用前进／后退返回已打开的笔记。`Ctrl/Cmd+F` 搜索，`Ctrl/Cmd+N` 新建，`Ctrl/Cmd+Delete` 将选中笔记移入 Zotero 回收站；macOS 也支持 `Cmd+Backspace`。从回收站恢复后，原卡片会重新连接。

用 `[[ID]]` 或链接选择器（`Ctrl/Cmd+K`）连接笔记。普通模式和 Markdown 模式中输入 `[[` 都会显示候选笔记，继续输入可按标题或 ID 筛选；用方向键和 Enter、Tab 或点击选择，Escape 关闭列表。普通模式下粘贴复制的 `[[ID]]` 会插入对应笔记链接，保留原生撤销和自动保存；未知 ID 保留为原文。`[[ID|文字]]` 自定义链接文字，`[@CitationKey]` 引用文献。修改 **笔记 ID** 后，旧链接仍然有效。来源、上级、子笔记、链接和反向链接均可点击跳转。来源按设置中选择的引用格式显示。

## AI（实验性）

AI 功能默认关闭。在**设置 → Knowledge Base → AI 设置…**中启用，并配置 DeepSeek、OpenCode Go 或 Codex。关闭会取消分析、清除待审阅建议并隐藏“建立联系”，保留已有设置和登录管理器密钥。OpenCode 只提供 [Go 订阅](https://opencode.ai/v2/docs/console/go/) 接入，不再提供 Console API 和 OpenCode CLI 选项；其原有存储配置保持不变。API 服务填写密钥和模型，Codex 使用已安装程序和登录状态。

**建立联系**仍是已保存 Zettel 唯一的 AI 操作。

分析将完整标题目录与本机正文关键词、有效的缓存摘要、树形及链接邻近笔记合并检索。模型可用同义词和翻译扩展查询；即使标题筛选漏选，本机检索到的候选仍可进入下一步。最多 36 篇候选摘要分别筛选组织上级和语义联系，再读取最多八篇入选全文核对建议。摘要仅在标题和正文未变时复用。分析可取消，不自动应用修改。

审阅界面展示关系类型、理由、双方逐字可核对的原文，以及将变为链接的文字；上级建议同时展示现有上级和建议路径。引文必须出现在实际笔记正文中，伪造证据会被拒绝。逐项勾选后应用，保留原文和格式，跳过已有链接；笔记已变化或上级会形成循环时，建议失效。AI 单篇读取上限为 60,000 字符，全文合计上下文上限为 180,000 字符。这些校验验证原文依据与流程行为，并不保证所有知识关系的语义判断都正确。

## 图谱与编辑

**全局图谱** 显示整个网络，**局部图谱** 显示附近笔记。单击选择、双击打开、拖动调整，滚动平移、捏合缩放。在设置中调整局部深度、标题长度、标签继承和图谱分组；先匹配的分组决定颜色。标签读取自 Zotero，不从笔记正文生成。

编辑冲突时保留恢复草稿；重新打开后处理，或 **另存为新卡片** 保留两个版本。无来源笔记存放在所属文献库的 **个人知识** 下，选择或清除来源会调整位置，不替换原笔记。

## 数据与备份

正文和嵌入图片使用 Zotero 原生存储和正常同步。卡片 ID、来源、层级、图谱链接和草稿仍位于 `knowledge-base.sqlite`，暂不通过 Zotero 同步。在 Zotero 中编辑关联笔记会刷新本机卡片。在 Knowledge Base 删除笔记时，也将关联的 Zotero 笔记移入 Zotero 回收站，包括此前关联的用户笔记。笔记从 Knowledge Base 隐藏，直到在 Zotero 中恢复。笔记仍在 Zotero 回收站时，保留原文献库与 Note Key 的关联、卡片 ID 和关系。在 Zotero 恢复后，原卡片和已打开的编辑器自动重新连接，重启后也可继续使用；不从 Markdown 重建正文。确认原笔记已永久删除后，清除失效卡片和关联，不再提供从已保存缓存另存替代笔记的入口。来源缺失时保留原来的键，直到主动重新关联，不自动移动笔记。

启动及每次打开工作台时（包括重新打开已有标签页），分批核对关联笔记在 Zotero 中的状态；内容未变时跳过重新索引和写入。列表和图谱排除 Zotero 回收站中的笔记；在 Zotero 中恢复原笔记后，同一张卡片重新显示。这些页面可以正常切换，不强制保存已删除的原笔记。仅选中的笔记加载编辑器，列表仅渲染可视区域；不会自动复活笔记。工作台下方的**不可用的链接**默认折叠，区分回收站中的目标与未解析的引用，并列出仍可用的引用来源笔记。打开来源笔记可修正或移除链接；在 Zotero 恢复原笔记后会重新连接，点击缺失目标不会创建替代卡片。

保存日志在更新 Zotero 前持久记录卡片改动。保存中断后，启动时补齐匹配的卡片元信息，不重写笔记正文；如果任一版本后来发生变化，则保留草稿供恢复。这保护本机跨数据库保存，不提供卡片数据库同步。

退出 Zotero 后备份整个 Zotero 数据目录，包括 `knowledge-base.sqlite` 和 `knowledge-base/assets/`。插件从空知识库开始，只管理通过插件创建的笔记，不扫描或导入旧文献库内容；一次性文献库整理工具放在插件外部。

在 Zotero 笔记或父条目中管理标签。**设置 → Knowledge Base → 继承父级标签**默认开启，将笔记自身、Zotero 父条目和上级卡片的标签一起显示；实时读取，不向原生笔记复制标签，修改、移动或移除父级后自动更新。**图谱分组**可为每组选择标签和颜色，使用上移调整优先级；先匹配的分组决定颜色，同组笔记在图谱中聚集，底部图例显示分组。未匹配分组时沿用 Zotero 标签颜色或稳定的默认颜色。带空格的标签保持为一个完整标签。正文里的井号文字只作为正文，不创建或修改标签。

只支持当前数据库及 Markdown 片段格式；其他数据库版本拒绝打开且不改写，不再在启动时转换历史表结构或旧 Key。

## 开发

`npm run test:connections:host` 在临时 Zotero 目录中验证 AI 连接流程，覆盖密钥、进程取消、审阅应用、重启持久性和退出清理。模型响应使用受控测试数据，真实服务连通性另行验证。

### 实现方法

普通笔记搜索使用 `src/modules/search.ts` 中的本地 SQLite 双字符倒排索引，优先匹配完整 Key／标题，再校验原文子串，不使用向量模型。`src/ui/graph-layout.ts` 在 Worker 中运行 d3-force。

需要 Node.js 22.13+（22.x）或 24+。依次运行 `npm ci`、`npm run check`。

- `npm run build`：输入未变化时复用有效产物。在上级工作区运行 `make` 可统一构建三个插件。
- `npm run clean`：清理构建产物，保留已下载工具、依赖、研究数据和发布文件。
- `npm run build:force`：强制重建。
- `npm run check`：格式、静态检查、测试和类型检查；复用有效 XPI。
- `npm run benchmark:graph`：在临时 Zotero 配置中对同一组 1200 节点比较 Canvas 与 WebGL2，分别记录 CPU 绘制提交耗时和显示帧间隔；使用 `KB_GRAPH_BENCHMARK_OUTPUT` 保存 JSON 结果。
- `npm run benchmark:loading`：在临时 Zotero 配置的 100 篇笔记库中测量重复核查、工作台打开和来源排版复用；使用 `KB_LOADING_BENCHMARK_OUTPUT` 保存 JSON 结果。测量针对已运行的宿主，不含 Zotero 启动耗时。
- `npm run release`：完整检查后，在 `release/v<版本>/` 准备 XPI、`SHA256SUMS` 和 `updates.json`。

构建产物：`dist/zotero-knowledge-base.xpi`。安装后在 Zotero 中验证改动。`npm run test:host` 使用临时配置和数据目录检查启动、保存及退出；`npm run test:cursor` 对比启用插件前后及 Markdown 切换后的原生公式导航和行首输入；通过 `ZOTERO_BINARY` 指定其他宿主程序。在 `.env` 中配置本地路径后可用 `npm start` 开发。

`note-sessions.ts` 管理共享笔记快照和写入队列，`events.ts` 管理带作用范围的改动通知。`document-merge.ts` 在限定工作量内合并独立的行改动，`note-operations.ts` 记录并协调原生笔记与卡片保存。`search.ts` 维护可重建的 SQLite 双字符倒排索引和游标分页，不依赖 FTS 扩展；单字符搜索使用原文子串扫描。`graph-layout-worker.ts` 在界面线程外计算图谱布局。测试覆盖并发及中断保存、草稿版本更新、独立编辑、中文索引检索、分页、链接增量更新和 Worker 取消；宿主测试检查原生编辑器同步及重启恢复。

本地发布准备不创建 tag 或上传文件。共同开发规范见工作区根目录 `AGENTS.md`。

## 许可证

Copyright © 2026 Zhi Lu. [AGPL-3.0-or-later](LICENSE)。第三方库保留各自许可证。
