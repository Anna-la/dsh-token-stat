/**
 * 插件加载冒烟测试: 用最小 fake ctx 加载 dsh-token-stat,
 * 验证 apply() 可运行、服务探测/工具注册/报告落盘均正常,
 * 以及 Config 符合 Cordis Standard Schema 契约。
 *
 * 用法: node tools/smoke-test.mjs
 */

import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as zlib from 'node:zlib'
import * as plugin from '../index.mjs'

// ---- 1) 模块形状 ----
assert.equal(typeof plugin.apply, 'function', 'apply 应为函数')
assert.equal(plugin.name, 'token-stat')
assert.ok(plugin.Config && typeof plugin.Config['~standard']?.validate === 'function', 'Config 应为 Standard Schema')
console.log('ok: 模块形状 (name/apply/Config)')

// ---- 2) Config 验证 ----
{
  const validate = plugin.Config['~standard'].validate
  const ok = validate({ reportDir: 'd:/x', debounceMs: 500, writeMd: true })
  assert.ok(!ok.issues, '合法配置应通过')
  assert.equal(ok.value.reportDir, 'd:/x')
  assert.equal(ok.value.debounceMs, 500)
  const bad = validate({ debounceMs: 'abc' })
  assert.ok(Array.isArray(bad.issues) && bad.issues.length > 0, '非法配置应报错')
  console.log('ok: Config 校验 (合法通过 / 非法报错)')
}

// ---- 3) apply() 冒烟 ----
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'token-stat-smoke-'))
// 会话根目录与默认数据目录都重定向到 TEMP 内,避免测试触碰真实 ~/.dsh-token-stat
process.env.DSH_HOME = TEMP
process.env.DSH_TOKEN_STAT_DATA_DIR = path.join(TEMP, 'auto')

// 磁盘会话日志(模拟真实布局 <sessions>/<项目>/<会话>/session*.zstd):
// 这正对应线上缺陷场景 —— 重启时持久化服务尚未就绪(list 为空),
// 插件必须能直接扫到磁盘上的全部历史会话。
const SID = 'disk-session-1'
const sessionDir = path.join(TEMP, 'sessions', 'proj-a', SID)
fs.mkdirSync(sessionDir, { recursive: true })
const sessionEvents = [
  { type: 'request/context', seq: 0, time: Date.now() - 60000, data: { provider: 'smoke-p', model: 'smoke-m' } },
  {
    type: 'assistant/message',
    seq: 1,
    time: Date.now() - 30000,
    data: {
      turn: 1,
      step: 0,
      message: { role: 'assistant', content: [], source: { kind: 'model', provider: 'smoke-p', model: 'smoke-m' } },
      usage: { inputTokens: 111, outputTokens: 22 },
    },
  },
]
{
  const lines = [{ type: 'session', seq: -1, time: Date.now() - 120000, data: { id: SID } }, ...sessionEvents]
  const payload = Buffer.from(lines.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8')
  fs.writeFileSync(path.join(sessionDir, 'session.jsonl.zstd'), zlib.zstdCompressSync(payload))
}

const registered = []
const observerseen = []
const settingsRegistered = []
const settingsUpdates = []
const settingsStores = new Map()    // ns -> 用户层合并后的解析值
const settingsWatchers = new Map()  // ns -> Set<cb>
const routes = []
let disposers = 0
// 持久化服务 fake: 默认 list 为空(模拟重启时服务未就绪),测试中可切换到有数据
let persistenceHeaders = []
const persistenceEvents = () => sessionEvents

function bodyReader(payload, parts = 1) {
  const chunks = (payload === undefined ? [] : [Buffer.from(payload)]).slice(0, parts)
  return {
    [Symbol.asyncIterator]() {
      let i = 0
      return {
        next: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true }),
      }
    },
  }
}

