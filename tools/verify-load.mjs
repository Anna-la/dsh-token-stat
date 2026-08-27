/**
 * tools/verify-load.mjs — 模拟 loader 实际解析链路加载插件:
 *   1) createRequire(<profile 目录>).resolve('token-stat')   (与 cordis-plugin-loader 一致)
 *   2) import(fileURL)                                        (包入口 lib/index.js → ../../index.mjs)
 * 并检查浏览器半面元数据(client-modules 所需)。
 * 用法: node tools/verify-load.mjs [profileName]
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const profileName = process.argv[2] || 'web'
const home = process.env.DSH_HOME && process.env.DSH_HOME.trim()
  ? path.resolve(process.env.DSH_HOME.trim())
  : path.join(os.homedir(), '.dsh')
const profileDir = path.join(home, 'profiles', profileName)

const req = createRequire(new URL('package.json', pathToFileURL(profileDir + path.sep)).href)

// 1) 包入口解析
const entry = req.resolve('token-stat')
console.log('1) 包入口解析:', entry)

// 2) 以 loader 的方式 import
const mod = await import(pathToFileURL(entry).href)
console.log('2) 模块导出: name =', mod.name)
console.log('   apply =', typeof mod.apply, ', Config =', typeof mod.Config, ', pluginDataDir =', typeof mod.pluginDataDir)
if (mod.name !== 'token-stat' || typeof mod.apply !== 'function') throw new Error('模块导出不完整')
if (typeof mod.Config?.['~standard']?.validate !== 'function') throw new Error('Config 非 Standard Schema')
const cfg = mod.Config['~standard'].validate({})
if (cfg.issues) throw new Error('Config 默认值校验失败: ' + JSON.stringify(cfg.issues))
console.log('   Config 默认值校验通过')

// 3) 默认数据目录(隔离检查)
const dataDir = mod.pluginDataDir()
console.log('3) 默认数据目录:', dataDir)
if (dataDir.toLowerCase().includes(home.toLowerCase())) throw new Error(`数据目录不应落在 DSH_HOME 内: ${dataDir}`)
console.log('   隔离 ✓ (不在 DSH_HOME 下:', home, ')')

// 4) client-modules 需要的元数据
const pkgPath = req.resolve('token-stat/package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
console.log('4) package.json:', pkgPath)
if (pkg.dsh?.client?.platform !== 'web') throw new Error('dsh.client.platform 必须为 web')
if (typeof pkg.exports?.['./client'] !== 'string') throw new Error('exports["./client"] 缺失')
const clientFile = path.join(path.dirname(pkgPath), pkg.exports['./client'])
if (!fs.existsSync(clientFile)) throw new Error(`客户端 bundle 不存在: ${clientFile}`)
const clientSrc = fs.readFileSync(clientFile, 'utf8')
if (!clientSrc.includes('window.__ModuleLoader__.load')) throw new Error('客户端 bundle 缺少 __ModuleLoader__.load')
console.log('   客户端 bundle:', clientFile, `(${clientSrc.length} B, 含 __ModuleLoader__.load)`)

console.log('\n验证通过 ✓ —— 服务端与浏览器半面均可被 DSH 加载')