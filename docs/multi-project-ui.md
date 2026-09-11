# 多项目工作台

`domainatlas ui` 启动一个本地端口，首页显示所有已登记项目。点击项目进入业务图、基线证据、历史变更及提交状态；点击“全部项目”返回列表。项目 URL 包含项目 ID，刷新后仍打开该项目。

## 新项目

在每个项目内初始化一次：

```sh
cd /path/to/project-a
domainatlas init

cd /path/to/project-b
domainatlas init
```

然后在任意目录（包括非 Git 目录）启动：

```sh
domainatlas ui
```

打开 [http://127.0.0.1:4310](http://127.0.0.1:4310)。默认端口为 4310，可通过 `--port 4311` 修改。只需保持一个服务运行；新初始化的项目在列表刷新后出现，无须为每个项目启动服务。端口已被占用时，使用已有服务或另选端口。

`init` 从子目录执行时会定位 Git 根目录，登记时规范化符号链接路径，重复初始化不会产生重复项目。不同目录的同名项目分别列出，并展示完整路径。

## 旧版已经初始化的项目

旧版仅在仓库内保存 `.domainatlas/config.json`，没有记录全局项目位置。可一次性发现项目父目录下的已有项目：

```sh
domainatlas ui --scan /path/to/projects
# 多个目录
domainatlas ui --scan /path/to/work --scan /path/to/personal
```

只登记配置有效的 Git 根目录，不会初始化其他目录或修改项目业务事实。扫描跳过隐藏目录、符号链接子目录、依赖和常见构建产物，每个扫描根最多检查 10,000 个目录；无法读取或达到上限时会输出说明。隐藏目录内的项目可直接用其路径作为 `--scan` 根。大型工作目录建议分批指定更小的根目录。

也可在旧项目中重新执行 `domainatlas init`，或从该项目启动 `ui`，完成当前项目登记。已经运行的 UI 刷新列表即可看到新登记结果。登记后以后直接运行 `domainatlas ui`，不必重复扫描。

## 数据位置与项目状态

- 用户级项目目录默认为 `~/.domainatlas/projects/`，只记录规范化路径和稳定项目 ID。可用 `DOMAINATLAS_HOME` 指定另一数据目录；初始化、扫描和启动 UI 应使用相同值。
- 业务事实继续保存在每个项目自己的 `.domainatlas/`，包括业务基线和变更账本。UI 按项目读取，记录 ID 的查询也限定在所选项目内。
- 移动、删除项目或移除配置后，原登记显示不可用，不会阻断其他项目。移动后在新位置执行 `init` 即可登记新路径；旧项保留不可用提示。
- 列表搜索支持项目名和路径。列表刷新只检查登记目录；不会扫描整台电脑，也不会自动构建业务图。
- 全局 Codex hooks 与项目目录互相独立。`init -g --codex` 只安装 hooks，不登记当前项目。

本次源码修改尚需发布或更新本地安装才会影响全局命令。开发时可使用：

```sh
node /absolute/path/to/DomainAtlas/dist/src/cli.js ui --scan /path/to/projects
```