const fakeCtx = {
  logger: {
    info: (...a) => console.log('  [logger.info]', a.join(' ')),
    warn: (...a) => console.log('  [logger.warn]', a.join(' ')),
  },
  get(name) {
    if (name === 'tools') {
      return {
        register(tool) {
          registered.push(tool)
          console.log('  [tools.register]', tool.name)
        },
      }
    }
    if (name === 'settings') {
      return {
        register(ns, schema, options) {
          const key = String(ns)
          if (!settingsStores.has(key)) {
            const base = { ...(options?.base || {}) }
            try {
              Object.assign(base, schema(base)) // 用 schema 补齐默认字段
            } catch { /* 忽略 */ }
            settingsStores.set(key, base)
          }
          if (!settingsWatchers.has(key)) settingsWatchers.set(key, new Set())
          settingsRegistered.push({ ns, schema, options })
          console.log('  [settings.register]', String(ns))
          const scope = {
            get: () => ({ ...settingsStores.get(key) }),
            watch: (cb) => {
              settingsWatchers.get(key).add(cb)
              return () => settingsWatchers.get(key)?.delete(cb)
            },
            update: async (patch) => {
              Object.assign(settingsStores.get(key), patch)
              for (const cb of [...(settingsWatchers.get(key) || [])]) {
                try {
                  cb({ ...settingsStores.get(key) })
                } catch (error) {
                  console.log('  [settings.watch] threw:', error?.message)
                }
              }
              return Promise.resolve()
            },
          }
          settingsRegistered[settingsRegistered.length - 1].scope = scope
          return scope
        },
        update(ns, patch) {
          const key = String(ns)
          if (!settingsStores.has(key)) throw new Error(`settings namespace "${key}" is not registered`)
          settingsUpdates.push({ ns, patch })
          Object.assign(settingsStores.get(key), patch)
          for (const cb of [...(settingsWatchers.get(key) || [])]) {
            try {
              cb({ ...settingsStores.get(key) })
            } catch (error) {
              console.log('  [settings.watch] threw:', error?.message)
            }
          }
          return Promise.resolve()
        },
      }
    }
    if (name === 'webServer') {
      return {
        register(route) {
          routes.push(route)
          console.log('  [webServer.register]', route.kind, route.path)
        },
      }
    }
    if (name === 'sessions') {
      return {
        list: () => [],
      }
    }
    if (name === 'sessionPersistence') {
      return {
        list: async () => persistenceHeaders,
        readFrom: async () => ({ events: persistenceEvents() }),
      }
    }
    return undefined
  },
  on(event, handler, opts) {
    observerseen.push({ event, global: !!opts?.global })
    return () => {}
  },
  inject(names, callback) {
    const list = typeof names === 'string' ? [names] : names
    console.log('  [ctx.inject]', list.join('+'))
    const sctx = {
      get: (n) => fakeCtx.get(n),
      effect: (fn) => fakeCtx.effect(fn),
    }
    const result = callback(sctx)
    return typeof result === 'function' ? result : () => {}
  },
  effect(fn) {
    disposers += 1
    const disposer = fn()
    return () => (typeof disposer === 'function' ? disposer() : undefined)
  },
}

console.log('--- apply({ config }) ---')
applyAndWait(fakeCtx, {
  enabled: true,
  reportDir: '',        // 自动 -> $DSH_TOKEN_STAT_DATA_DIR = <TEMP>/auto
  writeMd: true,
  writeJson: true,
  debounceMs: 50,
})

// 等待异步扫描与落盘
await new Promise((r) => setTimeout(r, 1200))

assert.ok(registered.some((t) => t.name === 'token_usage_stats'), '工具应注册')
assert.ok(observerseen.some((o) => o.event === 'session/event' && o.global), 'session/event 应带 global:true 监听')
assert.ok(observerseen.some((o) => o.event === 'session/created'), '应监听 session/created')
console.log(`ok: 工具注册 + 事件监听 (session/created, session/event global) `)

const reportDir = path.join(TEMP, 'auto')
const reportJson = path.join(reportDir, 'report.json')
const reportMd = path.join(reportDir, 'report.md')
assert.ok(fs.existsSync(reportJson), '应生成 report.json')
assert.ok(fs.existsSync(reportMd), '应生成 report.md')
const reportDoc = JSON.parse(fs.readFileSync(reportJson, 'utf8'))
const snap = reportDoc.snapshot
assert.equal(snap.totals.inputTokens, 111, '磁盘直扫应统计到会话用量(即使持久化服务 list 为空)')
assert.equal(snap.totals.outputTokens, 22)
assert.equal(snap.byModel[0].model, 'smoke-m')
assert.equal(snap.sessionCount, 1)
assert.equal(reportDoc.sources, TEMP, 'meta.sources 应为 DSH_HOME')
const archiveDoc = JSON.parse(fs.readFileSync(path.join(reportDir, 'archive.json'), 'utf8'))
assert.ok(archiveDoc.sessions[SID], '归档应记录磁盘会话')
console.log('ok: 磁盘直扫 + 归档 (持久化服务为空时仍全量统计, 归档含会话)')
console.log('  报告目录:', reportDir)

