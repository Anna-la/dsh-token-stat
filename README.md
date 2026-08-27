# dsh-token-stat

DeepSeek Harness 插件：统计使用 DSH 以来**累计 token 用量**，并按**模型 / 日期**区分明细；统计结果在**设置页**直接点击查看，**数据保存目录可在设置页在线更改**。

- 零运行时依赖（不 import 任何 `@deepseek-ai/*`，`dsh plugin add` 后无需构建、无需 allowBuilds 授权）
- 不修改任何会话数据，只读会话日志做折叠统计
- 数据来自会话日志中供应商上报的精确 usage（与官方 `dsh-token-meter` 同一数据源）
- 同一 `(turn, step)` 步内的重试/重复上报只计最后一次采样，不重复计数
- **数据隔离**：报告默认写入 `~/.dsh-token-stat`（可用 `$DSH_TOKEN_STAT_DATA_DIR` 覆盖），
  完全位于 `DSH_HOME` 之外 —— 官方对 `profiles` / `storages` / `sessions`
  等目录的任何清理、重装都不会误删本插件的数据

## 安装（粘贴仓库地址即装）

本仓库根 `package.json` 声明了 `dsh.bundle`（补丁层 `cordis.patch.yml`）与
`dsh.client`（浏览器半面，设置页卡片）。因此在 DeepSeek Harness 里**粘贴本仓库地址**
即可安装，无需构建：

```bash
# 方式 1: CLI(把 <profile> 换成你的 profile,如 web)
dsh plugin --profile <profile> add https://github.com/Anna-la/token-stat

# 方式 2: 本地目录(开发调试)
dsh plugin --profile <profile> add ./path/to/token-stat

# 方式 3: 从插件市场(awesome-dsh-plugin 列表 / dsh.market)找到
# 「Token 用量统计」一键安装
```

安装后**重启 DeepSeek Harness Desktop**，插件即开始扫描 `<DSH_HOME>/sessions`
下全部历史会话并增量累计。

## 使用

1. **设置页查看（推荐）**：打开「设置 → 插件 → 可配置」，找到
   **Token 用量统计**卡片，点击展开即显示：
   - 累计总量（输入 / 缓存读取 / 缓存写入 / 输出 / 总计，含占比）
   - 按模型明细表（请求数、各类 token）
   - 按日期（近 14 天）
   - 数据目录、扫描时间等元信息，并可点「重建扫描」。
   卡片数据由插件自带的桥 `/api/token-stat/stats` 提供（仅回环地址可访问，
   外部请求一律 403），每 15 秒自动刷新。
2. **更改数据保存目录**：同一张卡片里的「数据保存目录」一栏：
   - 输入新目录 → 点「保存」：立即生效，并把旧的 `report.md` / `report.json`
     **自动迁移**到新目录（跨盘移动不支持时会在新目录重建）；
   - 点「恢复默认」：清空设置，回到默认数据目录（`~/.dsh-token-stat`）。
   设置写入官方 settings 用户层（`settings.yaml`），重启后仍生效；
   也可在 `cordis.patch.yml` 的 `config.reportDir` 预设。
3. **自动统计**：插件加载后即扫描全部历史会话日志，此后实时监听
   `session/event` 增量累计（含子 agent 会话）。
4. **随时查询**：在对话框里问"查一下 token 用量统计"，模型会调用本插件的
   `token_usage_stats` 工具并返回报告文本。
5. **报告文件**：默认写入 `~/.dsh-token-stat\` 下的
   `report.md` + `report.json`（可在设置页卡片里随时改目录）。

## 配置（可选，均为默认值）

```yaml
- insert:
    - id: token-stat
      name: token-stat
      config:
        enabled: true        # 总开关
        reportDir: ''        # 报告目录,默认 ~/.dsh-token-stat(DSH_HOME 之外)
        writeMd: true        # 写 Markdown 报告 report.md
        writeJson: true      # 写 JSON 快照 report.json
        debounceMs: 2000     # 实时事件落盘最小间隔
        verbose: false       # 详细日志
```

## 统计口径

会话日志（session log）中的持久事件：

- `assistant/message` → `message.source.{provider,model}` 记录**产出模型**；
  `usage.{inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens}` 记录
  **供应商上报的精确 token 数**。
- 同一 `(turn, step)` 内重试采样的 usage 互相替换（与 `dsh-token-meter` 的
  `tokenUsage` 投影语义一致），避免重复计数。
- 绝大多数消息（99.5%+）都带 usage；个别缺失 usage 的消息只计条数不计 token。
- 模型归属：消息自带 `source` → 最近一次 `request/context` 路由 → `unknown`。

## 目录结构

```
token-stat/
├── package.json          # 根清单:dsh.bundle(patch)+ dsh.client(platform=web)
├── cordis.patch.yml      # bundle 补丁层:把 token-stat 挂进 loader
├── index.mjs             # 插件核心(折叠/渲染/apply,零依赖)
├── lib/
│   ├── index.js          # 服务端入口(薄壳,re-export index.mjs)
│   └── client.js         # 浏览器半面:设置页「Token 用量统计」卡片
└── tools/                # 开发/自检脚本
    ├── install.mjs       # 开发模式安装:junction + 维护 profile patch(幂等)
    ├── verify-load.mjs   # 模拟 loader 解析链路 + 数据隔离 + 客户端元数据 + bundle 清单校验
    ├── replay-sessions.mjs # 离线全量回放(全部历史会话 → 报告 + 数据质量诊断)
    ├── test-fold.mjs     # 折叠语义单元测试(8 组)
    ├── smoke-test.mjs    # 插件加载冒烟测试(含 settings/webServer 桥、目录迁移)
    ├── publish-github.mjs  # 用 gh REST 把本仓库发布到 GitHub(无需本地 git)
    └── submit-list-pr.mjs  # 向 awesome-dsh-plugin 列表仓库提交条目并开 PR(无需本地 git)
```

## 本地开发 / 自检

```bash
node tools/install.mjs         # 开发模式安装(junction 直连源码,幂等;改代码无需重装)
node tools/verify-load.mjs     # 校验 loader 解析链路 + 数据隔离 + 客户端 bundle
node tools/test-fold.mjs       # 折叠语义单元测试
node tools/smoke-test.mjs      # 插件加载冒烟测试(工具/settings namespace/桥/目录迁移)
node tools/replay-sessions.mjs # 离线回放真实日志(约几秒)
```

> pnpm 注意：如果未来在 profile 里跑 `pnpm install`，它可能会清掉未登记于
> profile `package.json` 的顶层目录（包括开发模式的 junction）。届时重跑
> `node tools/install.mjs` 即可恢复。

> 说明：本插件只是"统计账本"，不改写任何会话/日志文件；卸载插件后不再累计，
> 历史报告文件仍在（默认 `~/.dsh-token-stat`，不受官方目录管理影响）。

## License

[MIT](LICENSE)
