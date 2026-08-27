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
// 默认数据目录重定向到 TEMP 内,避免测试触碰真实的 ~/.dsh-token-stat
process.env.DSH_TOKEN_STAT_DATA_DIR = path.join(TEMP, 'auto')
const registered = []
const observerseen = []
const settingsRegistered = []
const settingsUpdates = []
const settingsStores = new Map()    // ns -> 用户层合并后的解析值
const settingsWatchers = new Map()  // ns -> Set<cb>
const routes = []
let disposers = 0

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
        list: async () => [{ id: 'smoke-session' }],
        readFrom: async () => ({
          events: [
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
          ],
        }),
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
  reportDir: TEMP,
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

const reportJson = path.join(TEMP, 'report.json')
const reportMd = path.join(TEMP, 'report.md')
assert.ok(fs.existsSync(reportJson), '应生成 report.json')
assert.ok(fs.existsSync(reportMd), '应生成 report.md')
const snap = JSON.parse(fs.readFileSync(reportJson, 'utf8')).snapshot
assert.equal(snap.totals.inputTokens, 111)
assert.equal(snap.totals.outputTokens, 22)
assert.equal(snap.byModel[0].model, 'smoke-m')
console.log('ok: 报告落盘 + 冒烟数据折叠正确')
console.log('  报告目录:', TEMP)

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
assert.ok(!fs.existsSync(path.join(TEMP, 'report.json')), '旧目录的 report.json 应被移走')
assert.ok(!fs.existsSync(path.join(TEMP, 'report.md')), '旧目录的 report.md 应被移走')
console.log('ok: /config 设置新目录 (200, 报告迁移, 旧目录清空)')

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

// ---- 4) 卸载清理 ----
{
  // 重新加载一次,验证 disposer 机制(真实 cordis 用 effect 管理)
  const ctx2 = { ...fakeCtx }
  applyAndWait(ctx2, { enabled: true, reportDir: TEMP, debounceMs: 25 })
  await new Promise((r) => setTimeout(r, 300))
  console.log('ok: 二次加载无副作用 (effect 计数', disposers, ')')
}

fs.rmSync(TEMP, { recursive: true, force: true })
fs.rmSync(plugin.pluginDataDir(), { recursive: true, force: true })
console.log('\n冒烟测试通过 ✓')

function applyAndWait(ctx, config) {
  plugin.apply(ctx, config)
}