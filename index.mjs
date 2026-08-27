/**
 * dsh-token-stat — DeepSeek Harness Token 用量统计插件
 *
 * 功能:
 *  - 统计使用 DeepSeek Harness 以来累计的 token 用量,并按模型区分明细。
 *  - 数据来源: 持久化的会话日志(session log)中的 assistant/message 事件,
 *    其 message.source.{provider,model} 记录产出模型,
 *    其 usage.{inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens} 记录
 *    供应商上报的精确 token 数(与官方 dsh-token-meter 同一数据源/口径)。
 *  - 同一 (turn, step) 步内重试/重复上报的 usage 只采纳最后一次采样,
 *    不会重复计数(与 dsh-token-meter 的 tokenUsage 投影语义一致)。
 *  - 设置页入口: 在「设置 → 插件 → 可配置」里出现一张「Token 用量统计」卡片,
 *    点击展开即显示累计用量(总数 / 按模型 / 按日期),数据由本插件提供的
 *    webServer 桥 (/api/token-stat/stats) 实时供给;
 *    卡片内还可在线更改「数据保存目录」(见 /api/token-stat/config)。
 *  - 数据隔离: 报告默认写到 ~/.dsh-token-stat(或 $DSH_TOKEN_STAT_DATA_DIR),
 *    完全位于 DSH_HOME 之外 —— 官方对 profiles / storages / sessions 等
 *    目录的任何清理、重装都不会误删本插件的数据;插件从 GitHub/市场安装后
 *    代码位于 profile 内部,因此默认目录不依赖模块位置。
 *
 * 零运行时依赖: 不 import 任何 @deepseek-ai/* 包(设置页 namespace 的 schema
 * 为手写兼容实现),因此既可作为独立文件加载,也可作为包(GitHub/市场安装,
 * 或本仓库 tools/install.mjs 的 junction 开发模式)供 client-modules 发现其
 * 浏览器半面。安装方式见 README.md。
 *
 * 服务通过 ctx.get() 探测(sessions / sessionPersistence / tools /
 * settings / webServer),缺失时优雅降级,不会让插件永久 PENDING。
 */

import * as os from 'node:os'
import * as path from 'node:path'
import { mkdir, writeFile, rename, stat } from 'node:fs/promises'

export const name = 'token-stat'

// ---------------------------------------------------------------------------
// 迷你 Standard Schema(免去对 @deepseek-ai/schemastery 的依赖)
// Cordis 契约: config['~standard'].validate(value) 返回 { issues } 或 { value }
// ---------------------------------------------------------------------------

function miniSchema(fields) {
  return {
    '~standard': {
      version: 1,
      vendor: 'token-stat',
      validate(value) {
        const input = value && typeof value === 'object' ? value : {}
        const out = {}
        const issues = []
        for (const [key, spec] of Object.entries(fields)) {
          const raw = key in input ? input[key] : spec.default
          if (raw === undefined) continue
          const bad = (msg) => issues.push({
            keyword: 'type',
            message: `${key}: ${msg}`,
            path: [{ type: 'property', key }],
          })
          if (spec.type === 'boolean' && typeof raw !== 'boolean') bad(`expected boolean, got ${typeof raw}`)
          else if (spec.type === 'string' && typeof raw !== 'string') bad(`expected string, got ${typeof raw}`)
          else if (spec.type === 'number' && (typeof raw !== 'number' || !Number.isFinite(raw))) bad(`expected finite number, got ${typeof raw}`)
          else out[key] = raw
        }
        return issues.length > 0 ? { issues } : { value: out }
      },
    },
  }
}

/**
 * 插件配置(均可通过 cordis.yml / cordis.patch.yml 的 config 覆盖):
 *  - enabled:      总开关,默认 true
 *  - reportDir:    报告输出目录,默认 '' = 自动选择(见 pluginDataDir)
 *                  (插件目录即本项目所在目录,位于 DSH_HOME 之外,官方清理不会误删)
 *  - writeMd:      是否写 Markdown 报告,默认 true
 *  - writeJson:    是否写 JSON 快照,默认 true
 *  - debounceMs:   实时事件落盘最小间隔(毫秒),默认 2000
 *  - verbose:      详细日志,默认 false
 */
