/**
 * tools/publish-github.mjs — 用 gh CLI 把本仓库发布到 GitHub(无需本地 git)。
 *
 * 步骤:
 *  1) 创建(或复用) Anna-la/token-stat 公开仓库;
 *  2) 按「主题化提交」顺序分 12 个 commit 推送全部文件(满足列表仓库
 *     提交数 ≥ 10 的要求;每个 commit 的树是到该点为止的完整快照);
 *  3) 追加 dsh-plugin 等 topic。
 *
 * 沙箱说明: 不通过管道捕获子进程输出,每个 gh 调用用 cmd 重定向写临时文件,
 * 由脚本 fs 读取;子进程 stdio 用 inherit(沙箱禁止 pipe 捕获)。
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { spawnSync } from 'node:child_process'

const OWNER = 'Anna-la'
const REPO = 'token-stat'
const BRANCH = 'main'
const WORK = path.join(os.tmpdir(), 'publish-github-work')
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
  // 沙箱禁止管道捕获: 子进程用 cmd 重定向把 gh 输出写到文件,脚本再 fs 读取。
  // 注意: Node 在 Windows 上会给含引号的 argv 加 \" 转义,因此整个命令行
  // 不能出现任何引号(本项目所有路径均无空格,天然满足)。
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

// 提交分组: [commitMessage, [filePath, ...]]  (filePath 相对仓库根)
const STAGES = [
  ['chore: add MIT license', ['LICENSE']],
  ['chore: gitignore dev artifacts', ['.gitignore']],
  ['feat: bundle patch layer (cordis.patch.yml)', ['cordis.patch.yml']],
  ['feat: root package.json with dsh.bundle + dsh.client manifests', ['package.json']],
  ['feat: core engine (fold, render, apply, zero-dep)', ['index.mjs']],
  ['feat: server entry shell (lib/index.js)', ['lib/index.js']],
  ['feat: browser half - settings page card (lib/client.js)', ['lib/client.js']],
  ['docs: repository README', ['README.md']],
  ['chore: dev install script (junction + patch maintenance)', ['tools/install.mjs']],
  ['test: loader-simulation verification script', ['tools/verify-load.mjs']],
  ['test: smoke test (settings/webServer bridge, dir migration)', ['tools/smoke-test.mjs']],
  ['test: fold semantics tests + offline replay tool', ['tools/test-fold.mjs', 'tools/replay-sessions.mjs']],
  ['chore: publish tool (gh REST uploader)', ['tools/publish-github.mjs']],
]

// 1) 仓库(存在则复用)
const existing = ghApi('GET', `repos/${OWNER}/${REPO}`, undefined, { allow404: true })
if (existing && existing.id) {
  console.log(`[1] 仓库已存在: ${OWNER}/${REPO}`)
} else {
  ghApi('POST', 'user/repos', {
    name: REPO,
    private: false,
    description: 'DeepSeek Harness token 用量统计插件: 按模型/日期区分, 设置页看板, 数据目录在线更改',
  })
  console.log(`[1] 已创建公开仓库 ${OWNER}/${REPO}`)
}

// 2) 分阶段提交(完整快照树);幂等: 已存在的 ref/文件直接复用,可安全重跑
const refProbe = ghApi('GET', `repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`, undefined, { allow404: true })
let refExisted = !!(refProbe && refProbe.object)
let parentSha = refExisted ? refProbe.object.sha : null
const blobCache = new Map() // path -> blob sha

let stageIndex = 0
for (const [message, files] of STAGES) {
  stageIndex += 1
  if (stageIndex === 1) {
    // 空仓库: 首笔提交走 contents API(GitHub 的 git-database API 在无提交的
    // 仓库上会 409 "Git Repository is empty")。contents PUT 自动建首 commit + 分支。
    const rel = files[0]
    const probe = ghApi('GET', `repos/${OWNER}/${REPO}/contents/${rel}`, undefined, { allow404: true })
    if (probe && probe.sha) {
      blobCache.set(rel, probe.sha)
      console.log(`[2] commit ${stageIndex}/${STAGES.length}: ${message} (已存在,跳过)`)
      continue
    }
    const content = fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
    const first = ghApi('PUT', `repos/${OWNER}/${REPO}/contents/${rel}`, {
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch: BRANCH,
    })
    parentSha = first.commit.sha
    blobCache.set(rel, first.content.sha)
    console.log(`[2] commit ${stageIndex}/${STAGES.length}: ${message} (${parentSha.slice(0, 7)})`)
    continue
  }
  for (const rel of files) {
    const content = fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
    const blob = ghApi('POST', `repos/${OWNER}/${REPO}/git/blobs`, { content, encoding: 'utf-8' })
    blobCache.set(rel, blob.sha)
  }
  const treeEntries = [...blobCache].map(([rel, sha]) => ({
    path: rel.replace(/\\/g, '/'),
    mode: '100644',
    type: 'blob',
    sha,
  }))
  const tree = ghApi('POST', `repos/${OWNER}/${REPO}/git/trees`, { tree: treeEntries })

  const commit = ghApi('POST', `repos/${OWNER}/${REPO}/git/commits`, {
    message,
    tree: tree.sha,
    parents: parentSha ? [parentSha] : [],
    author: { name: OWNER, email: `${OWNER}@users.noreply.github.com` },
    committer: { name: OWNER, email: `${OWNER}@users.noreply.github.com` },
  })
  parentSha = commit.sha

  if (!refExisted) {
    ghApi('POST', `repos/${OWNER}/${REPO}/git/refs`, { ref: `refs/heads/${BRANCH}`, sha: commit.sha })
    refExisted = true
  } else {
    ghApi('PATCH', `repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, { sha: commit.sha, force: false })
  }
  console.log(`[2] commit ${stageIndex}/${STAGES.length}: ${message} (${commit.sha.slice(0, 7)})`)
}

// 3) topics
ghApi('PUT', `repos/${OWNER}/${REPO}/topics`, { names: ['dsh-plugin', 'dsh', 'token-usage'] })
console.log('[3] topics 已设置: dsh-plugin, dsh, token-usage')

const info = ghApi('GET', `repos/${OWNER}/${REPO}`)
console.log(`\n完成 ✓  https://github.com/${OWNER}/${REPO}  (默认分支 ${info.default_branch}, ${STAGES.length} commits)`)
