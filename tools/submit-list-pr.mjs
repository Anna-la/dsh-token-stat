/**
 * tools/submit-list-pr.mjs — 向 awesome-dsh-plugin 列表仓库提交本插件条目。
 *
 * 步骤(全部走 gh REST,无需本地 git):
 *  1) fork awesome-dsh-plugin(已存在则复用);
 *  2) 在 fork 上建分支 add-token-stat(基于其 main HEAD);
 *  3) 用 contents API 推送 3 个文件: data/plugins/Anna-la__token-stat.yml、
 *     README.md、README.zh.md(后两者由生成器重新生成);
 *  4) 打开 PR 到 awesome-dsh-plugin/awesome-dsh-plugin。
 *
 * 用法: node tools/submit-list-pr.mjs <列表仓库解压目录>
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { spawnSync } from 'node:child_process'

const UPSTREAM = 'awesome-dsh-plugin/awesome-dsh-plugin'
const OWNER = 'Anna-la'
const FORK = `${OWNER}/awesome-dsh-plugin`
const BRANCH = 'add-token-stat'
const WORK = path.join(os.tmpdir(), 'submit-list-pr-work')
fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })

function ghApi(method, endpoint, body, { allow404 = false } = {}) {
  const outFile = path.join(WORK, 'gh-out.json')
  const errFile = path.join(WORK, 'gh-err.txt')
  const args = ['gh', 'api', '-X', method]
  if (body !== undefined) {
    const bodyFile = path.join(WORK, 'body.json')
    fs.writeFileSync(bodyFile, JSON.stringify(body))
    args.push('--input', bodyFile)
  }
  args.push(endpoint)
  const cmd = `${args.join(' ')} > ${outFile} 2> ${errFile}`
  const res = spawnSync(process.env.ComSpec, ['/d', '/c', cmd], { stdio: 'inherit' })
  if (res.status !== 0) {
    const err = fs.existsSync(errFile) ? fs.readFileSync(errFile, 'utf8').trim() : `exit ${res.status}`
    if (allow404 && err.includes('404')) return null
    throw new Error(`gh api ${method} ${endpoint} 失败: ${err}`)
  }
  const raw = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : ''
  if (!raw.trim() || raw.trim() === 'null') return null
  try {
    return JSON.parse(raw)
  } catch {
    return raw.trim()
  }
}

const listDir = process.argv[2]
if (!listDir || !fs.existsSync(path.join(listDir, 'data', 'plugins'))) {
  throw new Error('用法: node tools/submit-list-pr.mjs <列表仓库解压目录>')
}

// 1) fork
let fork = ghApi('GET', `repos/${FORK}`, undefined, { allow404: true })
if (!fork) {
  fork = ghApi('POST', `repos/${UPSTREAM}/forks`)
  console.log(`[1] fork 已创建: ${FORK}`)
} else {
  console.log(`[1] fork 已存在: ${FORK}`)
}

// 2) 分支(基于 fork main HEAD)
const forkHead = ghApi('GET', `repos/${FORK}/git/ref/heads/main`)
const baseSha = forkHead.object.sha
let branch = ghApi('GET', `repos/${FORK}/git/ref/heads/${BRANCH}`, undefined, { allow404: true })
if (!branch) {
  ghApi('POST', `repos/${FORK}/git/refs`, { ref: `refs/heads/${BRANCH}`, sha: baseSha })
  console.log(`[2] 分支 ${BRANCH} 已创建 (基于 ${baseSha.slice(0, 7)})`)
} else {
  console.log(`[2] 分支 ${BRANCH} 已存在 (${branch.object.sha.slice(0, 7)})`)
}

// 3) 推送文件(contents API;文件已存在则带 sha 走更新)
const FILES = [
  'data/plugins/Anna-la__token-stat.yml',
  'README.md',
  'README.zh.md',
]
for (const rel of FILES) {
  const src = path.join(listDir, rel)
  const content = fs.readFileSync(src, 'utf8')
  const body = {
    message: rel.startsWith('data/plugins') ? 'add Anna-la/token-stat entry' : `regenerate README (${rel})`,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch: BRANCH,
  }
  const existing = ghApi('GET', `repos/${FORK}/contents/${rel}?ref=${BRANCH}`, undefined, { allow404: true })
  if (existing && existing.sha) body.sha = existing.sha
  const put = ghApi('PUT', `repos/${FORK}/contents/${rel}`, body)
  console.log(`[3] ${rel} -> ${put.commit.sha.slice(0, 7)}`)
}

// 4) PR
const prBody = [
  'Add [Anna-la/token-stat](https://github.com/Anna-la/token-stat) under **usage**.',
  '',
  'Cumulative token usage statistics for DeepSeek Harness: per-model and per-day breakdowns, a settings-page dashboard (设置 → 插件 → 可配置), an online-changeable data directory that migrates existing report files and lives outside `DSH_HOME`, a model-callable `token_usage_stats` tool, and zero runtime dependencies — installable with `dsh plugin add` straight from the repository (root `package.json` declares `dsh.bundle` + `dsh.client`).',
  '',
  'Note: `dsh-token-stats` already exists in the same category; this entry differs by its settings-page dashboard, tool-based querying, and the isolated/online-changeable data directory.',
].join('\n')

const pr = ghApi('POST', `repos/${UPSTREAM}/pulls`, {
  title: 'Add Anna-la/token-stat (usage)',
  head: `${OWNER}:${BRANCH}`,
  base: 'main',
  body: prBody,
})
console.log(`\nPR 已创建: ${pr.html_url} (#${pr.number})`)