export const Config = miniSchema({
  enabled: { type: 'boolean', default: true },
  reportDir: { type: 'string', default: '' },
  writeMd: { type: 'boolean', default: true },
  writeJson: { type: 'boolean', default: true },
  debounceMs: { type: 'number', default: 2000 },
  verbose: { type: 'boolean', default: false },
})

/**
 * 设置页 namespace 的迷你 schema(兼容 dsh-settings 的用法):
 *  - schema(value)     -> 解析后的配置对象(忽略未知键,补充默认值)
 *  - schema.toJSON()   -> 供 describe() 生成表单描述
 * 不声明任何 role:'secret' 字段,因此不会被 secret redaction 处理。
 */
export function settingsSchemaFor(defaults = {}) {
  const fields = [
    ['enabled', 'boolean', '总开关'],
    ['reportDir', 'string', '报告输出目录(留空 = 自动选择插件数据目录)'],
    ['writeMd', 'boolean', '是否写 Markdown 报告'],
    ['writeJson', 'boolean', '是否写 JSON 快照'],
    ['debounceMs', 'number', '实时事件落盘最小间隔(毫秒)'],
    ['verbose', 'boolean', '详细日志'],
  ]
  const schema = (value) => {
    const input = value && typeof value === 'object' ? value : {}
    const out = {}
    for (const [key, raw] of Object.entries(input)) {
      if (!(raw === undefined || raw === null)) out[key] = raw
    }
    for (const [key, type] of fields) {
      if (out[key] === undefined) {
        if (key in defaults && defaults[key] !== undefined) out[key] = defaults[key]
        else if (type === 'boolean') out[key] = true
        else if (type === 'number') out[key] = 2000
        else out[key] = ''
      }
    }
    return out
  }
  schema.toJSON = () => ({
    type: 'object',
    properties: Object.fromEntries(fields.map(([key, type, title]) => [key, { type, title }])),
  })
  schema['~standard'] = miniSchema(Object.fromEntries(fields.map(([key, type]) => [key, { type }])))['~standard']
  return schema
}

// ---------------------------------------------------------------------------
// 纯折叠逻辑(与 dsh-token-meter 同口径,导出以便独立回放验证)
// 事件形态(session log 持久事件的子集):
//   request/context      -> { provider, model }
//   assistant/message    -> { turn, step, message{source{provider,model}}, usage{...} }
// ---------------------------------------------------------------------------

const SESSION_ROOT_ENV = 'DSH_HOME'

function bucketTotal(b) {
  return b.inputTokens + b.outputTokens + b.cacheReadTokens + b.cacheWriteTokens
}

function addBuckets(target, b) {
  target.inputTokens += b.inputTokens
  target.outputTokens += b.outputTokens
  target.cacheReadTokens += b.cacheReadTokens
  target.cacheWriteTokens += b.cacheWriteTokens
}

function subBuckets(target, b) {
  target.inputTokens -= b.inputTokens
  target.outputTokens -= b.outputTokens
  target.cacheReadTokens -= b.cacheReadTokens
  target.cacheWriteTokens -= b.cacheWriteTokens
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0
}

