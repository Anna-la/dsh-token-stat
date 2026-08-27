/**
 * token-stat — 浏览器半面 bundle。
 *
 * 在「设置 → 插件 → 可配置」标签页注册一张「Token 用量统计」卡片
 * (settings.plugin.item 插槽,key 为服务端注册的 settings namespace 'token-stat')。
 * 点击卡片头部展开,显示累计用量(总量 / 按模型 / 按日期 / 数据目录等),
 * 数据来自服务端 webServer 桥 /api/token-stat/*(仅回环地址可访问)。
 *
 * 写法与官方插件 dsh-free-search 的 client bundle 一致:
 * window.__ModuleLoader__.load({ id, factory(require) }),react 由模块图外部提供。
 */

window.__ModuleLoader__.load({
  id: "token-stat",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    let react = require("react");
    let react_jsx_runtime = require("react/jsx-runtime");

    //#region css (全部使用 DSH 主题变量,与设置页风格一致)
    const css = [
      ".ts-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:8px;min-width:0;list-style:none;overflow:hidden;margin-bottom:8px}",
      ".ts-cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}",
      ".ts-header{width:100%;color:inherit;cursor:pointer;text-align:left;font:inherit;background:0 0;border:0;align-items:center;gap:8px;padding:10px 14px;display:flex}",
      ".ts-header:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}",
      ".ts-headText{flex-direction:column;flex:1;gap:2px;min-width:0;display:flex;overflow:hidden}",
      ".ts-name{color:var(--dsw-alias-label-primary);white-space:nowrap;text-overflow:ellipsis;font-weight:600;overflow:hidden}",
      ".ts-desc{color:var(--dsw-alias-label-tertiary);white-space:nowrap;text-overflow:ellipsis;font-size:12px;overflow:hidden}",
      ".ts-badge{color:var(--dsw-alias-label-secondary);white-space:nowrap;flex:none;font-size:12px}",
      ".ts-pending{color:var(--dsw-alias-state-warn-primary);white-space:nowrap;flex:none;font-size:12px}",
      ".ts-chevron{color:var(--dsw-alias-label-tertiary);flex:none;font-size:13px;transition:transform .12s}",
      ".ts-chevronOpen{transform:rotate(180deg)}",
      ".ts-body{flex-direction:column;gap:14px;padding:0 14px 14px;display:flex}",
      ".ts-error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:1.6}",
      ".ts-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}",
      ".ts-stat{flex-direction:column;gap:2px;display:flex;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:8px 10px}",
      ".ts-statLabel{color:var(--dsw-alias-label-secondary);font-size:12px}",
      ".ts-statValue{color:var(--dsw-alias-label-primary);font-weight:600;font-variant-numeric:tabular-nums}",
      ".ts-statValueStrong{color:var(--dsw-alias-state-business-primary)}",
      ".ts-table{border-collapse:collapse;width:100%;font-size:12px;font-variant-numeric:tabular-nums}",
      ".ts-table th{color:var(--dsw-alias-label-tertiary);font-weight:500;text-align:right;padding:3px 8px;border-bottom:1px solid var(--dsw-alias-border-l2);white-space:nowrap}",
      ".ts-table th:first-child,.ts-table td:first-child{text-align:left}",
      ".ts-table td{color:var(--dsw-alias-label-primary);text-align:right;padding:3px 8px;white-space:nowrap}",
      ".ts-block{flex-direction:column;gap:6px;min-width:0;display:flex}",
      ".ts-blockTitle{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600}",
      ".ts-wrap{max-height:220px;overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:6px}",
      ".ts-footer{justify-content:space-between;align-items:center;gap:8px;display:flex;flex-wrap:wrap}",
      ".ts-meta{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.6;margin:0}",
      ".ts-path{color:var(--dsw-alias-label-secondary);font-family:ui-monospace,Consolas,monospace;word-break:break-all}",
      ".ts-btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:6px;padding:6px 12px;font-size:12px;font:inherit;cursor:pointer}",
      ".ts-btn:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed)}",
      ".ts-btn:disabled{opacity:.6;cursor:default}",
      ".ts-total{display:grid;grid-template-columns:repeat(4,auto);gap:2px 16px;font-size:12px;font-variant-numeric:tabular-nums}",
      ".ts-total .k{color:var(--dsw-alias-label-tertiary)}",
      ".ts-total .v{color:var(--dsw-alias-label-primary);text-align:right;font-weight:600}",
      ".ts-dirrow{display:flex;gap:8px;align-items:center;flex-wrap:wrap;min-width:0}",
      ".ts-dirrow .ts-input{flex:1;min-width:240px}",
      ".ts-input{border:1px solid var(--dsw-alias-border-l2);font:inherit;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);background:var(--dsw-specific-input-major);border-radius:6px;padding:6px 8px;font-size:12px;transition:border-color .13s,box-shadow .13s;width:100%;box-sizing:border-box}",
      ".ts-input:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed)}",
      ".ts-input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}",
      ".ts-input:disabled{opacity:.6;cursor:default}",
      ".ts-saved{color:#7ddb9c;font-size:12px}",
    ].join("");
    const tagId = "token-stat/card.css";
    if (!document.querySelector(`style[data-plugin-tag="${tagId}"]`)) {
      const tag = document.createElement("style");
      tag.dataset.pluginTag = tagId;
      tag.dataset.plugin = "token-stat";
      tag.textContent = css;
      document.head.appendChild(tag);
    }
    //#endregion

    const BRIDGE = "/api/token-stat";
    const fmt = (n) => (typeof n === "number" && Number.isFinite(n) ? n : 0).toLocaleString("zh-CN");
    const pct = (part, total) =>
      total > 0 ? `(${((part / total) * 100).toFixed(1)}%)` : "";
    const modelLabel = (m) =>
      m.provider && m.provider !== "unknown" ? `${m.provider}/${m.model}` : m.model;

    /**
     * Token 用量统计卡片。
     * 折叠态只显示一个概要;点击头部展开,拉取桥数据渲染明细。
     */
    function TokenStatCard() {
      const [open, setOpen] = react.useState(false);
      const [state, setState] = react.useState({ status: "loading" });
      const [refreshing, setRefreshing] = react.useState(false);
      // 数据保存目录编辑
      const [dirInput, setDirInput] = react.useState("");
      const [dirSaving, setDirSaving] = react.useState(false);
      const [dirError, setDirError] = react.useState(null);
      const [savedMsg, setSavedMsg] = react.useState("");
      const dirTouched = react.useRef(false);

      const load = react.useCallback(async () => {
        setState((s) => ({ ...s, status: "loading" }));
        try {
          const res = await fetch(`${BRIDGE}/stats`, { credentials: "same-origin" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const body = await res.json();
          if (!body || body.ok !== true || !body.value || !body.value.snapshot) {
            throw new Error("桥返回了意外的数据结构");
          }
          setState({ status: "ready", value: body.value });
          // 仅在用户没在输入时用服务端配置回填目录输入框
          if (!dirTouched.current && body.value.meta) {
            const configured = body.value.meta.reportDirConfigured;
            setDirInput(typeof configured === "string" ? configured : "");
          }
        } catch (error) {
          setState({ status: "error", error: error && error.message ? error.message : String(error) });
        }
      }, []);

      react.useEffect(() => {
        void load();
        const timer = setInterval(() => {
          if (open) void load();
        }, 15000);
        return () => clearInterval(timer);
      }, [load, open]);

      const refresh = react.useCallback(async () => {
        setRefreshing(true);
        try {
          await fetch(`${BRIDGE}/refresh`, { method: "POST", credentials: "same-origin" });
          await new Promise((r) => setTimeout(r, 1200));
          await load();
        } finally {
          setRefreshing(false);
        }
      }, [load]);

      /** 提交目录变更(空串 = 恢复自动/默认插件目录)。 */
      const commitDir = react.useCallback(
        async (value) => {
          setDirSaving(true);
          setDirError(null);
          setSavedMsg("");
          try {
            const res = await fetch(`${BRIDGE}/config`, {
              method: "POST",
              credentials: "same-origin",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ reportDir: value }),
            });
            const body = await res.json().catch(() => null);
            if (!res.ok || !body || body.ok !== true) {
              throw new Error((body && body.error) || `HTTP ${res.status}`);
            }
            dirTouched.current = false;
            await load();
            setSavedMsg(`已保存,报告迁移到: ${body.value.reportDir}`);
          } catch (error) {
            setDirError(error && error.message ? error.message : String(error));
          } finally {
            setDirSaving(false);
          }
        },
        [load]
      );

      const saveDir = react.useCallback(() => commitDir(dirInput.trim()), [commitDir, dirInput]);
      const resetDir = react.useCallback(() => commitDir(""), [commitDir]);

      const subtitle = (() => {
        if (state.status === "loading") return "加载中…";
        if (state.status === "error") return "暂时无法读取";
        const s = state.value.snapshot;
        return `累计 ${fmt(s.totals.totalTokens)} tokens · ${s.sessionCount} 个会话 · ${s.byModel.length} 个模型`;
      })();

      let body = null;
      if (open) {
        if (state.status === "loading") {
          body = react_jsx_runtime.jsx("div", { className: "ts-body", children: react_jsx_runtime.jsx("span", { className: "ts-meta", children: "正在读取统计数据…" }) });
        } else if (state.status === "error") {
          body = react_jsx_runtime.jsx("div", { className: "ts-body", children: react_jsx_runtime.jsx("div", { className: "ts-error", children: `读取失败: ${state.error}。请确认插件服务端已加载(重启应用后重试)。` }) });
        } else {
          const { snapshot, meta } = state.value;
          const t = snapshot.totals;

          const statCards = [
            ["输入(未命中缓存)", fmt(t.inputTokens), pct(t.inputTokens, t.totalTokens)],
            ["缓存读取", fmt(t.cacheReadTokens), pct(t.cacheReadTokens, t.totalTokens)],
            ["缓存写入", fmt(t.cacheWriteTokens), pct(t.cacheWriteTokens, t.totalTokens)],
            ["输出", fmt(t.outputTokens), pct(t.outputTokens, t.totalTokens)],
            ["总计", fmt(t.totalTokens), "", true],
          ].map(([label, value, note, strong]) =>
            react_jsx_runtime.jsx(
              "div",
              {
                className: "ts-stat",
                children: [
                  react_jsx_runtime.jsx("span", { className: "ts-statLabel", children: label }),
                  react_jsx_runtime.jsx("span", {
                    className: strong ? "ts-statValue ts-statValueStrong" : "ts-statValue",
                    children: note ? `${value} ${note}` : value,
                  }),
                ],
              },
              label
            )
          );

          const modelRows = snapshot.byModel.length === 0
            ? [react_jsx_runtime.jsx("tr", { children: react_jsx_runtime.jsx("td", { colSpan: "7", style: { color: "var(--dsw-alias-label-tertiary)" }, children: "(暂无数据)" }) }, "empty")]
            : snapshot.byModel.map((m) =>
                react_jsx_runtime.jsx(
                  "tr",
                  {
                    children: [
                      react_jsx_runtime.jsx("td", { children: modelLabel(m) }),
                      react_jsx_runtime.jsx("td", { children: fmt(m.requests) }),
                      react_jsx_runtime.jsx("td", { children: fmt(m.inputTokens) }),
                      react_jsx_runtime.jsx("td", { children: fmt(m.cacheReadTokens) }),
                      react_jsx_runtime.jsx("td", { children: fmt(m.cacheWriteTokens) }),
                      react_jsx_runtime.jsx("td", { children: fmt(m.outputTokens) }),
                      react_jsx_runtime.jsx("td", { children: fmt(m.totalTokens) }),
                    ],
                  },
                  m.provider + "::" + m.model
                )
              );

          const dayRows = snapshot.byDay.length === 0
            ? [react_jsx_runtime.jsx("tr", { children: react_jsx_runtime.jsx("td", { colSpan: "7", style: { color: "var(--dsw-alias-label-tertiary)" }, children: "(暂无数据)" }) }, "empty")]
            : snapshot.byDay.slice(0, 14).map((d) =>
                react_jsx_runtime.jsx(
                  "tr",
                  {
                    children: [
                      react_jsx_runtime.jsx("td", { children: d.date }),
                      react_jsx_runtime.jsx("td", { children: fmt(d.requests) }),
                      react_jsx_runtime.jsx("td", { children: fmt(d.inputTokens) }),
                      react_jsx_runtime.jsx("td", { children: fmt(d.cacheReadTokens) }),
                      react_jsx_runtime.jsx("td", { children: fmt(d.cacheWriteTokens) }),
                      react_jsx_runtime.jsx("td", { children: fmt(d.outputTokens) }),
                      react_jsx_runtime.jsx("td", { children: fmt(d.totalTokens) }),
                    ],
                  },
                  d.date
                )
              );

          const scanned = meta.scannedAt
            ? new Date(meta.scannedAt).toLocaleString("zh-CN")
            : "—";

          body = react_jsx_runtime.jsx("div", {
            className: "ts-body",
            children: [
              react_jsx_runtime.jsx("div", { className: "ts-block", children: react_jsx_runtime.jsx("div", { className: "ts-blockTitle", children: "累计总量" }) }),
              react_jsx_runtime.jsx("div", { className: "ts-grid", children: statCards }),
              react_jsx_runtime.jsx("div", { className: "ts-block", children: react_jsx_runtime.jsx("div", { className: "ts-blockTitle", children: `按模型(${snapshot.byModel.length})` }) }),
              react_jsx_runtime.jsx("div", {
                className: "ts-wrap",
                children: react_jsx_runtime.jsx(
                  "table",
                  { className: "ts-table", children: [
                      react_jsx_runtime.jsx("thead", { children: react_jsx_runtime.jsx("tr", { children: ["模型", "请求数", "输入", "缓存读", "缓存写", "输出", "合计"].map((h) => react_jsx_runtime.jsx("th", { children: h }, h)) }) }),
                      react_jsx_runtime.jsx("tbody", { children: modelRows }),
                    ] },
                  "models"
                ),
              }),
              react_jsx_runtime.jsx("div", { className: "ts-block", children: react_jsx_runtime.jsx("div", { className: "ts-blockTitle", children: "按日期(近 14 天)" }) }),
              react_jsx_runtime.jsx("div", {
                className: "ts-wrap",
                children: react_jsx_runtime.jsx(
                  "table",
                  { className: "ts-table", children: [
                      react_jsx_runtime.jsx("thead", { children: react_jsx_runtime.jsx("tr", { children: ["日期", "请求数", "输入", "缓存读", "缓存写", "输出", "合计"].map((h) => react_jsx_runtime.jsx("th", { children: h }, h)) }) }),
                      react_jsx_runtime.jsx("tbody", { children: dayRows }),
                    ] },
                  "days"
                ),
              }),
              react_jsx_runtime.jsx("div", {
                className: "ts-block",
                children: [
                  react_jsx_runtime.jsx("div", { className: "ts-blockTitle", children: "数据保存目录" }),
                  react_jsx_runtime.jsx("p", {
                    className: "ts-meta",
                    children: [
                      "当前: ",
                      react_jsx_runtime.jsx("span", { className: "ts-path", children: meta.reportDir || "—" }),
                    ],
                  }),
                  react_jsx_runtime.jsx("div", {
                    className: "ts-dirrow",
                    children: [
                      react_jsx_runtime.jsx("input", {
                        className: "ts-input",
                        type: "text",
                        value: dirInput,
                        placeholder: "留空 = 自动(插件目录,DSH_HOME 之外,官方清理不会误删)",
                        spellCheck: false,
                        onChange: (e) => {
                          dirTouched.current = true;
                          setDirInput(e.target.value);
                          setDirError(null);
                        },
                        disabled: dirSaving,
                      }),
                      react_jsx_runtime.jsx("button", {
                        className: "ts-btn",
                        type: "button",
                        onClick: saveDir,
                        disabled: dirSaving,
                        children: dirSaving ? "保存中…" : "保存",
                      }),
                      dirInput.trim() !== ""
                        ? react_jsx_runtime.jsx("button", {
                            className: "ts-btn",
                            type: "button",
                            onClick: resetDir,
                            disabled: dirSaving,
                            children: "恢复默认",
                          })
                        : null,
                    ],
                  }),
                  dirError
                    ? react_jsx_runtime.jsx("div", { className: "ts-error", children: `保存失败: ${dirError}` })
                    : null,
                  savedMsg
                    ? react_jsx_runtime.jsx("span", { className: "ts-saved", children: savedMsg })
                    : null,
                ],
              }),
              react_jsx_runtime.jsx("div", {
                className: "ts-footer",
                children: [
                  react_jsx_runtime.jsx("p", {
                    className: "ts-meta",
                    children: [
                      `扫描时间: ${scanned}${meta.status === "scanning" ? " (正在扫描历史会话…)" : ""} · 会话 ${fmt(snapshot.sessionCount)} 个 · assistant 消息 ${fmt(snapshot.messageCount)} 条(带 usage ${fmt(snapshot.usageCount)},去重 ${fmt(snapshot.usageCalls)} 次请求)`,
                      react_jsx_runtime.jsx("br", {}),
                      react_jsx_runtime.jsx("span", { className: "ts-path", children: `数据目录: ${meta.reportDir || "—"}` }),
                    ],
                  }),
                  react_jsx_runtime.jsx("button", {
                    className: "ts-btn",
                    type: "button",
                    onClick: refresh,
                    disabled: refreshing || state.status !== "ready",
                    children: refreshing ? "重建扫描中…" : "重建扫描",
                  }),
                ],
              }),
            ],
          });
        }
      }

      const pending = state.status === "loading" || refreshing;

      return react_jsx_runtime.jsx("div", {
        className: "ts-card" + (open ? " ts-cardOpen" : ""),
        children: [
          react_jsx_runtime.jsx("button", {
            className: "ts-header",
            type: "button",
            onClick: () => setOpen((v) => !v),
            "aria-expanded": open,
            children: [
              react_jsx_runtime.jsx("div", {
                className: "ts-headText",
                children: [
                  react_jsx_runtime.jsx("div", { className: "ts-name", children: "Token 用量统计" }),
                  react_jsx_runtime.jsx("div", { className: "ts-desc", children: subtitle }),
                ],
              }),
              pending && !open
                ? react_jsx_runtime.jsx("span", { className: "ts-pending", children: "●" })
                : react_jsx_runtime.jsx("span", { className: "ts-badge", children: open ? "收起" : "查看" }),
              react_jsx_runtime.jsx("span", { className: "ts-chevron" + (open ? " ts-chevronOpen" : ""), children: "▾" }),
            ],
          }),
          body,
        ],
      });
    }

    const inject = ["slots"];

    function apply(ctx) {
      // 挂官方插槽 settings.plugin.item(设置 → 插件 → 可配置标签页)。
      // 卡片 key 与服务端注册的 settings namespace 'token-stat' 一致,故会被派发渲染。
      ctx.slots.inject("settings.plugin.item", () =>
        ctx.slots.register(
          {
            name: "settings.plugin.item",
            key: "token-stat",
            id: "dsh-token-stat",
            order: 130,
            inject: () => ({}),
          },
          TokenStatCard
        )
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});