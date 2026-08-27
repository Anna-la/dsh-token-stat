/**
 * token-stat — 包的服务端入口(薄壳)。
 *
 * 实际实现位于仓库根 index.mjs(零依赖)。本文件只用相对导入把它再导出去:
 *  - 安装在 profile 里时,包名 token-stat 解析到本文件(真实路径在安装目录),
 *    相对导入 ../index.mjs 恒等于同一目录下的核心实现 —— 单一副本。
 *  - 若以 junction 方式装载(开发模式),Node 按真实路径解析,同样指向仓库根。
 *  - 默认数据目录不再由模块位置决定(见 index.mjs 的 pluginDataDir:
 *    优先 $DSH_TOKEN_STAT_DATA_DIR,否则 ~/.dsh-token-stat,均在 DSH_HOME 之外)。
 */
export { name, Config, apply, pluginDataDir } from "../index.mjs";