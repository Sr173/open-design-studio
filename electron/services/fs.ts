/* fs 服务 — 文件 CRUD + 路径越权防护
 *
 * 关键模型(v6.0g):
 *   - rootPath = 用户选的真实项目文件夹(可能是 git 仓库,可能有自己的代码)
 *   - **AI 的产物全部隔离在 <rootPath>/.design/ 子目录**
 *   - 所有 readFile / writeFile / listFiles / deleteFile 自动加 .design/ 前缀
 *   - AI 看到的 relPath 比如 "index.html",实际落到 <rootPath>/.design/index.html
 *   - 用户原项目代码对 AI 不可见(本版本不开放跨命名空间访问;未来 v6.1 再考虑)
 *
 * 安全约束:relPath 不能包含 .. 逃逸出 .design/
 */

import { promises as fs, statSync } from 'node:fs';
import path from 'node:path';

/** AI 产物隔离的子目录名 */
export const DESIGN_DIR = '.design';

/** 把 rootPath 转成 AI 真正读写的目录 */
export function designRoot(rootPath: string): string {
  return path.join(rootPath, DESIGN_DIR);
}

export type FileType = 'text' | 'binary';

export interface NativeFile {
  path: string;        // 相对 rootPath
  type: FileType;
  size: number;
  mtime: number;
  content: string;     // text 直接;binary base64
}

const BINARY_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'tiff',
  'mp3', 'mp4', 'wav', 'webm', 'mov',
  'pdf', 'zip', 'tar', 'gz',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
]);

function inferType(p: string): FileType {
  const ext = p.split('.').pop()?.toLowerCase() ?? '';
  return BINARY_EXTS.has(ext) ? 'binary' : 'text';
}

/** resolveSafe — 防御路径逃逸 */
function resolveSafe(rootPath: string, relPath: string): string {
  // 拒绝绝对路径 + 拒绝 windows 盘符
  if (path.isAbsolute(relPath) || /^[A-Za-z]:/.test(relPath)) {
    throw new Error(`relPath 必须是相对路径: ${relPath}`);
  }
  const abs = path.resolve(rootPath, relPath);
  const rootResolved = path.resolve(rootPath);
  if (abs !== rootResolved && !abs.startsWith(rootResolved + path.sep)) {
    throw new Error(`path 越权:${relPath} 不在 ${rootPath} 内`);
  }
  return abs;
}

/** 检查 rootPath 本身合法(用户选了一个目录) */
export function validateRoot(rootPath: string): void {
  try {
    const stat = statSync(rootPath);
    if (!stat.isDirectory()) throw new Error('not a directory');
  } catch (e: any) {
    throw new Error(`rootPath 无效: ${rootPath} (${e.message})`);
  }
}