// 工具 execute 输出
const tool = registered.find((t) => t.name === 'token_usage_stats')
const text = await tool.execute({})
assert.ok(text.includes('smoke-m'), '工具输出应包含模型名')
console.log('ok: 工具 execute 返回报告文本')

// ---- 3.1) settings namespace 注册 ----
assert.equal(settingsRegistered.length, 1, '应恰好注册一个 settings namespace')
assert.equal(String(settingsRegistered[0].ns), 'token-stat')
const schema = settingsRegistered[0].schema
assert.equal(typeof schema, 'function', 'schema 应可调用(兼容 dsh-settings resolve)')
assert.equal(typeof schema.toJSON, 'function', 'schema 应提供 toJSON(供 describe)')
const resolved = schema({ enabled: false, reportDir: 'd:/x' })
assert.equal(resolved.enabled, false)
assert.equal(resolved.reportDir, 'd:/x')
assert.ok(typeof resolved.writeMd === 'boolean', '默认值应补齐')
assert.ok(schema['~standard']?.validate, 'schema 应提供 ~standard 校验')
console.log('ok: settings namespace 注册 (token-stat, schema 可调用/可描述)')

// ---- 3.2) webServer 桥 ----
const statsRoute = routes.find((r) => r.path === '/api/token-stat/stats')
const refreshRoute = routes.find((r) => r.path === '/api/token-stat/refresh')
assert.ok(statsRoute && typeof statsRoute.handler === 'function', '应注册 stats 路由')
assert.ok(refreshRoute && typeof refreshRoute.handler === 'function', '应注册 refresh 路由')

const loopbackReq = {
  socket: { remoteAddress: '127.0.0.1' },
  headers: { host: '127.0.0.1:1681' },
  method: 'GET',
}
let statsBody = null
const statsRes = {
  writeHead(status, headers) {
    statsBody = { status, headers }
  },
  end(payload) {
    statsBody.body = JSON.parse(payload)
  },
}
await statsRoute.handler(loopbackReq, statsRes)
assert.equal(statsBody.status, 200)
assert.equal(statsBody.body.ok, true)
assert.equal(statsBody.body.value.snapshot.totals.inputTokens, 111, '桥返回的汇总应与折叠一致')
assert.ok(statsBody.body.value.meta.reportDir, 'meta 应包含报告目录')
assert.equal(statsBody.headers['content-type'], 'application/json; charset=utf-8')
console.log('ok: /api/token-stat/stats 返回实时汇总 (总量正确, meta 含报告目录)')

// 非回环请求应被拒绝
let refused = null
const evilReq = {
  socket: { remoteAddress: '203.0.113.9' },
  headers: { host: 'example.com' },
  method: 'GET',
}
const evilRes = {
  writeHead(status) {
    refused = status
  },
  end() {},
}
await statsRoute.handler(evilReq, evilRes)
assert.equal(refused, 403, '非回环请求应 403')
console.log('ok: 桥仅接受回环请求 (非回环 403)')

// refresh 路由: GET 405 / POST 触发重建
let refreshStatus = null
const refreshRes = {
  writeHead(status) {
    refreshStatus = status
  },
  end() {},
}
await refreshRoute.handler({ ...loopbackReq, headers: { host: '127.0.0.1:1681' }, method: 'GET' }, refreshRes)
assert.equal(refreshStatus, 405, 'refresh 只允许 POST')
refreshStatus = null
await refreshRoute.handler({ ...loopbackReq, headers: { host: '127.0.0.1:1681' }, method: 'POST' }, refreshRes)
assert.equal(refreshStatus, 200, 'refresh POST 应 200')
await new Promise((r) => setTimeout(r, 400))
console.log('ok: /api/token-stat/refresh (GET 405 / POST 重建扫描)')

