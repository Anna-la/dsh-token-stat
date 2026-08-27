/**
 * 折叠逻辑单元测试(合成事件,验证边界语义):
 *   1. 基础累加 + 按模型、按日期归集
 *   2. 同 (turn, step) 重试只取最后一次采样,不重复计数
 *   3. 无 usage 的消息只计条数不计 token
 *   4. request/context 路由兜底(消息缺少 source 时)
 *   5. request/header 兜底
 *   6. 多会话汇总(buildSnapshot)
 *
 * 用法: node tools/test-fold.mjs
 */

import assert from 'node:assert/strict'
import { foldEvents, applyEventToFold, createFold, buildSnapshot, dayKey } from '../index.mjs'

const ev = (type, data, time, seq = 0) => ({ type, seq, time, data })

function am(turn, step, model, provider, usage, time) {
  const data = { turn, step }
  if (model !== undefined) {
    data.message = {
      role: 'assistant',
      content: [{ type: 'text', text: 'x' }],
      source: { kind: 'model', provider, model },
    }
  }
  if (usage !== undefined) data.usage = usage
  return ev('assistant/message', data, time)
}

const t0 = Date.parse('2026-08-25T00:00:00+08:00')

// ---- 1. 基础累加 ----
{
  const fold = foldEvents([
    am(1, 0, 'm1', 'p1', { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheWriteTokens: 5 }, t0),
    am(1, 1, 'm1', 'p1', { inputTokens: 200, outputTokens: 100 }, t0 + 1000),
  ])
  assert.equal(fold.usageCalls, 2)
  assert.equal(fold.messageCount, 2)
  const snap = buildSnapshot([fold])
  assert.equal(snap.totals.inputTokens, 300)
  assert.equal(snap.totals.outputTokens, 150)
  assert.equal(snap.totals.cacheReadTokens, 10)
  assert.equal(snap.totals.cacheWriteTokens, 5)
  assert.equal(snap.totals.totalTokens, 465)
  assert.equal(snap.byModel.length, 1)
  assert.equal(snap.byModel[0].model, 'm1')
  assert.equal(snap.byModel[0].requests, 2)
  assert.equal(snap.byDay[0].date, dayKey(t0))
  console.log('ok 1: 基础累加')
}

// ---- 2. 同 (turn, step) 重试替换 ----
{
  const fold = foldEvents([
    am(1, 2, 'm1', 'p1', { inputTokens: 100, outputTokens: 50 }, t0),
    am(1, 2, 'm1', 'p1', { inputTokens: 120, outputTokens: 60 }, t0 + 500), // 同一步重试
  ])
  assert.equal(fold.usageCalls, 1, '重试不增加请求数')
  assert.equal(fold.messageCount, 2)
  const snap = buildSnapshot([fold])
  assert.equal(snap.totals.inputTokens, 120, '只计最后一次采样')
  assert.equal(snap.totals.outputTokens, 60)
  assert.equal(snap.byModel[0].requests, 1)
  console.log('ok 2: 同 (turn, step) 替换语义')
}

// ---- 3. 无 usage ----
{
  const fold = foldEvents([
    am(1, 3, 'm1', 'p1', undefined, t0),
    am(1, 4, 'm2', 'p1', { inputTokens: 10 }, t0 + 1000),
  ])
  assert.equal(fold.messageCount, 2)
  assert.equal(fold.usageCount, 1)
  const snap = buildSnapshot([fold])
  assert.equal(snap.totals.inputTokens, 10)
  console.log('ok 3: 无 usage 消息只计条数')
}

// ---- 4. request/context 兜底 ----
{
  const fold = foldEvents([
    ev('request/context', { provider: 'rp', model: 'rm' }, t0),
    am(1, 5, undefined, undefined, { inputTokens: 42 }, t0 + 10), // 无 source
  ])
  const snap = buildSnapshot([fold])
  assert.equal(snap.byModel[0].provider, 'rp')
  assert.equal(snap.byModel[0].model, 'rm')
  console.log('ok 4: request/context 路由兜底')
}

// ---- 5. request/header 兜底(无 request/context 的老日志) ----
{
  const fold = foldEvents([
    ev('request/header', { header: { config: { provider: 'hp', model: 'hm' } } }, t0),
    am(1, 6, undefined, undefined, { inputTokens: 7 }, t0 + 10),
  ])
  const snap = buildSnapshot([fold])
  assert.equal(snap.byModel[0].model, 'hm')
  console.log('ok 5: request/header 兜底')
}

// ---- 6. 完全无路由信息 -> unknown ----
{
  const fold = foldEvents([am(1, 7, undefined, undefined, { inputTokens: 3 }, t0)])
  const snap = buildSnapshot([fold])
  assert.equal(snap.byModel[0].model, 'unknown')
  console.log('ok 6: 无路由回落 unknown')
}

// ---- 7. 多会话汇总 ----
{
  const s1 = foldEvents([am(1, 0, 'm1', 'p1', { inputTokens: 10 }, t0)])
  const s2 = foldEvents([
    am(1, 0, 'm1', 'p1', { inputTokens: 20 }, t0 + 1000),
    am(2, 0, 'm2', 'p2', { outputTokens: 5 }, t0 + 2000),
  ])
  const snap = buildSnapshot([s1, s2])
  assert.equal(snap.sessionCount, 2)
  assert.equal(snap.totals.inputTokens, 30)
  assert.equal(snap.totals.outputTokens, 5)
  assert.equal(snap.byModel.length, 2)
  assert.equal(snap.byModel[0].model, 'm1') // 按总量降序
  assert.equal(snap.byModel[1].model, 'm2')
  console.log('ok 7: 多会话汇总')
}

// ---- 8. 实时增量与全量回放一致 ----
{
  const events = [
    ev('request/context', { provider: 'p', model: 'm' }, t0),
    am(1, 0, 'm', 'p', { inputTokens: 10, outputTokens: 1 }, t0),
    am(1, 1, 'm', 'p', { inputTokens: 90, outputTokens: 9 }, t0 + 100),
  ]
  const full = foldEvents(events)
  const incr = createFold()
  for (const e of events) applyEventToFold(incr, e)
  assert.deepEqual(incr.models, full.models)
  assert.deepEqual(incr.days, full.days)
  assert.equal(incr.usageCalls, full.usageCalls)
  console.log('ok 8: 增量应用 == 全量回放')
}

console.log('\n全部 8 组测试通过 ✓')