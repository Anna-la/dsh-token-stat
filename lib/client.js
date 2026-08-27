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
      ".ts-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}",
      ".ts-btnDanger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}",
      ".ts-btnDanger:hover:not(:disabled){border-color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent)}",
      ".ts-vizOverlay{position:fixed;inset:0;background:rgba(8,10,16,.5);display:flex;align-items:center;justify-content:center;z-index:9990;padding:24px}",
      ".ts-vizModal{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;width:100%;max-width:780px;max-height:calc(100vh - 48px);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 18px 48px rgba(0,0,0,.35)}",
      ".ts-vizHead{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l2)}",
      ".ts-vizTitle{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}",
      ".ts-vizClose{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:6px;width:28px;height:28px;cursor:pointer;line-height:1;font-size:14px}",
      ".ts-vizClose:hover{border-color:var(--dsw-alias-label-dimmed)}",
      ".ts-vizBody{overflow:auto;padding:16px;display:flex;flex-direction:column;gap:20px}",
      ".ts-chartBlock{display:flex;flex-direction:column;gap:8px;min-width:0}",
      ".ts-chartBlockTitle{display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;flex-wrap:wrap}",
      ".ts-seg{display:inline-flex;gap:8px;align-items:center;font-size:11px;color:var(--dsw-alias-label-secondary);flex-wrap:wrap}",
      ".ts-segDot{width:9px;height:9px;border-radius:2px;display:inline-block}",
      ".ts-chart{position:relative}",
      ".ts-chartSvg svg{display:block;width:100%;height:auto}",
      ".ts-chart [data-tip]{cursor:crosshair}",
      ".ts-chart [data-tip]:hover{opacity:.82}",
      ".ts-donut [data-tip]:hover{opacity:1;stroke-width:30}",
      ".ts-tip{position:absolute;pointer-events:none;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);padding:4px 8px;border-radius:6px;font-size:11px;line-height:1.5;white-space:pre;transform:translate(-50%,-115%);z-index:5;box-shadow:0 4px 14px rgba(0,0,0,.25)}",
      ".ts-rangeToggle{display:inline-flex;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;overflow:hidden}",
      ".ts-rangeToggle button{border:0;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);padding:3px 10px;font-size:11px;cursor:pointer;font:inherit}",
      ".ts-rangeToggle button:hover{color:var(--dsw-alias-label-primary)}",
      ".ts-rangeToggle button.on{background:var(--dsw-alias-state-business-primary);color:#fff}",
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

    //#region 可视化(手写 SVG,零依赖;数据复用 /stats 快照)
    const PIE_COLORS = ["#4f8ef7", "#7ddb9c", "#f5a524", "#8e7cf3", "#46c4d0", "#e5484d", "#f7c948", "#9aa5b1"];
    const CAT_COLORS = { "输入": "#4f8ef7", "缓存读": "#7ddb9c", "缓存写": "#f5a524", "输出": "#e5484d" };

    const fmtCompact = (n) => {
      const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
      if (v >= 1e8) return (v / 1e8).toFixed(2).replace(/\.?0+$/, "") + "亿";
      if (v >= 1e4) return (v / 1e4).toFixed(1).replace(/\.0$/, "") + "万";
      return String(v);
    };
    const pctOf = (part, total) => (total > 0 ? ((part / total) * 100).toFixed(1) + "%" : "0%");
    const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

    /** 环形图: 模型用量占比(<1% 合并「其他」)。 */
    function donutItems(byModel, total) {
      const sorted = [...byModel].sort((a, b) => b.totalTokens - a.totalTokens);
      const keep = [];
      let rest = 0;
      for (const m of sorted) {
        if (keep.length < 7 && total > 0 && m.totalTokens / total >= 0.01) keep.push(m);
        else rest += m.totalTokens;
      }
      const items = keep.map((m, i) => ({ label: modelLabel(m), value: m.totalTokens, color: PIE_COLORS[i % PIE_COLORS.length] }));
      if (rest > 0) items.push({ label: "其他", value: rest, color: PIE_COLORS[7] });
      return items;
    }

    function donutSvg(items, total) {
      const r = 68, cx = 120, cy = 120, C = 2 * Math.PI * r;
      let acc = 0;
      const segs = items.map((it) => {
        const dash = total > 0 ? (it.value / total) * C : 0;
        const out = `<circle data-tip="${esc(`${it.label}&#10;${fmt(it.value)} tokens (${pctOf(it.value, total)})`)}" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${it.color}" stroke-width="26" stroke-dasharray="${dash} ${C - dash}" stroke-dashoffset="${-acc}" transform="rotate(-90 ${cx} ${cy})"/>`;
        acc += dash;
        return out;
      }).join("");
      return `<svg class="ts-donut" viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg">${segs}
<text x="${cx}" y="${cy - 6}" text-anchor="middle" font-size="15" font-weight="700" fill="currentColor">${fmtCompact(total)}</text>
<text x="${cx}" y="${cy + 15}" text-anchor="middle" font-size="10" fill="currentColor" opacity=".55">Tokens</text>
</svg>`;
    }

    /** 每日堆叠柱状图(输入/缓存读/缓存写/输出)。 */
    function stackedDays(byDay, range) {
      let days = [...byDay].sort((a, b) => (a.date < b.date ? -1 : 1));
      if (range === "14") days = days.slice(-14);
      return days.map((d) => ({
        date: d.date,
        inputTokens: d.inputTokens,
        cacheReadTokens: d.cacheReadTokens,
        cacheWriteTokens: d.cacheWriteTokens,
        outputTokens: d.outputTokens,
        totalTokens: d.totalTokens,
      }));
    }

    function stackedDaysSvg(days, W = 640, H = 220) {
      const padL = 52, padR = 10, padT = 10, padB = 24;
      const plotW = W - padL - padR, plotH = H - padT - padB;
      const maxTotal = Math.max(1, ...days.map((d) => d.totalTokens));
      const n = days.length;
      const barW = Math.max(2, (plotW / Math.max(1, n)) * 0.62);
      const gap = n > 1 ? (plotW - barW * n) / (n - 1) : 0;
      const yOf = (v) => padT + plotH - (v / maxTotal) * plotH;
      const cats = ["输入", "缓存读", "缓存写", "输出"];
      const keyOf = { "输入": "inputTokens", "缓存读": "cacheReadTokens", "缓存写": "cacheWriteTokens", "输出": "outputTokens" };
      let bars = "";
      days.forEach((d, i) => {
        const x = padL + i * (barW + gap);
        let y = padT + plotH;
        for (const c of cats) {
          const v = d[keyOf[c]];
          if (v <= 0) continue;
          const h = Math.max(1, (v / maxTotal) * plotH);
          bars += `<rect data-tip="${esc(`${d.date}&#10;${c}: ${fmt(v)} tokens`)}" x="${x.toFixed(1)}" y="${(y - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${CAT_COLORS[c]}" rx="1"/>`;
          y -= h;
        }
      });
      const grid = [0, 0.5, 1].map((f) => {
        const y = yOf(maxTotal * f);
        return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="currentColor" stroke-opacity=".12"/><text x="${padL - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="currentColor" opacity=".55">${fmtCompact(maxTotal * f)}</text>`;
      }).join("");
      const step = Math.max(1, Math.ceil(n / 8));
      const labels = days.map((d, i) => (i % step === 0
        ? `<text x="${(padL + i * (barW + gap) + barW / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="9" fill="currentColor" opacity=".55">${d.date.slice(5)}</text>`
        : "")).join("");
      return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${grid}${bars}${labels}</svg>`;
    }

    /** 模型用量横向排行(Top 10 + 其他)。 */
    function hbarItems(byModel, total) {
      const sorted = [...byModel].sort((a, b) => b.totalTokens - a.totalTokens);
      const keep = sorted.slice(0, 10);
      const rest = sorted.slice(10).reduce((n, m) => n + m.totalTokens, 0);
      const items = keep.map((m, i) => ({ label: modelLabel(m), value: m.totalTokens, color: PIE_COLORS[i % PIE_COLORS.length] }));
      if (rest > 0) items.push({ label: "其他", value: rest, color: PIE_COLORS[7] });
      return items;
    }

    function hbarSvg(items, total, W = 640) {
      const rowH = 22, labelW = 184, padR = 62, padL = 8, padT = 6;
      const H = padT + items.length * rowH + 10;
      const max = Math.max(1, ...items.map((i) => i.value));
      const plotW = W - labelW - padR - padL;
      const rows = items.map((it, i) => {
        const y = padT + i * rowH;
        const bw = (it.value / max) * plotW;
        return `<g><text x="${padL}" y="${y + 12}" font-size="11" fill="currentColor" opacity=".85">${esc(it.label)}</text>
<rect data-tip="${esc(`${it.label}&#10;${fmt(it.value)} tokens (${pctOf(it.value, total)})`)}" x="${labelW + padL}" y="${y + 3}" width="${Math.max(2, bw).toFixed(1)}" height="12" rx="2" fill="${it.color}"/>
<text x="${(labelW + padL + bw + 6).toFixed(1)}" y="${y + 13}" font-size="10" fill="currentColor" opacity=".65">${fmtCompact(it.value)}</text></g>`;
      }).join("");
      return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${rows}</svg>`;
    }

    /** 图表容器: 注入 SVG,处理悬停 tooltip(事件冒泡到容器,元素带 data-tip)。 */
    function ChartFrame({ svg }) {
      const ref = react.useRef(null);
      const [tip, setTip] = react.useState(null);
      return react_jsx_runtime.jsx("div", {
        ref,
        className: "ts-chart",
        onMouseMove: (e) => {
          const el = e.target && e.target.closest ? e.target.closest("[data-tip]") : null;
          if (!el) { setTip(null); return; }
          const rect = ref.current.getBoundingClientRect();
          setTip({ x: e.clientX - rect.left, y: e.clientY - rect.top, text: el.getAttribute("data-tip") });
        },
        onMouseLeave: () => setTip(null),
        children: [
          react_jsx_runtime.jsx("div", { className: "ts-chartSvg", dangerouslySetInnerHTML: { __html: svg } }),
          tip ? react_jsx_runtime.jsx("div", { className: "ts-tip", style: { left: tip.x, top: tip.y }, children: tip.text }) : null,
        ],
      });
    }

    /** 可视化浮层(窗口内,非全屏)。 */
    function VizModal({ snapshot, onClose }) {
      const [dayRange, setDayRange] = react.useState("14");
      react.useEffect(() => {
        const onKey = (e) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
      }, [onClose]);

      const total = snapshot.totals.totalTokens;
      const dItems = donutItems(snapshot.byModel, total);
      const days = stackedDays(snapshot.byDay, dayRange);
      const hItems = hbarItems(snapshot.byModel, total);
      const empty = snapshot.sessionCount === 0 || total === 0;

      const donutLegend = react_jsx_runtime.jsx("div", {
        className: "ts-seg",
        children: dItems.map((it) => react_jsx_runtime.jsx("span", { key: it.label, children: [
          react_jsx_runtime.jsx("span", { className: "ts-segDot", style: { background: it.color } }),
          `${it.label} ${pctOf(it.value, total)}`,
        ] })),
      });
      const stackedLegend = react_jsx_runtime.jsx("div", {
        className: "ts-seg",
        children: ["输入", "缓存读", "缓存写", "输出"].map((c) => react_jsx_runtime.jsx("span", { key: c, children: [
          react_jsx_runtime.jsx("span", { className: "ts-segDot", style: { background: CAT_COLORS[c] } }),
          c,
        ] })),
      });

      return react_jsx_runtime.jsx("div", {
        className: "ts-vizOverlay",
        onMouseDown: (e) => { if (e.target === e.currentTarget) onClose(); },
        children: react_jsx_runtime.jsx("div", {
          className: "ts-vizModal",
          children: [
            react_jsx_runtime.jsx("div", {
              className: "ts-vizHead",
              children: [
                react_jsx_runtime.jsx("div", { className: "ts-vizTitle", children: "Token 用量可视化" }),
                react_jsx_runtime.jsx("button", { className: "ts-vizClose", type: "button", onClick: onClose, "aria-label": "关闭", children: "✕" }),
              ],
            }),
            react_jsx_runtime.jsx("div", {
              className: "ts-vizBody",
              children: empty
                ? react_jsx_runtime.jsx("p", { className: "ts-meta", children: "暂无数据——先使用 DeepSeek Harness 跑几个会话,再来查看可视化。" })
                : [
                    react_jsx_runtime.jsx("div", {
                      className: "ts-chartBlock",
                      children: [
                        react_jsx_runtime.jsx("div", { className: "ts-chartBlockTitle", children: "① 模型用量占比" }),
                        donutLegend,
                        react_jsx_runtime.jsx(ChartFrame, { svg: donutSvg(dItems, total) }),
                      ],
                    }),
                    react_jsx_runtime.jsx("div", {
                      className: "ts-chartBlock",
                      children: [
                        react_jsx_runtime.jsx("div", {
                          className: "ts-chartBlockTitle",
                          children: [
                            react_jsx_runtime.jsx("span", { children: "② 每日用量" + (dayRange === "14" ? "(近 14 天)" : "(全部)") }),
                            react_jsx_runtime.jsx("div", {
                              className: "ts-rangeToggle",
                              children: [
                                react_jsx_runtime.jsx("button", { type: "button", className: dayRange === "14" ? "on" : "", onClick: () => setDayRange("14"), children: "近14天" }),
                                react_jsx_runtime.jsx("button", { type: "button", className: dayRange === "all" ? "on" : "", onClick: () => setDayRange("all"), children: "全部" }),
                              ],
                            }),
                          ],
                        }),
                        stackedLegend,
                        react_jsx_runtime.jsx(ChartFrame, { svg: stackedDaysSvg(days) }),
                      ],
                    }),
                    react_jsx_runtime.jsx("div", {
                      className: "ts-chartBlock",
                      children: [
                        react_jsx_runtime.jsx("div", { className: "ts-chartBlockTitle", children: "③ 模型用量排行" }),
                        react_jsx_runtime.jsx(ChartFrame, { svg: hbarSvg(hItems, total) }),
                      ],
                    }),
                  ],
            }),
          ],
        }),
      });
    }
    //#endregion

    /**
     * Token 用量统计卡片。
     * 折叠态只显示一个概要;点击头部展开,拉取桥数据渲染明细。
     */
    function TokenStatCard() {
      const [open, setOpen] = react.useState(false);
      const [state, setState] = react.useState({ status: "loading" });
      const [refreshing, setRefreshing] = react.useState(false);
      const [clearing, setClearing] = react.useState(false);
      const [footerMsg, setFooterMsg] = react.useState("");
      const [vizOpen, setVizOpen] = react.useState(false);
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

      /** 清空插件数据库(归档账本置零;历史会话标记忽略,不再自动重新导入)。 */
      const clearDb = react.useCallback(async () => {
        if (!window.confirm("确定清空插件数据库?\n累计用量与归档将全部清零,已有历史会话不会再被自动统计(之后的新会话正常统计)。")) return;
        setClearing(true);
        setFooterMsg("");
        try {
          const res = await fetch(`${BRIDGE}/clear`, { method: "POST", credentials: "same-origin" });
          const body = await res.json().catch(() => null);
          if (!res.ok || !body || body.ok !== true) {
            throw new Error((body && body.error) || `HTTP ${res.status}`);
          }
          setFooterMsg("已清空,从零开始统计");
          await load();
        } catch (error) {
          setFooterMsg(`清空失败: ${error && error.message ? error.message : String(error)}`);
        } finally {
          setClearing(false);
        }
      }, [load]);

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
                  react_jsx_runtime.jsx("div", {
                    className: "ts-actions",
                    children: [
                      footerMsg
                        ? react_jsx_runtime.jsx("span", { className: "ts-saved", children: footerMsg })
                        : null,
                      react_jsx_runtime.jsx("button", {
                        className: "ts-btn",
                        type: "button",
                        onClick: refresh,
                        disabled: refreshing || state.status !== "ready",
                        children: refreshing ? "重新扫描中…" : "重新扫描",
                      }),
                      react_jsx_runtime.jsx("button", {
                        className: "ts-btn",
                        type: "button",
                        onClick: () => setVizOpen(true),
                        disabled: state.status !== "ready",
                        children: "可视化",
                      }),
                      react_jsx_runtime.jsx("button", {
                        className: "ts-btn ts-btnDanger",
                        type: "button",
                        onClick: clearDb,
                        disabled: clearing || refreshing,
                        children: clearing ? "清空中…" : "清空插件数据库",
                      }),
                    ],
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
          vizOpen && state.status === "ready"
            ? react_jsx_runtime.jsx(VizModal, { snapshot: state.value.snapshot, onClose: () => setVizOpen(false) })
            : null,
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