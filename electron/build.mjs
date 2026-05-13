/* esbuild 构建脚本 — electron 主进程 + preload
 *
 * main.ts:  ESM → dist-electron/main.mjs(electron@28+ 支持 ESM main)
 * preload.ts: CJS → dist-electron/preload.cjs(preload 必须 CJS,sandbox=false 也只能 CJS 用 require)
 *
 * 用法:
 *   node electron/build.mjs           # 一次性构建
 *   node electron/build.mjs --watch   # 持续监听
 */

import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { copyFileSync, mkdirSync, watch as fsWatch } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'dist-electron');

const watch = process.argv.includes('--watch');

// 拷贝静态资源到 dist-electron/ — bundled main.mjs 的 __dirname 就在这里
const MD_ASSETS = [
  ['server/skill.md', 'skill.md'],
  ['server/skill-core.md', 'skill-core.md'],
  ['public/__aid_inject.js', '__aid_inject.js'],
];
function copyAssets() {
  mkdirSync(outDir, { recursive: true });
  for (const [src, dest] of MD_ASSETS) {
    copyFileSync(path.join(rootDir, src), path.join(outDir, dest));
  }
  console.log('[electron-build] assets copied');
}
copyAssets();
if (watch) {
  for (const [src] of MD_ASSETS) {
    fsWatch(path.join(rootDir, src), () => copyAssets());
  }
}

/** electron + node 内置模块 + 含 native binding 的 npm 包都 external,避免 bundle 进去 */
const NODE_EXTERNAL = [
  'electron',
  // node:* protocol 自动 external,但兜底列举常用
  'fs', 'path', 'crypto', 'os', 'url', 'http', 'https', 'stream', 'events',
  'child_process', 'net', 'tls', 'zlib', 'buffer', 'util', 'querystring',
  // 含 .node native binding 的依赖 — esbuild 不会处理
  'fsevents', // chokidar 在 macOS 用
];

/** Hono / @hono/node-server / Anthropic SDK / OpenAI SDK 我们 bundle 进去
 *  (不 external = 自包含,prod 打包时不用拖整个 node_modules) */
const SHARED = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  external: NODE_EXTERNAL,
  logLevel: 'info',
  sourcemap: 'inline',
};

const mainCtx = await esbuild.context({
  ...SHARED,
  entryPoints: [path.join(rootDir, 'electron/main.ts')],
  outfile: path.join(outDir, 'main.mjs'),
  format: 'esm',
  // ESM 输出里 import.meta.url 自动有效
  banner: {
    // ESM 里 CommonJS 兼容:某些依赖可能要 createRequire
    js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
  },
});

const preloadCtx = await esbuild.context({
  ...SHARED,
  entryPoints: [path.join(rootDir, 'electron/preload.ts')],
  outfile: path.join(outDir, 'preload.cjs'),
  format: 'cjs',
});

if (watch) {
  await Promise.all([mainCtx.watch(), preloadCtx.watch()]);
  console.log('[electron-build] watching main.ts + preload.ts ...');
} else {
  await mainCtx.rebuild();
  await preloadCtx.rebuild();
  await mainCtx.dispose();
  await preloadCtx.dispose();
  console.log('[electron-build] done');
}
