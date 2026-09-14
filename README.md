# DomainAtlas

[English](#english) | [中文](#中文)

## English

DomainAtlas maintains a dynamically updated business map of your project as it evolves through AI-assisted development. Its core purpose is to help you understand the project's business domains and capabilities. An append-only change ledger supports the map with evidence and a traceable history of changes.

Build an initial two-level map (domain → capability) of existing code with `domainatlas build --input <file>` after the DomainAtlas skill analyzes business responsibilities using a ready codebase-memory index, source and documentation. Missing analysis input stops the build; automatic path/symbol inference is disabled. Completed Codex or Cursor tasks then extend the map incrementally. Initialization alone does not build a map; baseline construction does not replay Git history.

### Installation (recommended)

Requires **Node.js 22+** and Git. Install the published [npm package](https://www.npmjs.com/package/domainatlas); the CLI and built Web UI are included.

```sh
npm install -g domainatlas
domainatlas --help
```

The current CLI and global hook workflow target macOS/Linux; native Windows has not been verified.

### Quick start

**1. Install host hooks once (Codex, Cursor, or both):**

```sh
domainatlas init -g --codex
domainatlas init -g --cursor
```

Review and trust the hooks in Codex `/hooks` or Cursor Settings → Hooks. User-level Cursor hooks do not run in Cloud Agents.

**2. Initialize each project you want to map:**

```sh
cd /path/to/your/git-project
domainatlas init
```

Continue working in the connected host. Initialized projects record completed turns automatically without a prompt prefix or skill invocation. If you initialize midway through a turn, recording starts with the next turn. Uninitialized projects and non-Git directories are skipped without creating files.

**3. Build the existing project baseline and open your business map:**

```sh
domainatlas build --input /absolute/path/to/baseline.json
domainatlas ui
```

Open [http://127.0.0.1:4310](http://127.0.0.1:4310) and select your project. Explore the domains and capabilities derived from recorded turns, then inspect supporting changes and evidence. Use `domainatlas list` to inspect the auxiliary ledger; Git determines whether records are pending or committed.

Global hook setup preserves other hooks and backs up the original configuration. It does not initialize the current project. Use `domainatlas init -g --codex --dry-run` to preview installation, `domainatlas init -g --codex --uninstall` to remove its global entries, and `domainatlas init --help` for options. `-g` also accepts `--global`.

The DomainAtlas skill supports natural-language requests to build a business map; automatic recording is independent of skill invocation.

### Use natural language with an AI tool

Install the DomainAtlas CLI, then install the [bundled skill](skills/domainatlas/SKILL.md) into your AI tool’s skills directory and reload the tool’s skills. Run the following prompts in the **target project's workspace**. The AI tool needs access to the project's files and permission to run local commands. In Codex, you can also prefix a request with `$domainatlas`; in other tools, use their skill-loading mechanism. Automatic turn recording uses host hooks (`init -g --codex` or `init -g --cursor`); loading the skill does not enable those hooks.

**Initialize and build a business map with meaningful names:**

> Initialize DomainAtlas for this project, then analyze its source and documentation to build and save a business map. Name domains and capabilities by their business responsibilities, include file evidence, and flag uncertain conclusions. When finished, briefly tell me what was built.

The AI analyzes the business meaning and imports a baseline with `build --input`. The CLI itself does not call a language model. For the remaining examples, initialize the target project first; opening the shared workbench does not require initialization.

**Preview a quick structural map:**

> Use DomainAtlas to preview a business map from up to 100 tracked source files in this project. Do not save the baseline. Tell me how many domains and capabilities were found and whether coverage is limited.

**Open the business map:**

> Open the DomainAtlas workbench so I can select this project and browse its business domains, capabilities, and supporting evidence.

**Inspect recorded changes:**

> Use DomainAtlas to summarize this project's recorded business changes. Show each change's original request, affected capabilities, and whether its record has been committed to Git. Only report information supported by the records.

**Record a completed task when automatic recording is not enabled:**

> Use DomainAtlas to record the business change completed in this task. First check for an existing record to avoid duplication. Include the original request, actual changed files, and verified test results; leave unknown results unspecified.

**Correct an existing record:**

> Use DomainAtlas to correct record change_ID: its affected scope should be “refund review,” not “all order management.” Verify the supporting evidence and append a correction that references the original record.

Replace `change_ID` and the example business names with real values. Once host hooks are installed and trusted and the project is initialized, continue normal development without a DomainAtlas prompt prefix; completed turns are recorded automatically.

### Business map and supporting capabilities

- **Business map:** explore the project's domains and capabilities in a read-only local Web UI, with links to supporting change history and evidence.
- **Incremental updates:** completed Codex or Cursor tasks supply change evidence. Turn-start Git snapshots and turn-end file versions identify incremental changes; duplicate completion events create one record.
- **Code graph evidence:** prefer the locally installed codebase-memory-mcp structured index without reading the full source tree. When unavailable, inspect changed paths only and emit low-confidence domain and capability nodes.
- **Supporting change ledger:** preserve immutable records, original requirements, feedback attribution, and evidence in `.domainatlas/`.
- **Git traceability:** derive the first commit containing each record and expose its actual author and committer. `stage-records` previews matching records and stages their facts with `--write` only when the full recorded before/after versions match HEAD and the index.

### Web UI

Start the shared workbench from any directory:

    domainatlas ui

Open [http://127.0.0.1:4310](http://127.0.0.1:4310), select a project, then view its business map and change history. Use `domainatlas ui --port 4311` to change the port. New `init` calls register projects in the user-level directory. For older projects, run `domainatlas ui --scan /path/to/projects` once.

The UI uses React 19, TypeScript, Vite 7, Tailwind CSS 4 and Lucide; the local API uses Fastify 5.

The UI supports Chinese and English. On first use, browser regions CN, TW, HK and MO default to Chinese; other regions default to English. A Chinese browser language without a region also defaults to Chinese. The language selector remembers your choice. AI-generated business content follows the conversation language; switching the UI language does not translate stored facts.

### Change ledger commands

The host integration boundary can ingest a completed task event:

    domainatlas ingest --host cursor --request "Add refunds" --summary "Added refund review" --changed-file src/billing/refund.ts --test-command "pnpm test" --test-status passed

`ingest-codex` remains an alias for `ingest --host codex`. Corrections never overwrite an earlier record:

    domainatlas ingest --kind correction --supersedes change_ID --request "Correct the affected scope" --summary "Added omitted capabilities" --changed-file src/billing/refund.ts

Inspect records with their Git-derived lifecycle:

    domainatlas list

Preview records that match the currently staged code, then stage their fact files:

    domainatlas stage-records
    domainatlas stage-records --write

### From source (contributors)

Use this option when developing DomainAtlas. Requires Node.js 22+ and the pnpm version pinned in `package.json` (currently 11.13.0).

```sh
git clone https://github.com/chanshawoh/domain-atlas.git
cd domain-atlas
pnpm install --frozen-lockfile
pnpm build
pnpm domainatlas --help
```

To use this build on another project, run `node /absolute/path/to/domain-atlas/dist/src/cli.js <command>` from that project's Git root. Build before enabling hooks, and keep the checkout at a stable path because installed hooks reference the CLI by absolute path.

Run checks in the tool repository:

```sh
pnpm test
# Optional: requires an installed codebase-memory-mcp
pnpm test:graph
```

For frontend development, start the API with `node /absolute/path/to/domain-atlas/dist/src/cli.js ui` from any directory, then run `pnpm dev:web` in a second terminal in the tool repository. Vite proxies `/api` to port 4310. This repository includes `.codex/hooks.json`; its hooks also require review and trust in Codex `/hooks`.

### Maintainer release

The release script follows ImageForge MCP's check-first workflow:

    bash script/release.sh
    bash script/release.sh --publish

The first command builds, tests, audits production dependencies and installs a temporary npm tarball to verify the CLI and Web UI. Only `--publish` publishes that exact tarball to npm, after checking `main`, a clean checkout, remote synchronization, authentication and version availability. It never bumps versions, commits, pushes Git, or creates tags.

### Deliberate MVP boundary

The hook protocol, stdin CLI, Git pre-commit behavior, and real graph-provider ingest are tested in isolated repositories. Hook trust and activation remain environment-specific. File versions describe changes observed during a turn; they do not prove authorship when multiple actors edit the same worktree. Multi-turn combined diffs and partial staging are conservatively left unmatched. MCP transport, database projections, and Web write operations remain future work.

---

## 中文

DomainAtlas 随 AI 辅助开发过程动态更新项目业务图，帮助你理解项目的业务领域和业务能力。业务图是核心能力；仅追加的变更账本是辅助能力，为业务图提供变更证据和可追溯的演进历史。

先配置 codebase-memory 并确认目标项目索引就绪，使用 DomainAtlas skill 分析业务语义，再通过 `domainatlas build --input <文件>` 导入“业务领域 → 业务能力”的初始业务图。缺少分析输入时停止构建，已禁用路径和代码符号自动推断。后续 Codex 或 Cursor 任务持续增量更新业务图。初始化本身不构建业务图；初始基线不回放 Git 历史。

### 安装（推荐）

需要 **Node.js 22+** 和 Git。直接安装已发布的 [npm 包](https://www.npmjs.com/package/domainatlas)，其中已包含 CLI 和构建好的 Web UI。

```sh
npm install -g domainatlas
domainatlas --help
```

当前 CLI 和全局钩子流程面向 macOS/Linux，尚未验证 Windows 原生环境。

### 快速开始

**1. 一次性安装宿主钩子（Codex、Cursor，或两者）：**

```sh
domainatlas init -g --codex
domainatlas init -g --cursor
```

在 Codex `/hooks` 或 Cursor Settings → Hooks 中审核并信任钩子。用户级 Cursor 钩子不会在 Cloud Agent 中运行。

**2. 初始化每个需要构建业务图的项目：**

```sh
cd /path/to/your/git-project
domainatlas init
```

接着正常使用已接入的宿主。已初始化项目会自动记录已完成的轮次，无需提示词前缀或调用技能。如果在一轮任务中途初始化，从下一轮开始记录。未初始化的项目和非 Git 目录会被跳过，不会创建文件。

**3. 构建已有项目的业务基线并打开业务图：**

```sh
domainatlas build --input /absolute/path/to/baseline.json
domainatlas ui
```

打开 [http://127.0.0.1:4310](http://127.0.0.1:4310)，选择项目后浏览业务领域和能力，并查看关联变更及证据。使用 `domainatlas list` 查看辅助账本，由 Git 判断记录处于待提交还是已提交状态。

全局钩子安装会保留其他钩子并备份原配置，不会初始化当前项目。使用 `domainatlas init -g --codex --dry-run` 预览安装，使用 `domainatlas init -g --codex --uninstall` 移除其全局配置项，使用 `domainatlas init --help` 查看选项。`-g` 也可写为 `--global`。

DomainAtlas 技能支持通过自然语言请求构建业务图；自动记录独立于技能调用。

### 在 AI 工具中用自然语言使用

安装 DomainAtlas CLI 后，将[包内技能](skills/domainatlas/SKILL.md)复制到 AI 工具的 skills 目录，并让工具重新加载技能。在**需要分析的目标项目工作区**中发送下面的提示词，AI 工具需能读取项目文件并执行本地命令。Codex 中也可在请求前加 `$domainatlas`，其他工具按各自方式加载技能。当前自动轮次记录通过宿主 hooks 接入（`init -g --codex` 或 `init -g --cursor`），仅加载技能不会启用这些钩子。

**首次初始化并构建有业务含义的业务图：**

> 为当前项目初始化 DomainAtlas，然后分析源码和项目文档，构建并保存业务图。按实际业务职责命名业务领域和能力，附上文件证据，标明不确定的结论。完成后简短告诉我构建了什么。

AI 负责分析业务语义，再通过 `build --input` 导入基线，CLI 本身不调用大模型。下面涉及项目数据的示例需先初始化目标项目；仅打开统一工作台无需初始化。

**快速预览结构，不保存业务图：**

> 用 DomainAtlas 预览当前项目的业务图，最多分析 100 个已跟踪源码文件，不保存基线。告诉我发现了多少个业务领域和能力，以及分析范围是否有限。

**打开业务图浏览：**

> 打开 DomainAtlas 工作台，让我选择当前项目，查看业务领域、业务能力和支撑证据。

**查询已经记录的业务变化：**

> 用 DomainAtlas 汇总当前项目已记录的业务变更，说明每项变更的原始需求、影响的业务能力，以及记录是否已提交到 Git。只报告记录中有证据的信息。

**未启用自动记录时，记录已完成的任务：**

> 用 DomainAtlas 记录本次任务已完成的业务变化。先检查是否已有记录，避免重复；记录原始需求、实际修改的文件和已验证的测试结果，未知结果不要补写。

**更正已有记录：**

> 用 DomainAtlas 更正记录 change_ID：影响范围应为“退款审核”，不是“整个订单管理”。请核对支撑证据，追加一条引用原记录的更正。

将 `change_ID` 和示例业务名称替换为真实内容。已安装并信任宿主 hooks、且项目已初始化时，后续正常提出开发需求即可，完成的轮次会自动记录，无需每次加 DomainAtlas 前缀。

### 业务图与配套能力

- **项目业务图：**在只读本地 Web UI 中浏览项目的业务领域和业务能力，并查看支撑它们的变更历史及证据。
- **增量更新：**已完成的 Codex 或 Cursor 任务提供变更证据，通过轮次开始时的 Git 快照和结束时的文件版本识别增量变更；重复的完成事件只生成一条记录。
- **代码图谱证据：**优先使用本地 codebase-memory-mcp 结构化索引，无需读取完整源码树；不可用时仅检查变更路径，生成低置信度的业务领域和能力节点。
- **辅助变更账本：**在 `.domainatlas/` 中保留不可变记录、原始需求、反馈归属和证据。
- **Git 追溯：**推导首次包含各条记录的提交，展示实际作者和提交者。`stage-records` 预览匹配记录，只有完整的变更前后版本与 HEAD 和暂存区一致时，才通过 `--write` 暂存其事实文件。

### Web UI

在任意目录启动统一项目工作台：

    domainatlas ui

打开 [http://127.0.0.1:4310](http://127.0.0.1:4310)，从全部项目列表进入业务图和历史变更。使用 `domainatlas ui --port 4311` 修改端口。新版本 `init` 会登记项目；旧版项目可通过 `domainatlas ui --scan /项目父目录` 一次性发现。

UI 使用 React 19、TypeScript、Vite 7、Tailwind CSS 4 和 Lucide；本地 API 使用 Fastify 5。

界面支持中文和英文。首次使用时，根据浏览器地区，CN、TW、HK、MO 默认中文，其他地区默认英文；未指定地区的中文浏览器语言也默认中文。可通过语言选择器切换并记住选择。AI 生成的业务内容跟随会话语言，切换界面语言不会翻译已有事实。

### 变更账本命令

宿主集成入口可以接收已完成的任务事件：

    domainatlas ingest --host cursor --request "新增退款功能" --summary "已新增退款审核" --changed-file src/billing/refund.ts --test-command "pnpm test" --test-status passed

`ingest-codex` 仍是 `ingest --host codex` 的别名。更正记录不会覆盖此前的记录：

    domainatlas ingest --kind correction --supersedes change_ID --request "更正影响范围" --summary "补充遗漏的业务能力" --changed-file src/billing/refund.ts

查看记录及其由 Git 推导的生命周期：

    domainatlas list

预览与当前暂存代码匹配的记录，再暂存其事实文件：

    domainatlas stage-records
    domainatlas stage-records --write

### 源码安装（开发者）

开发 DomainAtlas 本身时使用此方式。需要 Node.js 22+ 和 `package.json` 固定的 pnpm 版本（当前为 11.13.0）。

```sh
git clone https://github.com/chanshawoh/domain-atlas.git
cd domain-atlas
pnpm install --frozen-lockfile
pnpm build
pnpm domainatlas --help
```

要将此构建用于其他项目，请在目标项目的 Git 根目录运行 `node /absolute/path/to/domain-atlas/dist/src/cli.js <command>`。启用钩子前先构建，并保持源码目录路径稳定，因为已安装的钩子通过绝对路径引用 CLI。

在工具仓库中运行检查：

```sh
pnpm test
# 可选：需要已安装 codebase-memory-mcp
pnpm test:graph
```

前端开发时，在任意目录执行 `node /absolute/path/to/domain-atlas/dist/src/cli.js ui` 启动 API，再在工具仓库的另一个终端执行 `pnpm dev:web`。Vite 将 `/api` 代理到端口 4310。本仓库包含 `.codex/hooks.json`，其钩子同样需要在 Codex `/hooks` 中审核并信任。

### 维护者发布流程

发布脚本沿用 ImageForge MCP 先检查再发布的流程：

    bash script/release.sh
    bash script/release.sh --publish

第一条命令会构建、测试、审计生产依赖，并安装临时 npm tarball 以验证 CLI 和 Web UI。只有 `--publish` 才会将该 tarball 发布到 npm，发布前会检查当前分支是否为 `main`、工作区是否干净、是否与远端同步、认证状态及版本是否可用。脚本不会自动升级版本、创建提交、推送 Git 或创建标签。

### MVP 的明确边界

hook 协议、stdin CLI、Git pre-commit 行为以及真实代码图提供方的数据接入均已在隔离仓库中测试。hook 的信任和启用仍取决于具体环境。文件版本描述的是一轮任务中观察到的变更；当多个参与方编辑同一工作区时，它们不能证明作者归属。跨多轮的合并差异和部分暂存采取保守策略，不予匹配。MCP 传输、数据库投影和 Web 写入操作仍属于后续工作。
