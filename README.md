# DomainAtlas

[English](#english) | [中文](#中文)

## English

DomainAtlas maintains a dynamically updated business map of your project as it evolves through AI-assisted development. Its core purpose is to help you understand the project's business domains and capabilities. An append-only change ledger supports the map with evidence and a traceable history of changes.

The current MVP derives a two-level map (domain → capability) from completed Codex tasks and code graph evidence, starting with the first recorded task. It builds the map incrementally from observed changes; initialization alone does not produce a complete map of an existing project.

### Installation (recommended)

Requires **Node.js 22+** and Git. Install the published [npm package](https://www.npmjs.com/package/domainatlas); the CLI and built Web UI are included.

```sh
npm install -g domainatlas
domainatlas --help
```

The current CLI and global hook workflow target macOS/Linux; native Windows has not been verified.

### Quick start

**1. Install Codex hooks once:**

```sh
domainatlas init -g --codex
```

Review and trust the hooks in Codex `/hooks`.

**2. Initialize each project you want to map:**

```sh
cd /path/to/your/git-project
domainatlas init
```

Continue working in Codex. Initialized projects record completed turns automatically without a prompt prefix or skill invocation. If you initialize midway through a turn, recording starts with the next turn. Uninitialized projects and non-Git directories are skipped without creating files.

**3. Open your business map:**

```sh
domainatlas ui
```

Open [http://127.0.0.1:4310](http://127.0.0.1:4310). Explore the domains and capabilities derived from recorded turns, then inspect supporting changes and evidence. Use `domainatlas list` to inspect the auxiliary ledger; Git determines whether records are pending or committed.

Global hook setup preserves other hooks and backs up the original configuration. It does not initialize the current project. Use `domainatlas init -g --codex --dry-run` to preview installation, `domainatlas init -g --codex --uninstall` to remove its global entries, and `domainatlas init --help` for options. `-g` also accepts `--global`.

See [Host integration](docs/codex-integration.md) for hook details and the optional Git pre-commit hook. The DomainAtlas skill remains explicit-only; automatic recording is independent of skill invocation.

### Business map and supporting capabilities

- **Business map:** explore the project's domains and capabilities in a read-only local Web UI, with links to supporting change history and evidence.
- **Incremental updates:** completed Codex tasks supply change evidence. Turn-start Git snapshots and turn-end file versions identify incremental changes; duplicate completion events create one record.
- **Code graph evidence:** prefer the locally installed codebase-memory-mcp structured index without reading the full source tree. When unavailable, inspect changed paths only and emit low-confidence domain and capability nodes.
- **Supporting change ledger:** preserve immutable records, original requirements, feedback attribution, and evidence in `.domainatlas/`. See [identity and requirement attribution](docs/attribution.md).
- **Git traceability:** derive the first commit containing each record and expose its actual author and committer. `stage-records` previews matching records and stages their facts with `--write` only when the full recorded before/after versions match HEAD and the index.

### Web UI

From your initialized project's Git root, open the workbench:

    domainatlas ui

Open [http://127.0.0.1:4310](http://127.0.0.1:4310). Use `domainatlas ui --port 4311` to change the port.

The UI uses React 19, TypeScript, Vite 7, Tailwind CSS 4 and Lucide; the local API uses Fastify 5. See [Web UI implementation and validation](docs/web-ui-development.md) for the design source, scope and limitations.

### Change ledger commands

The Codex host integration boundary can ingest a completed task event:

    domainatlas ingest-codex --request "Add refunds" --summary "Added refund review" --changed-file src/billing/refund.ts --test-command "pnpm test" --test-status passed

Corrections never overwrite an earlier record:

    domainatlas ingest-codex --kind correction --supersedes change_ID --request "Correct the affected scope" --summary "Added omitted capabilities" --changed-file src/billing/refund.ts

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

For frontend development, start the API with `node /absolute/path/to/domain-atlas/dist/src/cli.js ui` from an initialized project's Git root, then run `pnpm dev:web` in a second terminal in the tool repository. Vite proxies `/api` to port 4310. This repository includes `.codex/hooks.json`; its hooks also require review and trust in Codex `/hooks`.

### Maintainer release

The release script follows ImageForge MCP's check-first workflow:

    bash script/release.sh
    bash script/release.sh --publish

The first command builds, tests, audits production dependencies and installs a temporary npm tarball to verify the CLI and Web UI. Only `--publish` publishes that exact tarball to npm, after checking `main`, a clean checkout, remote synchronization, authentication and version availability. It never bumps versions, commits, pushes Git, or creates tags. See [release instructions](docs/releasing.md) for prerequisites and verification details.

### Deliberate MVP boundary

The hook protocol, stdin CLI, Git pre-commit behavior, and real graph-provider ingest are tested in isolated repositories. Hook trust and activation remain environment-specific; see [the recorded local acceptance](docs/web-ui-product-brief.md). File versions describe changes observed during a turn; they do not prove authorship when multiple actors edit the same worktree. Multi-turn combined diffs and partial staging are conservatively left unmatched. MCP transport, database projections, and Web write operations remain future work.

---

## 中文

DomainAtlas 随 AI 辅助开发过程动态更新项目业务图，帮助你理解项目的业务领域和业务能力。业务图是核心能力；仅追加的变更账本是辅助能力，为业务图提供变更证据和可追溯的演进历史。

当前 MVP 从第一个被记录的 Codex 任务开始，结合已完成任务和代码图谱证据，逐步形成“业务领域 → 业务能力”的两级业务图。业务图基于观察到的变更增量构建，仅初始化不会生成已有项目的完整业务图。

### 安装（推荐）

需要 **Node.js 22+** 和 Git。直接安装已发布的 [npm 包](https://www.npmjs.com/package/domainatlas)，其中已包含 CLI 和构建好的 Web UI。

```sh
npm install -g domainatlas
domainatlas --help
```

当前 CLI 和全局钩子流程面向 macOS/Linux，尚未验证 Windows 原生环境。

### 快速开始

**1. 一次性安装 Codex 钩子：**

```sh
domainatlas init -g --codex
```

在 Codex `/hooks` 中审核并信任钩子。

**2. 初始化每个需要构建业务图的项目：**

```sh
cd /path/to/your/git-project
domainatlas init
```

接着正常使用 Codex。已初始化项目会自动记录已完成的轮次，无需提示词前缀或调用技能。如果在一轮任务中途初始化，从下一轮开始记录。未初始化的项目和非 Git 目录会被跳过，不会创建文件。

**3. 打开项目业务图：**

```sh
domainatlas ui
```

打开 [http://127.0.0.1:4310](http://127.0.0.1:4310)。浏览从已记录轮次中推导出的业务领域和能力，并查看关联变更及证据。使用 `domainatlas list` 查看辅助账本，由 Git 判断记录处于待提交还是已提交状态。

全局钩子安装会保留其他钩子并备份原配置，不会初始化当前项目。使用 `domainatlas init -g --codex --dry-run` 预览安装，使用 `domainatlas init -g --codex --uninstall` 移除其全局配置项，使用 `domainatlas init --help` 查看选项。`-g` 也可写为 `--global`。

钩子详情及可选的 Git pre-commit 钩子参见[宿主集成](docs/codex-integration.md)。DomainAtlas 技能仍需显式调用；自动记录独立于技能调用。

### 业务图与配套能力

- **项目业务图：**在只读本地 Web UI 中浏览项目的业务领域和业务能力，并查看支撑它们的变更历史及证据。
- **增量更新：**已完成的 Codex 任务提供变更证据，通过轮次开始时的 Git 快照和结束时的文件版本识别增量变更；重复的完成事件只生成一条记录。
- **代码图谱证据：**优先使用本地 codebase-memory-mcp 结构化索引，无需读取完整源码树；不可用时仅检查变更路径，生成低置信度的业务领域和能力节点。
- **辅助变更账本：**在 `.domainatlas/` 中保留不可变记录、原始需求、反馈归属和证据。参见[身份与需求归属](docs/attribution.md)。
- **Git 追溯：**推导首次包含各条记录的提交，展示实际作者和提交者。`stage-records` 预览匹配记录，只有完整的变更前后版本与 HEAD 和暂存区一致时，才通过 `--write` 暂存其事实文件。

### Web UI

在已初始化项目的 Git 根目录打开工作台：

    domainatlas ui

打开 [http://127.0.0.1:4310](http://127.0.0.1:4310)。使用 `domainatlas ui --port 4311` 修改端口。

UI 使用 React 19、TypeScript、Vite 7、Tailwind CSS 4 和 Lucide；本地 API 使用 Fastify 5。设计来源、实现范围和限制参见 [Web UI 实现与验证](docs/web-ui-development.md)。

### 变更账本命令

Codex 宿主集成入口可以接收已完成的任务事件：

    domainatlas ingest-codex --request "新增退款功能" --summary "已新增退款审核" --changed-file src/billing/refund.ts --test-command "pnpm test" --test-status passed

更正记录不会覆盖此前的记录：

    domainatlas ingest-codex --kind correction --supersedes change_ID --request "更正影响范围" --summary "补充遗漏的业务能力" --changed-file src/billing/refund.ts

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

前端开发时，在已初始化项目的 Git 根目录执行 `node /absolute/path/to/domain-atlas/dist/src/cli.js ui` 启动 API，再在工具仓库的另一个终端执行 `pnpm dev:web`。Vite 将 `/api` 代理到端口 4310。本仓库包含 `.codex/hooks.json`，其钩子同样需要在 Codex `/hooks` 中审核并信任。

### 维护者发布流程

发布脚本沿用 ImageForge MCP 先检查再发布的流程：

    bash script/release.sh
    bash script/release.sh --publish

第一条命令会构建、测试、审计生产依赖，并安装临时 npm tarball 以验证 CLI 和 Web UI。只有 `--publish` 才会将该 tarball 发布到 npm，发布前会检查当前分支是否为 `main`、工作区是否干净、是否与远端同步、认证状态及版本是否可用。脚本不会自动升级版本、创建提交、推送 Git 或创建标签。前置条件和验证细节参见[发布说明](docs/releasing.md)。

### MVP 的明确边界

hook 协议、stdin CLI、Git pre-commit 行为以及真实代码图提供方的数据接入均已在隔离仓库中测试。hook 的信任和启用仍取决于具体环境；参见[已记录的本地验收](docs/web-ui-product-brief.md)。文件版本描述的是一轮任务中观察到的变更；当多个参与方编辑同一工作区时，它们不能证明作者归属。跨多轮的合并差异和部分暂存采取保守策略，不予匹配。MCP 传输、数据库投影和 Web 写入操作仍属于后续工作。