/** 本地时区日期 YYYY-MM-DD。 */
export function dayKey(timeMs) {
  const d = new Date(typeof timeMs === 'number' ? timeMs : Date.now())
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

function modelKey(provider, model) {
  return `${provider}::${model}`
}

/** 新建一个会话的折叠状态。 */
export function createFold() {
  return {
    models: new Map(), // modelKey -> { provider, model, requests, input, output, cacheRead, cacheWrite }
    days: new Map(),   // 'YYYY-MM-DD' -> { requests, input, output, cacheRead, cacheWrite }
    last: null,        // { turn, step, key, day, buckets }
    route: null,       // 最近一次 request/context 的 { provider, model }
    messageCount: 0,   // 处理的 assistant/message 事件总数
    usageCount: 0,     // 带 usage 的 assistant/message 事件总数
    usageCalls: 0,     // 去重后的 usage 采样数(按 turn/step)
  }
}

function ensureModel(fold, provider, model) {
  const key = modelKey(provider, model)
  let rec = fold.models.get(key)
  if (!rec) {
    rec = { provider, model, requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
    fold.models.set(key, rec)
  }
  return rec
}

function ensureDay(fold, day) {
  let rec = fold.days.get(day)
  if (!rec) {
    rec = { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
    fold.days.set(day, rec)
  }
  return rec
}

/**
 * 把一个会话日志事件折叠进状态。
 * 纯函数式输入: 事件来自持久日志或实时 session/event,两者格式一致。
 */
export function applyEventToFold(fold, event) {
  if (!event || typeof event !== 'object') return fold
  switch (event.type) {
    case 'request/context': {
      const p = event.data?.provider
      const m = event.data?.model
      if (typeof p === 'string' && typeof m === 'string') fold.route = { provider: p, model: m }
      return fold
    }
    case 'request/header': {
      // 兜底路由: 只用于极老日志没有 request/context 时
      if (!fold.route) {
        const cfg = event.data?.header?.config
        if (cfg && typeof cfg.provider === 'string' && typeof cfg.model === 'string') {
          fold.route = { provider: cfg.provider, model: cfg.model }
        }
      }
      return fold
    }
    case 'assistant/message': {
      const data = event.data || {}
      const msg = data.message || {}
      const source = msg.source || {}
      fold.messageCount += 1
      const usage = data.usage
      if (!usage || typeof usage !== 'object') return fold
      fold.usageCount += 1

      // 模型归属: 优先消息自带 source,退回最近路由,最后 unknown
      const provider = typeof source.provider === 'string' && source.provider
        ? source.provider
        : (fold.route?.provider || 'unknown')
      const model = typeof source.model === 'string' && source.model
        ? source.model
        : (fold.route?.model || 'unknown')
      if (fold.route === null && provider !== 'unknown') {
        fold.route = { provider, model }
      }

      const buckets = {
        inputTokens: num(usage.inputTokens),
        outputTokens: num(usage.outputTokens),
        cacheReadTokens: num(usage.cacheReadTokens),
        cacheWriteTokens: num(usage.cacheWriteTokens),
      }
      const turn = data.turn
      const step = data.step
      const sameStep = fold.last !== null && fold.last.turn === turn && fold.last.step === step
      const key = modelKey(provider, model)
      const day = dayKey(event.time)

      if (sameStep) {
        // 同一步重试/重复上报: 替换旧采样,不重复计数
        const prev = fold.last
        const prevModel = fold.models.get(prev.key)
        if (prevModel) subBuckets(prevModel, prev.buckets)
        const prevDay = fold.days.get(prev.day)
        if (prevDay) subBuckets(prevDay, prev.buckets)
      } else {
        fold.usageCalls += 1
        ensureDay(fold, day).requests += 1
        ensureModel(fold, provider, model).requests += 1
      }

      addBuckets(ensureModel(fold, provider, model), buckets)
      addBuckets(ensureDay(fold, day), buckets)
      fold.last = { turn, step, key, day, buckets }
      return fold
    }
    default:
      return fold
  }
}

/** 用整段事件回放重建一次折叠(等价于 createFold 后逐个 apply)。 */
export function foldEvents(events) {
  const fold = createFold()
  for (const event of events || []) applyEventToFold(fold, event)
  return fold
}

// ---------------------------------------------------------------------------
// 汇总快照
// ---------------------------------------------------------------------------

/** 把一系列会话 fold 汇总成全局快照(纯数据,可序列化)。 */
export function buildSnapshot(folds) {
  const byModel = new Map()
  const byDay = new Map()
  let sessionCount = 0
  let messageCount = 0
  let usageCount = 0
  let usageCalls = 0

  for (const fold of folds) {
    if (!fold) continue
    sessionCount += 1
    messageCount += fold.messageCount
    usageCount += fold.usageCount
    usageCalls += fold.usageCalls
    for (const rec of fold.models.values()) {
      const key = modelKey(rec.provider, rec.model)
      let agg = byModel.get(key)
      if (!agg) {
        agg = {
          provider: rec.provider,
          model: rec.model,
          requests: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        }
        byModel.set(key, agg)
      }
      agg.requests += rec.requests
      addBuckets(agg, rec)
    }
    for (const [day, rec] of fold.days) {
      let agg = byDay.get(day)
      if (!agg) {
        agg = { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
        byDay.set(day, agg)
      }
      agg.requests += rec.requests
      addBuckets(agg, rec)
    }
  }

  const totals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
  for (const rec of byModel.values()) addBuckets(totals, rec)

  const models = [...byModel.values()]
    .sort((a, b) => bucketTotal(b) - bucketTotal(a))
    .map((m) => ({
      provider: m.provider,
      model: m.model,
      requests: m.requests,
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens,
      cacheReadTokens: m.cacheReadTokens,
      cacheWriteTokens: m.cacheWriteTokens,
      totalTokens: bucketTotal(m),
    }))

  const days = [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, r]) => ({
      date,
      requests: r.requests,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      cacheReadTokens: r.cacheReadTokens,
      cacheWriteTokens: r.cacheWriteTokens,
      totalTokens: bucketTotal(r),
    }))

  return {
    totals: {
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      cacheReadTokens: totals.cacheReadTokens,
      cacheWriteTokens: totals.cacheWriteTokens,
      totalTokens: bucketTotal(totals),
    },
    byModel: models,
    byDay: days,
    sessionCount,
    messageCount,
    usageCount,
    usageCalls,
  }
}

// ---------------------------------------------------------------------------
// 报告渲染
// ---------------------------------------------------------------------------

function fmt(n) {
  return (typeof n === 'number' ? n : 0).toLocaleString('zh-CN')
}

/** 生成 Markdown 报告。 */
export function renderMarkdown(snapshot, meta = {}) {
  const L = []
  const t = snapshot.totals
  L.push('# DeepSeek Harness Token 用量统计')
  L.push('')
  L.push(`- 统计时间: ${meta.scannedAt ? new Date(meta.scannedAt).toLocaleString('zh-CN') : '—'}`)
  L.push(`- 覆盖会话: ${snapshot.sessionCount} 个`)
  L.push(`- assistant 消息: ${fmt(snapshot.messageCount)} 条,其中带 usage ${fmt(snapshot.usageCount)} 条(去重 ${fmt(snapshot.usageCalls)} 次模型请求)`)
  if (meta.sources) L.push(`- 数据来源: ${meta.sources}`)
  L.push('')
  L.push('## 累计总量')
  L.push('')
  L.push('| 指标 | Tokens |')
  L.push('| --- | ---: |')
  L.push(`| 输入(未命中缓存) | ${fmt(t.inputTokens)} |`)
  L.push(`| 缓存读取 | ${fmt(t.cacheReadTokens)} |`)
  L.push(`| 缓存写入 | ${fmt(t.cacheWriteTokens)} |`)
  L.push(`| 输出 | ${fmt(t.outputTokens)} |`)
  L.push(`| **总计** | **${fmt(t.totalTokens)}** |`)
  L.push('')
  L.push('## 按模型')
  L.push('')
  if (snapshot.byModel.length === 0) {
    L.push('(暂无数据)')
  } else {
    L.push('| 模型 | 请求数 | 输入 | 缓存读 | 缓存写 | 输出 | 合计 |')
    L.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |')
    for (const m of snapshot.byModel) {
      const label = m.provider && m.provider !== 'unknown' ? `${m.provider}/${m.model}` : m.model
      L.push(`| ${label} | ${fmt(m.requests)} | ${fmt(m.inputTokens)} | ${fmt(m.cacheReadTokens)} | ${fmt(m.cacheWriteTokens)} | ${fmt(m.outputTokens)} | ${fmt(m.totalTokens)} |`)
    }
  }
  L.push('')
  L.push('## 按日期(近 14 天)')
  L.push('')
  if (snapshot.byDay.length === 0) {
    L.push('(暂无数据)')
  } else {
    L.push('| 日期 | 请求数 | 输入 | 缓存读 | 缓存写 | 输出 | 合计 |')
    L.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |')
    for (const d of snapshot.byDay.slice(0, 14)) {
      L.push(`| ${d.date} | ${fmt(d.requests)} | ${fmt(d.inputTokens)} | ${fmt(d.cacheReadTokens)} | ${fmt(d.cacheWriteTokens)} | ${fmt(d.outputTokens)} | ${fmt(d.totalTokens)} |`)
    }
  }
  L.push('')
  L.push('> 统计口径: 会话日志中 assistant/message 事件携带的供应商上报 usage')
  L.push('> (inputTokens / outputTokens / cacheReadTokens / cacheWriteTokens);')
  L.push('> 同一 turn/step 的重试只计最后一次采样,不重复计数。')
  if (meta.reportPath) L.push(`> 报告文件: ${meta.reportPath}`)
  return L.join('\n')
}

/** 生成 JSON 快照文档。 */
export function renderJson(snapshot, meta = {}) {
  return `${JSON.stringify({ version: 1, ...meta, snapshot }, null, 2)}\n`
}

// ---------------------------------------------------------------------------
// 插件主体
// ---------------------------------------------------------------------------

function resolveDshHome() {
  const env = process.env[SESSION_ROOT_ENV]
  if (env && env.trim().length > 0) return path.resolve(env.trim())
  return path.join(os.homedir(), '.dsh')
}

/**
 * 默认数据保存目录(DSH_HOME 之外,官方清理不会误删):
 *  1) 显式配置文件/设置页里配的 reportDir 优先(见 normalizeReportDir);
 *  2) 未配置时依次取 $DSH_TOKEN_STAT_DATA_DIR -> ~/.dsh-token-stat。
 * 不再依赖模块所在位置:插件从 GitHub/市场安装后代码位于 profile 内部,
 * 若按旧逻辑会把报告写进 DSH_HOME,隔离保证就失效了。
 */
export function pluginDataDir() {
  const env = process.env.DSH_TOKEN_STAT_DATA_DIR
  if (env && env.trim().length > 0) return path.resolve(env.trim())
  return path.join(os.homedir(), '.dsh-token-stat')
}

// ----- 设置页桥(webServer 路由,仿照官方插件 dsh-free-search 的做法) -----

const BRIDGE_PREFIX = '/api/token-stat'

function isLoopbackRequest(request) {
  const address = request.socket?.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers?.host
  if (typeof host !== 'string') return false
  let hostUrl
  try {
    hostUrl = new URL('http://' + host)
  } catch {
    return false
  }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (request.headers?.['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers?.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

function writeJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead?.(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  res.end?.(payload)
}

const MAX_JSON_BODY_BYTES = 64 * 1024

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_JSON_BODY_BYTES) return undefined
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return undefined
  }
}

/** 报告目录规范化: 空白/未配置 -> 插件默认数据目录(DSH_HOME 之外),否则绝对化。 */
function normalizeReportDir(raw) {
  return raw && typeof raw === 'string' && raw.trim().length > 0
    ? path.resolve(raw.trim())
    : pluginDataDir()
}

/** 迁移既有报告文件(report.md / report.json)到新目录;返回是否发生迁移。 */
async function migrateReportData(fromDir, toDir) {
  if (fromDir === toDir) return false
  let fromStat = null
  try {
    fromStat = await stat(fromDir)
  } catch {
    return false
  }
  if (!fromStat.isDirectory()) return false
  await mkdir(toDir, { recursive: true })
  let moved = 0
  for (const fileName of ['report.md', 'report.json']) {
    const src = path.join(fromDir, fileName)
    const dst = path.join(toDir, fileName)
    try {
      await rename(src, dst)
      moved += 1
    } catch {
      // 源文件不存在 / 跨卷(EXDEV)等情况: 保留原文件,后面 save() 会在新目录重建
    }
  }
  return moved > 0
}

export function apply(ctx, config) {
  const logger = ctx.logger ?? console
  if (config.enabled === false) {
    logger.info?.('[token-stat] 已在配置中禁用 (enabled: false)')
    return
  }

  const dshHome = resolveDshHome()
  // 报告目录可在运行时通过设置页/配置变更(见 applyConfiguredDir),故用 let
  let reportDir = normalizeReportDir(config.reportDir)
  let mdPath = path.join(reportDir, 'report.md')
  let jsonPath = path.join(reportDir, 'report.json')

  // ----- 运行时服务探测(信息用;settings/webServer 的实际接线走下端 ctx.inject) -----
  const sessionsSvc = ctx.get('sessions')
  const persistenceSvc = ctx.get('sessionPersistence')
  const toolsSvc = ctx.get('tools')
  const settingsSvc = ctx.get('settings')
  const webServerSvc = ctx.get('webServer')
  logger.info?.(
    `[token-stat] 已加载 reportDir=${reportDir}, ` +
    `sessions=${sessionsSvc ? 'ok' : 'n/a'}, persistence=${persistenceSvc ? 'ok' : 'n/a'}, ` +
    `tools=${toolsSvc ? 'ok' : 'n/a'}, settings=${settingsSvc ? 'ok' : 'n/a'}, webServer=${webServerSvc ? 'ok' : 'n/a'}`,
  )

  // ----- 会话折叠状态 -----
  /** sessionId -> fold */
  const folds = new Map()
  /** sessionId -> 是否已完成全量回放(seal) */
  const sealed = new Set()
  /** 未 seal 会话的实时事件缓冲: sessionId -> events[] */
  const pending = new Map()
  /** 扫描进行中标志(报告里提示部分数据) */
  let scanning = false
  let lastScanError = null
  let scannedAt = 0
  /** 设置页维护的已配置报告目录(空串 = 自动默认目录),随 settings 变更更新 */
  let configuredReportDir = ''

  const ensure = (id) => {
    let f = folds.get(id)
    if (!f) {
      f = createFold()
      folds.set(id, f)
    }
    return f
  }

  /** 实时事件入口: 未 seal 的会话先进缓冲,seal 后立即应用。 */
  function onSessionEvent(session, event) {
    const id = session?.id
    if (!id || !event) return
    if (!sealed.has(id)) {
      let q = pending.get(id)
      if (!q) {
        q = []
        pending.set(id, q)
      }
      q.push(event)
      return
    }
    applyEventToFold(ensure(id), event)
    scheduleSave()
  }

  /** 封存: 全量回放主事件 + 缓冲中新事件(seal 幂等)。 */
  function seal(id, events) {
    if (sealed.has(id)) return
    const q = pending.get(id) || []
    pending.delete(id)
    folds.set(id, foldEvents([...(events || []), ...q]))
    sealed.add(id)
  }

  // ----- 持久化 -----
  let saveTimer = null
  let saveQueue = Promise.resolve()

  function snapshotMeta() {
    const s = { scannedAt: scannedAt || Date.now() }
    if (scanning) s.status = 'scanning'
    if (lastScanError) s.lastScanError = String(lastScanError)
    s.sources = dshHome
    s.reportDir = reportDir
    s.reportDirConfigured = configuredReportDir
    s.reportMd = mdPath
    s.reportJson = jsonPath
    return s
  }

  /**
   * 应用(可能来自设置页或配置文件变更的)报告目录:
   * 规范化后若与当前不同,则切换路径、迁移既有报告文件并重新落盘。
   */
  function applyConfiguredDir(raw) {
    const next = normalizeReportDir(raw)
    if (next === reportDir) return
    const previous = reportDir
    reportDir = next
    mdPath = path.join(reportDir, 'report.md')
    jsonPath = path.join(reportDir, 'report.json')
    logger.info?.('[token-stat] 数据保存目录已变更:', previous, '->', reportDir)
    void (async () => {
      try {
        await migrateReportData(previous, reportDir)
      } catch (error) {
        logger.warn?.('[token-stat] 迁移报告文件失败(将在新目录重建):', error)
      }
      await save()
    })()
  }

  /** 给设置页桥/工具用的当前统计视图(纯数据)。 */
  function statsView() {
    return { snapshot: buildSnapshot(folds.values()), meta: snapshotMeta() }
  }

  async function save() {
    const meta = snapshotMeta()
    try {
      await mkdir(reportDir, { recursive: true })
      if (config.writeJson) {
        await writeFile(jsonPath, renderJson(buildSnapshot(folds.values()), { ...meta, reportPath: jsonPath }), 'utf8')
      }
      if (config.writeMd) {
        await writeFile(mdPath, renderMarkdown(buildSnapshot(folds.values()), { ...meta, reportPath: mdPath }), 'utf8')
      }
    } catch (error) {
      logger.warn?.('[token-stat] 保存报告失败:', error)
    }
  }

  function scheduleSave() {
    if (saveTimer) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      saveQueue = saveQueue.then(save).catch(() => {})
    }, Math.max(50, config.debounceMs || 2000))
  }

  // 卸载时先把定时器和落盘清掉
  ctx.effect(() => {
    return async () => {
      if (saveTimer) {
        clearTimeout(saveTimer)
        saveTimer = null
      }
      try {
        await saveQueue
        await save()
      } catch { /* 忽略卸载时的写盘错误 */ }
    }
  })

  // ----- 历史扫描 -----
  async function scanAll() {
    scanning = true
    try {
      // 1) 先封存当前在内存中的会话(最新、可能尚未落盘)
      const live = sessionsSvc ? sessionsSvc.list() : []
      for (const session of live) seal(session.id, session.events)

      // 2) 再扫磁盘上所有持久会话
      if (persistenceSvc && typeof persistenceSvc.list === 'function') {
        let headers
        try {
          headers = await persistenceSvc.list()
        } catch (error) {
          lastScanError = error
        }
        for (const header of headers || []) {
          const id = header?.id
          if (!id || sealed.has(id)) continue
          try {
            const { events } = await persistenceSvc.readFrom(id, 0)
            if (!sealed.has(id)) seal(id, events)
          } catch (error) {
            lastScanError = error
            logger.warn?.('[token-stat] 读取会话失败,已跳过:', id, String(error))
          }
        }
        logger.info?.('[token-stat] 历史扫描完成,共封存会话', sealed.size, '个')
      }

      // 3) 兜底: 扫描期间新出现的 live 会话
      if (sessionsSvc) {
        for (const session of sessionsSvc.list()) if (!sealed.has(session.id)) seal(session.id, session.events)
      }
    } catch (error) {
      lastScanError = error
      logger.warn?.('[token-stat] 历史扫描异常:', error)
    } finally {
      scanning = false
      scannedAt = Date.now()
      await save()
    }
  }

  /** 从磁盘整体重建一次(幂等: 每个会话都从全量事件重新折叠,不会重复计数)。 */
  async function rescanFromDisk() {
    sealed.clear()
    pending.clear()
    await scanAll()
  }

  // ----- 工具注册(零依赖普通对象,形状与 defineTool 输出一致) -----
  if (toolsSvc && typeof toolsSvc.register === 'function') {
    const snapshotNow = () => {
      const snap = buildSnapshot(folds.values())
      const meta = snapshotMeta()
      return renderMarkdown(snap, { ...meta, reportPath: mdPath })
    }
    const tool = {
      name: 'token_usage_stats',
      description:
        '查询 DeepSeek Harness 累计 token 用量统计(总量 + 按模型 + 按日期),数据来自会话日志中供应商上报的 usage,覆盖所有历史会话。也可在「设置 → 插件 → 可配置 → Token 用量统计」里查看实时汇总。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute() {
        return snapshotNow()
      },
    }
    toolsSvc.register(tool)
    logger.info?.('[token-stat] 已注册工具 token_usage_stats')
  }

  // ----- 设置页: 注册 namespace + 数据桥(等 settings/webServer 服务就绪后再挂) -----
  // 这两个服务在 web 部署里必然存在,用 ctx.inject 保证任何激活顺序都拿得到;
  // 其余可选服务(sessions/persistence/tools)仍用 ctx.get() 探测、优雅降级。
  ctx.inject(['settings', 'webServer'], (sctx) => {
    // 1) 注册 namespace: 让官方「设置 → 插件 → 可配置」渲染本插件卡片
    const settingsSvc2 = sctx.get('settings')
    let settingsScope = null
    if (settingsSvc2 && typeof settingsSvc2.register === 'function') {
      try {
        settingsScope = settingsSvc2.register('token-stat', settingsSchemaFor(config), { base: config })
        configuredReportDir = settingsScope.get()?.reportDir ?? ''
        // 运行时变更(设置页写盘 / settings.yaml 手工修改)都会走这里:
        // 归一化目录、迁移旧报告、重新落盘。
        settingsScope.watch((next) => applyConfiguredDir(next?.reportDir))
        // 初始状态与 apply() 顶部一致(register 的 base 就是 config),幂等无害
        applyConfiguredDir(configuredReportDir)
        logger.info?.('[token-stat] 已注册 settings namespace token-stat(设置页入口就绪), 数据目录可在线修改')
      } catch (error) {
        logger.warn?.('[token-stat] 注册 settings namespace 失败(设置页卡片可能不可用):', error)
      }
    }

    // 2) 数据桥(仅回环访问,仿官方 dsh-free-search)
    const webServerSvc2 = sctx.get('webServer')
    if (webServerSvc2 && typeof webServerSvc2.register === 'function') {
      const guard = (req, res) => {
        if (!isLoopbackRequest(req)) {
          writeJson(res, 403, { ok: false, error: 'loopback requests only' })
          return false
        }
        return true
      }
      const routes = [
        {
          kind: 'exact',
          path: `${BRIDGE_PREFIX}/stats`,
          handler: async (req, res) => {
            if (!guard(req, res)) return
            writeJson(res, 200, { ok: true, value: statsView() })
          },
        },
        {
          kind: 'exact',
          path: `${BRIDGE_PREFIX}/refresh`,
          handler: async (req, res) => {
            if (!guard(req, res)) return
            if (req.method !== 'POST') {
              writeJson(res, 405, { ok: false, error: 'method not allowed' })
              return
            }
            void rescanFromDisk()
            writeJson(res, 200, { ok: true, status: 'scanning' })
          },
        },
        {
          kind: 'exact',
          path: `${BRIDGE_PREFIX}/config`,
          handler: async (req, res) => {
            if (!guard(req, res)) return
            if (req.method !== 'POST') {
              writeJson(res, 405, { ok: false, error: 'method not allowed' })
              return
            }
            const body = await readJsonBody(req)
            if (!body || typeof body !== 'object' || typeof body.reportDir !== 'string') {
              writeJson(res, 400, { ok: false, error: 'body must be {"reportDir": string | ""}' })
              return
            }
            if (!settingsSvc2 || settingsScope === null) {
              writeJson(res, 500, { ok: false, error: 'settings service unavailable' })
              return
            }
            try {
              // 写入官方 settings 用户层: 空串 = 恢复自动(插件默认数据目录)。
              // 写盘完成后 commit 会触发 settingsScope.watch -> applyConfiguredDir 切换目录并迁移报告。
              await settingsSvc2.update('token-stat', { reportDir: body.reportDir })
              const nextConfigured = settingsScope.get()?.reportDir ?? ''
              configuredReportDir = nextConfigured
              writeJson(res, 200, {
                ok: true,
                value: {
                  configured: nextConfigured,
                  reportDir: normalizeReportDir(nextConfigured),
                },
              })
            } catch (error) {
              writeJson(res, 400, { ok: false, error: String(error?.message ?? error) })
            }
          },
        },
      ]
      for (const route of routes) {
        try {
          webServerSvc2.register(route)
        } catch (error) {
          logger.warn?.('[token-stat] 注册 webServer 路由失败:', route?.path, String(error))
        }
      }
      logger.info?.('[token-stat] 设置页桥已就绪:', BRIDGE_PREFIX)
    }
  }, 'token-stat: settings page wiring')

  // ----- 实时监听(global: true 接收所有会话,含子 agent) -----
  ctx.on('session/created', (session) => {
    if (session?.id && !sealed.has(session.id)) seal(session.id, session.events)
  })
  ctx.on('session/event', onSessionEvent, { global: true })

  // 启动历史扫描(异步,不阻塞加载)
  void scanAll()

  logger.info?.('[token-stat] 插件已就绪,开始统计历史 token 用量')
}