// 重建扫描 → 磁盘新事件必须计入归档账本(同一 id 覆盖更新,不重复计数)
{
  // 往磁盘会话文件追加一个 turn=2 的 assistant/message(input 33 / output 11)
  const file = path.join(sessionDir, 'session.jsonl.zstd')
  const raw = plugin.decodeSessionBuffer(path.basename(file), fs.readFileSync(file))
  const extra = {
    type: 'assistant/message',
    seq: 2,
    time: Date.now() - 10000,
    data: {
      turn: 2,
      step: 0,
      message: { role: 'assistant', content: [], source: { kind: 'model', provider: 'smoke-p', model: 'smoke-m' } },
      usage: { inputTokens: 33, outputTokens: 11 },
    },
  }
  fs.writeFileSync(file, zlib.zstdCompressSync(Buffer.from(raw + JSON.stringify(extra) + '\n', 'utf8')))

  let rs = null
  const rsRes = {
    writeHead(status) { rs = status },
    end() {},
  }
  await refreshRoute.handler({ ...loopbackReq, method: 'POST' }, rsRes)
  assert.equal(rs, 200)
  await new Promise((r) => setTimeout(r, 900))

  const snapR = JSON.parse(fs.readFileSync(reportJson, 'utf8')).snapshot
  assert.equal(snapR.totals.inputTokens, 144, '重建扫描应计入磁盘新事件 (111+33)')
  assert.equal(snapR.totals.outputTokens, 33, '重建扫描应计入磁盘新事件 (22+11)')
  assert.equal(snapR.sessionCount, 1)
  const arcR = JSON.parse(fs.readFileSync(path.join(reportDir, 'archive.json'), 'utf8'))
  assert.equal(arcR.sessions[SID].usageCalls, 2, '归档同一 id 应覆盖更新为 2 次请求(而非累计/重复)')
  assert.equal(arcR.sessions[SID].models[0][1].inputTokens, 144, '归档快照应含新事件')
  console.log('ok: 重建扫描写入归档 (同一 id 覆盖更新, 不重复计数; 手动点按钮后数据入库)')
}

// ---- 3.3) 数据保存目录修改(/config) ----
const configRoute = routes.find((r) => r.path === '/api/token-stat/config')
assert.ok(configRoute && typeof configRoute.handler === 'function', '应注册 config 路由')

// GET -> 405
let cfgStatus = null
const cfgRes = {
  writeHead(status) { cfgStatus = status },
  end() {},
}
await configRoute.handler({ ...loopbackReq, method: 'GET' }, cfgRes)
assert.equal(cfgStatus, 405, 'config 只允许 POST')

// 非法 body(非字符串 reportDir) -> 400
let badStatus = null
const badRes = {
  writeHead(status) { badStatus = status },
  end() {},
}
await configRoute.handler(
  { ...loopbackReq, method: 'POST', ...bodyReader(JSON.stringify({ reportDir: 123 })) },
  badRes,
)
assert.equal(badStatus, 400, '非字符串 reportDir 应 400')

// 设置新目录 -> 200 + 报告迁移到新目录
const MOVE = path.join(TEMP, 'moved')
let cfgBody = null
const cfgRes2 = {
  writeHead(status, headers) { cfgBody = { status, headers } },
  end(payload) { cfgBody.body = JSON.parse(payload) },
}
await configRoute.handler(
  { ...loopbackReq, method: 'POST', ...bodyReader(JSON.stringify({ reportDir: MOVE })) },
  cfgRes2,
)
assert.equal(cfgBody.status, 200)
assert.equal(cfgBody.body.ok, true)
assert.equal(cfgBody.body.value.configured, MOVE)
assert.equal(cfgBody.body.value.reportDir, MOVE)
assert.ok(settingsUpdates.some((u) => String(u.ns) === 'token-stat' && u.patch.reportDir === MOVE), '应调用 settings.update 写入用户层')
await new Promise((r) => setTimeout(r, 700))
assert.ok(fs.existsSync(path.join(MOVE, 'report.json')), '新目录应生成 report.json')
assert.ok(fs.existsSync(path.join(MOVE, 'report.md')), '新目录应生成 report.md')
assert.ok(fs.existsSync(path.join(MOVE, 'archive.json')), '归档应随目录迁移')
assert.ok(!fs.existsSync(path.join(reportDir, 'report.json')), '旧目录的 report.json 应被移走')
assert.ok(!fs.existsSync(path.join(reportDir, 'report.md')), '旧目录的 report.md 应被移走')
console.log('ok: /config 设置新目录 (200, 报告+归档迁移, 旧目录清空)')