export async function readFile(
  rootPath: string,
  relPath: string
): Promise<NativeFile | null> {
  const abs = resolveSafe(designRoot(rootPath), relPath);
  try {
    const stat = await fs.stat(abs);
    if (!stat.isFile()) return null;
    const type = inferType(relPath);
    if (type === 'binary') {
      const buf = await fs.readFile(abs);
      return {
        path: relPath,
        type,
        size: stat.size,
        mtime: stat.mtimeMs,
        content: buf.toString('base64'),
      };
    } else {
      const content = await fs.readFile(abs, 'utf8');
      return {
        path: relPath,
        type,
        size: stat.size,
        mtime: stat.mtimeMs,
        content,
      };
    }
  } catch (e: any) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

export async function writeFile(
  rootPath: string,
  relPath: string,
  content: string,
  type: FileType = 'text'
): Promise<void> {
  // 自动确保 .design/ 存在(用户没手动创建过也能跑)
  const abs = resolveSafe(designRoot(rootPath), relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  if (type === 'binary') {
    await fs.writeFile(abs, Buffer.from(content, 'base64'));
  } else {
    await fs.writeFile(abs, content, 'utf8');
  }
}

export async function deleteFile(
  rootPath: string,
  relPaths: string[]
): Promise<void> {
  const root = designRoot(rootPath);
  for (const p of relPaths) {
    const abs = resolveSafe(root, p);
    await fs.rm(abs, { force: true });
  }
}

/** listFiles — 递归扫整个 rootPath,忽略 node_modules / .git / .DS_Store / dist 等 */
const IGNORE = new Set([
  'node_modules', '.git', '.svn', '.hg', '.DS_Store',
  'dist', 'dist-electron', 'build', 'release',
  '.next', '.nuxt', '.cache', '.vite', '.parcel-cache',
  '__pycache__', '.pytest_cache', 'venv', '.venv',
  '.idea', '.vscode',
]);

// ============================================================
// source 命名空间 — 读用户原项目代码(只读 + 自动跳过 dist/node_modules/.design)
// AI 用来理解"这是个什么项目"再设计,write 仍然只能写 .design/
// ============================================================

const SOURCE_IGNORE = new Set([
  'node_modules',
  '.git', '.svn', '.hg',
  'dist', 'dist-electron', 'build', 'release', 'out',
  '.next', '.nuxt', '.cache', '.parcel-cache', '.vite', '.turbo',
  '__pycache__', '.pytest_cache', 'venv', '.venv', 'env', '.env',
  '.idea', '.vscode', '.DS_Store',
  '.design', // 不要让 source 把 AI 自己的产物列回去,避免循环
  'coverage', '.nyc_output',
]);

const SOURCE_READ_CAP = 256 * 1024;   // 单文件最多读 256KB
const SOURCE_LIST_CAP = 200;          // 单层 readdir 最多返 200 条(防止某个目录里有几千个文件爆掉)

export interface SourceEntry {
  path: string;            // 相对 rootPath 的完整路径
  kind: 'file' | 'dir';
  type: FileType;
  size: number;            // dir 时 = 0
}

/** 缓存项目的 git tracked + untracked-not-ignored 文件集合(用 git ls-files 拿)
 *  非 git 仓库 = null,fallback 到纯 IGNORE 黑名单 */
const gitignoreCache = new Map<string, Set<string> | null>();

async function getGitTrackedSet(rootPath: string): Promise<Set<string> | null> {
  if (gitignoreCache.has(rootPath)) return gitignoreCache.get(rootPath) ?? null;
  let result: Set<string> | null = null;
  try {
    // 同时给 tracked + untracked-not-ignored,等价于 "git 看得见的所有文件"
    const { spawn } = await import('node:child_process');
    const out = await new Promise<string>((resolve, reject) => {
      const p = spawn(
        'git',
        ['ls-files', '--cached', '--others', '--exclude-standard'],
        { cwd: rootPath }
      );
      const chunks: Buffer[] = [];
      p.stdout.on('data', (c: Buffer) => chunks.push(c));
      p.on('close', (code) => {
        if (code === 0) resolve(Buffer.concat(chunks).toString('utf8'));
        else reject(new Error(`git ls-files exit ${code}`));
      });
      p.on('error', reject);
    });
    result = new Set(out.split('\n').filter(Boolean));
  } catch {
    result = null;
  }
  gitignoreCache.set(rootPath, result);
  return result;
}

/** 用户主动改了 .gitignore / git 状态 → 让下次 list 重新拉 */
export function invalidateGitignoreCache(rootPath: string) {
  gitignoreCache.delete(rootPath);
}

/** 列用户原项目某一层目录(非递归,像 `ls`)
 *  subPath 留空 = 列 rootPath 根目录
 *  自动:① git 跟踪过滤 ② 黑名单跳过 ③ 单层 200 条 cap */
export async function listSource(
  rootPath: string,
  subPath: string = ''
): Promise<{ entries: SourceEntry[]; gitMode: boolean; truncated: boolean }> {
  // 安全:subPath 不能逃逸
  if (subPath.includes('..')) {
    throw new Error('subPath 不能包含 ..');
  }
  // subPath 不能落到 .design/ 或忽略目录
  const firstSeg = subPath.split(/[/\\]/)[0];
  if (firstSeg && SOURCE_IGNORE.has(firstSeg)) {
    throw new Error(`不允许列 ${firstSeg}/(自动跳过的目录)`);
  }

  const targetDir = subPath ? path.join(rootPath, subPath) : rootPath;
  const trackedSet = await getGitTrackedSet(rootPath);
  const gitMode = trackedSet !== null;

  let dirents;
  try {
    dirents = await fs.readdir(targetDir, { withFileTypes: true });
  } catch (e: any) {
    if (e.code === 'ENOENT') return { entries: [], gitMode, truncated: false };
    throw e;
  }

  const entries: SourceEntry[] = [];
  let truncated = false;

  for (const e of dirents) {
    if (entries.length >= SOURCE_LIST_CAP) {
      truncated = true;
      break;
    }
    if (SOURCE_IGNORE.has(e.name)) continue;
    // dotfile 默认跳过(除几个 design 关心的)
    if (
      e.name.startsWith('.') &&
      !['.gitignore', '.env.example', '.editorconfig', '.npmrc', '.nvmrc', '.tool-versions'].includes(e.name)
    ) {
      continue;
    }

    const rel = subPath ? `${subPath}/${e.name}` : e.name;
    const abs = path.join(targetDir, e.name);

    // 如果是 git 仓库,文件必须在 tracked 集合里;目录用 prefix 判断
    if (gitMode && trackedSet) {
      if (e.isFile()) {
        if (!trackedSet.has(rel)) continue;
      } else if (e.isDirectory()) {
        // 该 dir 下至少有一个被 git 看得见的文件,才显示
        const dirPrefix = rel + '/';
        let hasTracked = false;
        for (const t of trackedSet) {
          if (t.startsWith(dirPrefix)) {
            hasTracked = true;
            break;
          }
        }
        if (!hasTracked) continue;
      }
    }

    if (e.isDirectory()) {
      entries.push({
        path: rel,
        kind: 'dir',
        type: 'text',
        size: 0,
      });
    } else if (e.isFile()) {
      try {
        const stat = await fs.stat(abs);
        entries.push({
          path: rel,
          kind: 'file',
          type: inferType(rel),
          size: stat.size,
        });
      } catch {}
    }
  }

  // 排序:目录在前,字母序
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
  return { entries, gitMode, truncated };
}

// ============================================================
// search_files — grep + glob,跨 .design/ 或源码或两边
// 设计:
//   - 纯 Node 实现(不依赖 rg 二进制,容器/裸 Electron 都能跑)
//   - regex 编译失败 → 退化成 plain substring(用户写错语法不爆炸)
//   - glob 在路径白名单上过滤;match 在文本扫
//   - 每个 hit 带 line_no(1-indexed)+ ±2 行 context
//   - 总 hit 数硬上限,避免一搜 5000 行回来
// ============================================================

export interface SearchHit {
  path: string;
  line: number;          // 1-indexed
  match: string;         // 命中那行
  contextBefore: string[];  // 上 2 行
  contextAfter: string[];   // 下 2 行
}

export interface SearchOpts {
  pattern: string;
  glob?: string;         // e.g. "**/*.ts" / "src/**/*.tsx"
  scope: 'design' | 'source' | 'both';
  caseSensitive?: boolean;
  maxResults?: number;   // default 50
  contextLines?: number; // default 2
}

const SEARCH_MAX_RESULTS = 200;     // 硬上限(用户传多大都按这个)
const SEARCH_BYTES_PER_FILE = 1024 * 1024; // 单文件 > 1MB 跳过

/** glob → 简单 regex(支持 ** * ?,够设计场景用)*/
function globToRegex(glob: string): RegExp {
  let re = '^';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i += 2;
        if (glob[i] === '/') i++;
      } else {
        re += '[^/]*';
        i++;
      }
    } else if (c === '?') {
      re += '[^/]';
      i++;
    } else if ('.+()[]{}^$|\\'.includes(c)) {
      re += '\\' + c;
      i++;
    } else {
      re += c;
      i++;
    }
  }
  re += '$';
  return new RegExp(re);
}

