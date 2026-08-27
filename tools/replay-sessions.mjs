/**
 * 离线回放验证 + 正式统计: 用与插件完全相同的折叠逻辑(foldEvents),
 * 回放 DSH_HOME/sessions 下全部真实会话日志,输出:
 *   1) 累计 token 总量与按模型/按日期明细(即插件将展示的同一份数据)
 *   2) 数据质量诊断(usage 缺失率、模型归属缺失率)
 *   3) preview-report.md / preview-report.json 预览报告
 *
 * 用法:
 *   node tools/replay-sessions.mjs [--out <dir>] [--no-write]
 */

import * as path from 'node:path'
import * as os from 'node:os'
import { foldEvents, buildSnapshot, renderMarkdown, renderJson, walkSessionFiles, parseSessionFile } from '../index.mjs'

const args = process.argv.slice(2)
const writeOut = !args.includes('--no-write')
const outArgIdx = args.indexOf('--out')
const outDir = outArgIdx >= 0 && args[outArgIdx + 1]
  ? path.resolve(args[outArgIdx + 1])
  : path.resolve(process.cwd())

const dshHome = (process.env.DSH_HOME && process.env.DSH_HOME.trim()) || path.join(os.homedir(), '.dsh')
const sessionsRoot = path.join(dshHome, 'sessions')

console.log(`DSH_HOME = ${dshHome}`)
console.log(`会话根目录 = ${sessionsRoot}`)

const files = walkSessionFiles(sessionsRoot)
console.log(`发现会话日志 ${files.length} 个\n`)

const folds = []
const diag = {
  sessions: 0,
  events: 0,
  assistantMessages: 0,
  withUsage: 0,
  withoutUsage: 0,
  withoutSourceModel: 0,
  filesFailed: [],
}

for (const file of files) {
  let events = []
  try {
    events = await parseSessionFile(file)
    diag.events += events.length
    for (const e of events) {
      if (e.type !== 'assistant/message') continue
      diag.assistantMessages += 1
      const data = e.data || {}
      if (data.usage && typeof data.usage === 'object') diag.withUsage += 1
      else diag.withoutUsage += 1
      const source = data.message?.source
      const hasModel = typeof source?.model === 'string' && source.model.length > 0
      if (!hasModel) diag.withoutSourceModel += 1
    }
    folds.push(foldEvents(events))
    diag.sessions += 1
  } catch (error) {
    diag.filesFailed.push({ file, error: String(error) })
    console.warn(`  [失败] ${file}: ${error.message}`)
  }
}

const snapshot = buildSnapshot(folds.values())
const meta = { scannedAt: Date.now(), sources: dshHome }

console.log('='.repeat(64))
console.log(renderMarkdown(snapshot, meta))
console.log('='.repeat(64))

console.log('\n---- 数据质量诊断 ----')
console.log(`会话数: ${diag.sessions} / 日志文件 ${files.length}`)
console.log(`事件总数: ${diag.events}`)
console.log(`assistant/message: ${diag.assistantMessages} 条`)
console.log(`  带 usage: ${diag.withUsage}(占比 ${(diag.withUsage * 100 / Math.max(1, diag.assistantMessages)).toFixed(1)}%)`)
console.log(`  无 usage: ${diag.withoutUsage}`)
console.log(`  无 source.model(会回落为路由/unknown): ${diag.withoutSourceModel}`)
if (diag.filesFailed.length > 0) console.log(`读取失败: ${diag.filesFailed.length} 个`, diag.filesFailed)

if (writeOut) {
  const md = path.join(outDir, 'preview-report.md')
  const json = path.join(outDir, 'preview-report.json')
  fs.writeFileSync(md, renderMarkdown(snapshot, { ...meta, reportPath: md }), 'utf8')
  fs.writeFileSync(json, renderJson(snapshot, { ...meta, reportPath: json }), 'utf8')
  console.log(`\n预览报告已写入: ${md}\n                  ${json}`)
}