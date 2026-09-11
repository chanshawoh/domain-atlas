# 初始业务图构建

`init` 创建配置，`build` 构建已有项目的当前业务基线，`ui` 展示基线和后续增量业务事实。基线不是历史开发事件，不会伪造需求、作者、测试或过去的提交时间。目前不支持 Git 历史回放。

## 命令方式

在目标 Git 仓库根目录执行，需 Node.js 22+：

```sh
domainatlas init
domainatlas build --input /absolute/path/to/baseline.json
domainatlas ui
```

构建前先在 AI 宿主配置 codebase-memory-mcp，为目标项目根目录建立或刷新索引并确认就绪，再使用 DomainAtlas skill 分析源码和文档、生成下面格式的业务分析 JSON。环境缺失、索引未就绪或业务证据不足时，停止构建并提示补齐条件，不使用路径或符号名凑出业务图。

`build` 必须提供 `--input`，省略时直接报错退出，不扫描源码、不写入基线；即使存在 codebase 索引也不会自动把代码符号转换成业务能力。CLI 本身没有业务语义分析能力，索引可用不代表业务解释正确。

导入默认立即写入。只验证和预览时添加 `--dry-run`；`--max-files 500` 设置证据文件上限（默认 200，范围 1..2000），超限报错，不截断后继续构建。证据必须引用 Git 已跟踪的普通项目文件，文档也可以作为证据。

执行时显示当前校验和保存阶段；等待超过 5 秒会继续显示当前阶段和累计耗时。进度写入 stderr，最终摘要写入 stdout，默认不打印完整证据和哈希。例如：

```text
业务图构建完成，已保存：3 个业务领域、12 个业务能力，基于 24 个文件。
```

预览会显示“预览完成（未保存）”，相同内容重复构建会显示“本次未新增记录”。引用证据仅覆盖部分源码时，摘要会附一行说明。

脚本需要完整结果时使用 `--json`（可与 `--input`、`--dry-run` 组合），关闭进度并返回 JSON，包含 `written`、`baseline.id`、领域和能力、证据文件内容哈希、构建时 HEAD，以及 `coverage`。`selectedFiles` 表示选取的文件数，不能证明业务语义完整；`limited` 表示有源码未被选取。AI 输入只引用部分文件时也会提示范围有限。

## 自然语言与 skill

将包内的 `skills/domainatlas` 安装到 AI 宿主的 skills 目录。以 Codex 的默认目录为例（已存在同名 skill 时先检查本地定制）：

```sh
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills/domainatlas"
cp -R "$(npm root -g)/domainatlas/skills/domainatlas/." "${CODEX_HOME:-$HOME/.codex}/skills/domainatlas/"
```

全局 npm 安装包含 skill 文件，但不会自动复制到宿主目录。源码开发时可从本仓库 `skills/domainatlas/` 复制。让宿主重新加载 skills 后，可以说：

> 用 DomainAtlas 构建这个项目已有业务的业务图，基于源码和文档分析业务领域、能力及证据。

也可显式使用 `$domainatlas`。Skill 允许针对构建请求的自然语言选择，普通开发仍由 hooks 记录，不依赖 skill。目标项目须先初始化；若请求同时包含初始化，AI 可一并执行。

AI 分析后生成以下 JSON，再调用 `domainatlas build --input /absolute/path/to/baseline.json`。CLI 不内置大模型，也不调用远程模型服务。

```json
{
  "schemaVersion": 1,
  "domains": [{
    "name": "订单管理",
    "confidence": "medium",
    "evidence": [{ "file": "src/orders/order.ts", "reason": "实现订单生命周期管理" }],
    "capabilities": [{
      "name": "退款审核",
      "confidence": "medium",
      "evidence": [{ "file": "src/orders/refund.ts", "reason": "校验退款申请并执行审核状态转换" }]
    }]
  }]
}
```

`confidence` 为 `low`、`medium` 或 `high`。每个领域和能力必须提供证据；`file` 必须是目标仓库内真实、已跟踪、非符号链接的普通文件，使用相对路径。CLI 生成稳定 ID、校验引用并记录内容哈希，业务解释是否正确由分析者核实。示例中的路径不是默认值。

## 存储与更新

基线作为一个完整 JSON 写入 `.domainatlas/baselines/`，校验失败或预览不会写入，重复相同构建不会新增文件。变化后的构建追加新快照。UI 使用最新创建的基线，合并 `.domainatlas/domains/` 和 `capabilities/` 中的增量事实；同 ID 时优先使用基线，原始事实均保留。因此再次导入时要提交完整的目标基线范围。它不是删除已有增量能力的入口。

基线不会增加变更账本条数，`domainatlas list` 仍可能为空。在统一 UI 的全部项目列表中选择该项目，点击刷新可看到领域、能力、证据及基线范围提示。旧版项目未显示时，参见[多项目工作台](multi-project-ui.md)登记项目。基线记录的 HEAD 是扫描时的代码上下文，不表示基线事实已经提交；提交和推送需单独执行。后续已接入的 Codex hooks 继续记录增量变化。

本地开发版本可在目标项目根目录执行 `node /absolute/path/to/DomainAtlas/dist/src/cli.js build --input /absolute/path/to/baseline.json`；先在工具仓库 `pnpm build`。源码修改不会自动升级已全局安装的 npm 包。