export async function searchFiles(
  rootPath: string,
  opts: SearchOpts
): Promise<{
  hits: SearchHit[];
  filesScanned: number;
  truncated: boolean;
  patternMode: 'regex' | 'plain';
}> {
  const contextLines = Math.min(5, Math.max(0, opts.contextLines ?? 2));
  const cap = Math.min(SEARCH_MAX_RESULTS, Math.max(1, opts.maxResults ?? 50));
  const flags = opts.caseSensitive ? '' : 'i';

  // 编译 pattern,失败退化 plain
  let patternRe: RegExp;
  let patternMode: 'regex' | 'plain' = 'regex';
  try {
    patternRe = new RegExp(opts.pattern, flags);
  } catch {
    patternMode = 'plain';
    patternRe = new RegExp(
      opts.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      flags
    );
  }

  const globRe = opts.glob ? globToRegex(opts.glob) : null;

  // 收集候选文件
  const candidates: string[] = []; // 相对 rootPath
  async function walkScope(absBase: string, prefix: string, scopeMode: 'design' | 'source') {
    let entries;
    try {
      entries = await fs.readdir(absBase, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      // source scope 跳过 .design 自己,design scope 跳过常见噪音
      if (scopeMode === 'source') {
        if (SOURCE_IGNORE.has(e.name)) continue;
        if (e.name.startsWith('.') && !['.gitignore', '.env.example'].includes(e.name)) continue;
      } else {
        if (e.name === '.DS_Store') continue;
      }
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      const abs = path.join(absBase, e.name);
      if (e.isDirectory()) {
        await walkScope(abs, rel, scopeMode);
      } else if (e.isFile()) {
        if (globRe && !globRe.test(rel)) continue;
        candidates.push((scopeMode === 'design' ? '.design/' : '') + rel);
      }
    }
  }

  if (opts.scope === 'design' || opts.scope === 'both') {
    await walkScope(designRoot(rootPath), '', 'design');
  }
  if (opts.scope === 'source' || opts.scope === 'both') {
    await walkScope(rootPath, '', 'source');
  }

  // 扫文本
  const hits: SearchHit[] = [];
  let filesScanned = 0;
  let truncated = false;

  for (const relWithPrefix of candidates) {
    if (hits.length >= cap) {
      truncated = true;
      break;
    }
    const isDesign = relWithPrefix.startsWith('.design/');
    const rel = isDesign ? relWithPrefix.slice('.design/'.length) : relWithPrefix;
    const abs = isDesign
      ? path.join(designRoot(rootPath), rel)
      : path.join(rootPath, rel);

    let stat;
    try {
      stat = await fs.stat(abs);
    } catch {
      continue;
    }
    if (stat.size > SEARCH_BYTES_PER_FILE) continue;
    if (stat.size === 0) continue;

    let content;
    try {
      content = await fs.readFile(abs, 'utf8');
    } catch {
      continue;
    }
    // 简单二进制检测:出现大量 \0 跳过
    if (content.indexOf('\0') !== -1) continue;

    filesScanned++;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (hits.length >= cap) {
        truncated = true;
        break;
      }
      if (patternRe.test(lines[i])) {
        hits.push({
          path: relWithPrefix,
          line: i + 1,
          match: lines[i],
          contextBefore: lines.slice(Math.max(0, i - contextLines), i),
          contextAfter: lines.slice(i + 1, Math.min(lines.length, i + 1 + contextLines)),
        });
      }
    }
  }

  return { hits, filesScanned, truncated, patternMode };
}

