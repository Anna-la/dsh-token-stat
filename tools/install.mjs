/**
 * tools/install.mjs — 把 token-stat 插件安装到本机活动 profile(默认 web)。
 *
 * 相比旧的 file:// 挂载方式,现在需要一个「包 + 客户端 bundle」:
 *  - client-modules 只会把「名字可解析为 package.json、且声明了 dsh.client」的
 *    loader 条目当作浏览器半面,file:// 条目的 name 是 URL,解析不到包。
 *  - 因此采用 junction 安装,pnpm/官方目录清理不会动(见 README 注意事项)。
 *
 * 步骤:
 *  1) 建立 profiles/<profile>/node_modules/token-stat -> <项目>/pkg 的 junction
 *     (Node 按真实路径解析,../../index.mjs 依然指向项目根,单一副本)。
 *  2) 更新 profiles/<profile>/cordis.patch.yml:把 token-stat 条目的
 *     name 从 file:// 绝对路径换成包名 'token-stat'。
 * 操作幂等,可重复执行。
 *
 * 用法: node tools/install.mjs [profileName]
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url)) // <项目>/tools
const project = path.dirname(here)                        // <项目>(= 包根)
const pkgDir = project
const profileName = process.argv[2] || 'web'

function dshHome() {
  const env = process.env.DSH_HOME
  if (env && env.trim().length > 0) return path.resolve(env.trim())
  return path.join(os.homedir(), '.dsh')
}

const profileDir = path.join(dshHome(), 'profiles', profileName)
const nmDir = path.join(profileDir, 'node_modules')
const linkPath = path.join(nmDir, 'token-stat')
const patchFile = path.join(profileDir, 'cordis.patch.yml')

function fail(message) {
  console.error(`[install] 失败: ${message}`)
  process.exit(1)
}

if (!fs.existsSync(path.join(pkgDir, 'package.json'))) fail(`找不到包目录 ${pkgDir}`)
if (!fs.existsSync(path.join(pkgDir, 'lib', 'index.js'))) fail(`缺少 ${pkgDir}\\lib\\index.js`)
if (!fs.existsSync(path.join(pkgDir, 'lib', 'client.js'))) fail(`缺少 ${pkgDir}\\lib\\client.js`)
if (!fs.existsSync(patchFile)) fail(`找不到 ${patchFile}(先确认 profile '${profileName}' 存在)`)

// ----- 步骤 1: junction -----
const pkgReal = fs.realpathSync(pkgDir)
if (fs.existsSync(linkPath) || fs.lstatSync(linkPath, { throwIfNoEntry: false })) {
  let real
  try {
    real = fs.realpathSync(linkPath)
  } catch {
    real = null
  }
  if (real === pkgReal) {
    console.log('[install] junction 已存在且指向正确:', linkPath)
  } else {
    console.log('[install] 移除旧链接(指向别处或已失效):', linkPath)
    fs.rmSync(linkPath, { recursive: true, force: true })
    fs.symlinkSync(pkgDir, linkPath, 'junction')
    console.log('[install] 已重建 junction ->', pkgDir)
  }
} else {
  fs.mkdirSync(nmDir, { recursive: true })
  fs.symlinkSync(pkgDir, linkPath, 'junction')
  console.log('[install] 已创建 junction:', linkPath, '->', pkgDir)
}

// ----- 步骤 2: 更新 cordis.patch.yml 的 token-stat 条目 -----
const raw = fs.readFileSync(patchFile, 'utf8')
const eol = raw.includes('\r\n') ? '\r\n' : '\n'
const lines = raw.split(/\r?\n/)
const NAME_PACKAGE = "name: 'token-stat'"
const ID_TOKEN = /^-\s*id:\s*['"]?token-stat['"]?\s*$/

// 找出所有 token-stat 条目(id 行,允许 '- ' 列表前缀),\n// 第一个保留并把它的 name 行换成包名;重复的条目整个删除(去重)。
const tokenBlocks = []
for (let i = 0; i < lines.length; i++) {
  if (ID_TOKEN.test(lines[i].trim())) tokenBlocks.push(i)
}
if (tokenBlocks.length > 0) {
  const first = tokenBlocks[0]
  let nameFound = false
  for (let j = first + 1; j < Math.min(first + 4, lines.length); j++) {
    const nameLine = lines[j].trim()
    if (/^name:\s*/.test(nameLine)) {
      if (nameLine !== NAME_PACKAGE) {
        const indent = lines[j].match(/^\s*/)[0]
        lines[j] = indent + NAME_PACKAGE
        console.log('[install] 替换 patch 条目 name ->', NAME_PACKAGE)
      } else {
        console.log('[install] patch 中 name 已是包名,无需修改')
      }
      nameFound = true
      break
    }
  }
  if (!nameFound) throw new Error('token-stat 条目缺少 name 行')
  // 去重: 删除后续重复的 token-stat 块(从 id 行到下一个非空/非缩进行?简单起见: 删掉该 id 行及其紧随的 1-2 行)
  for (let k = 1; k < tokenBlocks.length; k++) {
    const start = tokenBlocks[k]
    let end = start + 1
    while (end < lines.length && /^[ \t]/.test(lines[end]) && lines[end].trim() !== '') end++
    for (let d = start; d < end; d++) lines[d] = null
    console.log(`[install] 移除重复的 token-stat 条目 (行 ${start + 1}~${end})`)
  }
  if (tokenBlocks.length > 1) console.log('[install] 注意: 之前存在多个 token-stat 条目,已去重')
} else {
  // 没有找到既有 token-stat 条目,追加
  const block = [
    '# dsh-token-stat 插件(包名安装: 请先运行 node tools/install.mjs 建立 junction)',
    '- insert:',
    '    - id: token-stat',
    `      ${NAME_PACKAGE}`,
  ]
  const tail = raw.endsWith(eol) ? '' : eol
  fs.writeFileSync(patchFile, raw + tail + eol + block.join(eol) + eol, 'utf8')
  console.log('[install] 未找到既有条目,已在 cordis.patch.yml 末尾追加 token-stat insert')
}

