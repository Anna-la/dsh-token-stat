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

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import * as zlib from 'node:zlib'
import { foldEvents, buildSnapshot, renderMarkdown, renderJson } from '../index.mjs'

const ZSTD_MAGIC = 0xfd2fb528

function scanZstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`invalid frame magic at byte ${offset}`)
    }
    offset += 4
    if (offset === buffer.length) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 24) !== 0) throw new Error('reserved frame-header bit')
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start }
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) throw new Error('reserved block type')
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start }
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return { frames, tornStart: undefined }
}

function decodeFile(file) {
  const raw = fs.readFileSync(file)
  if (file.endsWith('.zstd')) {
    const { frames, tornStart } = scanZstdFrames(raw)
    if (tornStart !== undefined) console.warn(`  [warn] 不完整尾帧已忽略: ${file}`)
    const parts = frames.map(({ start, end }) => zlib.zstdDecompressSync(raw.subarray(start, end)))
    return Buffer.concat(parts, parts.reduce((n, p) => n + p.length, 0))
  }
  return raw
}

function walkSessionFiles(root) {
  const out = []
  if (!fs.existsSync(root)) return out
  for (const project of fs.readdirSync(root, { withFileTypes: true })) {
    if (!project.isDirectory()) continue
    const sessionRoot = path.join(root, project.name)
    for (const sessionDir of fs.readdirSync(sessionRoot, { withFileTypes: true })) {
      if (!sessionDir.isDirectory()) continue
      for (const name of fs.readdirSync(path.join(sessionRoot, sessionDir.name))) {
        if (name.startsWith('session') && (name.endsWith('.zstd') || name.endsWith('.jsonl'))) {
          out.push(path.join(sessionRoot, sessionDir.name, name))
        }
      }
    }
  }
  return out
}

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
    const buf = decodeFile(file)
    const lines = buf.toString('utf8').split(/\r?\n/).filter((l) => l.trim().length > 0)
    for (const line of lines) {
      const parsed = JSON.parse(line)
      if (parsed && parsed.type === 'session') continue // 头行
      events.push(parsed)
    }
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