/** 读用户原项目源码 — 二进制返回 metadata,文本超 256KB 截断 */
export async function readSource(
  rootPath: string,
  relPath: string
): Promise<NativeFile | null> {
  // 拒绝读 .design/(那是设计输出,该用 readFile)
  if (relPath.startsWith('.design/') || relPath === '.design') {
    throw new Error('读 .design/ 用 read_file,不是 read_source_file');
  }
  // 拒绝读 node_modules 之类
  const firstSeg = relPath.split(/[/\\]/)[0];
  if (SOURCE_IGNORE.has(firstSeg)) {
    throw new Error(`不允许读 ${firstSeg}/(自动跳过的目录)`);
  }
  const abs = resolveSafe(rootPath, relPath);
  try {
    const stat = await fs.stat(abs);
    if (!stat.isFile()) return null;
    const type = inferType(relPath);
    if (type === 'binary') {
      // 二进制只返回 metadata,不读字节
      return {
        path: relPath,
        type,
        size: stat.size,
        mtime: stat.mtimeMs,
        content: `<binary file: ${Math.round(stat.size / 1024)}KB ${relPath.split('.').pop()}>`,
      };
    }
    if (stat.size > SOURCE_READ_CAP) {
      // 超大文本文件:只读前 256KB
      const fh = await fs.open(abs, 'r');
      try {
        const buf = Buffer.alloc(SOURCE_READ_CAP);
        await fh.read(buf, 0, SOURCE_READ_CAP, 0);
        return {
          path: relPath,
          type,
          size: stat.size,
          mtime: stat.mtimeMs,
          content:
            buf.toString('utf8') +
            `\n\n[…文件被截断,实际 ${Math.round(stat.size / 1024)}KB,只读了 256KB]`,
        };
      } finally {
        await fh.close();
      }
    }
    const content = await fs.readFile(abs, 'utf8');
    return {
      path: relPath,
      type,
      size: stat.size,
      mtime: stat.mtimeMs,
      content,
    };
  } catch (e: any) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

export async function listFiles(
  rootPath: string
): Promise<Array<{ path: string; type: FileType; size: number; mtime: number }>> {
  const root = designRoot(rootPath);
  const out: Array<{ path: string; type: FileType; size: number; mtime: number }> = [];

  // .design/ 不存在 = 空项目,正常返回 []
  try {
    statSync(root);
  } catch {
    return out;
  }

  async function walk(dir: string, prefix: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (IGNORE.has(e.name)) continue;
      // .design/ 内部允许 dotfile(用户可能有 .env、.gitignore 等)
      const full = path.join(dir, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(full, rel);
      } else if (e.isFile()) {
        try {
          const stat = await fs.stat(full);
          out.push({
            path: rel,
            type: inferType(rel),
            size: stat.size,
            mtime: stat.mtimeMs,
          });
        } catch {}
      }
    }
  }
  await walk(root, '');
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