// 恢复自动(空串) -> 回到插件默认数据目录(DSH_HOME 之外)
let cfgBody3 = null
const cfgRes3 = {
  writeHead(status, headers) { cfgBody3 = { status, headers } },
  end(payload) { cfgBody3.body = JSON.parse(payload) },
}
await configRoute.handler(
  { ...loopbackReq, method: 'POST', ...bodyReader(JSON.stringify({ reportDir: '' })) },
  cfgRes3,
)
assert.equal(cfgBody3.status, 200)
assert.equal(cfgBody3.body.ok, true)
const autoDir = plugin.pluginDataDir()
assert.equal(cfgBody3.body.value.reportDir, autoDir, '空串应回到插件默认数据目录')
await new Promise((r) => setTimeout(r, 700))
assert.ok(fs.existsSync(path.join(autoDir, 'report.json')), '默认数据目录应生成 report.json')
console.log('ok: /config 恢复自动 (空串 -> 默认数据目录:', autoDir, ')')

// stats 的 meta 应暴露已配置目录
let statsBody2 = null
const statsRes2 = {
  writeHead(status, headers) { statsBody2 = { status, headers } },
  end(payload) { statsBody2.body = JSON.parse(payload) },
}
await statsRoute.handler({ ...loopbackReq, method: 'GET' }, statsRes2)
assert.equal(statsBody2.body.value.meta.reportDir, autoDir, 'stats meta 应反映当前生效目录')
console.log('ok: stats meta 暴露 reportDirConfigured / 生效目录')

// ---- 4) 归档保留: 会话文件被删除后,重启仍计入(删掉的项目不丢数据) ----
fs.rmSync(path.join(TEMP, 'sessions'), { recursive: true, force: true }) // 模拟项目/会话被删除
{
  // 重新加载一次,验证 disposer 机制 + 归档兜底(真实 cordis 用 effect 管理)
  const ctx2 = { ...fakeCtx }
  applyAndWait(ctx2, { enabled: true, reportDir: '', writeMd: true, writeJson: true, debounceMs: 25 })
  await new Promise((r) => setTimeout(r, 700))
  const snap2 = JSON.parse(fs.readFileSync(reportJson, 'utf8')).snapshot
  assert.equal(snap2.totals.inputTokens, 144, '会话文件删除后,归档应保留其用量(重建扫描后的最新快照)')
  assert.equal(snap2.totals.outputTokens, 33)
  assert.equal(snap2.sessionCount, 1, '归档中的会话仍计入会话数')
  const archiveDoc2 = JSON.parse(fs.readFileSync(path.join(reportDir, 'archive.json'), 'utf8'))
  assert.ok(archiveDoc2.sessions[SID], '归档应仍含被删除会话')
  console.log('ok: 归档保留 (删除会话文件后重新加载仍计入, 总量不变; effect 计数', disposers, ')')
}

// ---- 5) 兜底: 无文件型会话存储时,走持久化服务 ----
const TEMP2 = fs.mkdtempSync(path.join(os.tmpdir(), 'token-stat-fallback-'))
{
  const savedHome = process.env.DSH_HOME
  process.env.DSH_HOME = TEMP2 // 没有 sessions 目录 -> 磁盘扫描 0 个文件 -> 服务兜底
  persistenceHeaders = [{ id: 'service-session' }]
  const ctx3 = { ...fakeCtx }
  applyAndWait(ctx3, { enabled: true, reportDir: '', writeMd: true, writeJson: true, debounceMs: 25 })
  await new Promise((r) => setTimeout(r, 500))
  const snap3 = JSON.parse(fs.readFileSync(reportJson, 'utf8')).snapshot
  assert.equal(snap3.totals.inputTokens, 255, '归档(SID 144) + 服务会话(111) = 255')
  assert.equal(snap3.totals.outputTokens, 55, '33 + 22 = 55')
  assert.equal(snap3.sessionCount, 2, '归档与会话服务数据应合并')
  process.env.DSH_HOME = savedHome
  console.log('ok: 持久化服务兜底 (无磁盘会话时走 sessionPersistence, 与归档合并)')
}

fs.rmSync(TEMP, { recursive: true, force: true })
fs.rmSync(TEMP2, { recursive: true, force: true })
fs.rmSync(plugin.pluginDataDir(), { recursive: true, force: true })
console.log('\n冒烟测试通过 ✓')

function applyAndWait(ctx, config) {
  plugin.apply(ctx, config)
}