// 回写(去掉被标记删除的行)
const next = lines.filter((line) => line !== null)
if (next.join(eol) !== raw) fs.writeFileSync(patchFile, next.join(eol), 'utf8')

// ----- 校验 -----
const req = createRequire(path.join(profileDir, '__token_stat_probe__.cjs'))
const probe = (label, spec) => {
  try {
    const resolved = req.resolve(spec)
    console.log(`[install] 校验通过: ${label} -> ${resolved}`)
    return resolved
  } catch (error) {
    fail(`解析 ${label} 失败: ${error.message}`)
  }
}
probe('token-stat(包入口)', 'token-stat')
const pkgJson = probe('token-stat/package.json', 'token-stat/package.json')
const manifest = JSON.parse(fs.readFileSync(pkgJson, 'utf8'))
if (manifest.dsh?.client?.platform !== 'web') fail('package.json 未声明 dsh.client.platform=web,客户端 bundle 不会被加载')
if (!(manifest.exports?.['./client'] || '').endsWith('client.js')) fail('package.json 的 exports["./client"] 必须指向 client bundle')

console.log('[install] 完成。重启应用(或触发 HMR)后:')
console.log('  - 服务端插件由包名 token-stat 加载(等效于旧 file:// 方式)')
console.log('  - 「设置 → 插件 → 可配置」出现「Token 用量统计」卡片')
console.log('  - 报告默认写入', pluginDefaultDataDir(), '(DSH_HOME 之外;可用 $DSH_TOKEN_STAT_DATA_DIR 或设置页卡片更改)')

/** 与插件 pluginDataDir() 相同的默认目录推导(仅用于提示)。 */
function pluginDefaultDataDir() {
  const env = process.env.DSH_TOKEN_STAT_DATA_DIR
  if (env && env.trim().length > 0) return path.resolve(env.trim())
  return path.join(os.homedir(), '.dsh-token-stat')
}