/* fs 服务 — 文件 CRUD + 路径越权防护
 *
 * 安全约束:所有操作的 path 必须在 rootPath 内,逃逸(../../etc/passwd)直接拒绝。
 * 调用方传 rootPath + relPath,内部 resolveSafe 拼接 + 检查。
 */

import { promises as fs, statSync } from 'node:fs';
import path from 'node:path';

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
  const abs = resolveSafe(rootPath, relPath);
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
  const abs = resolveSafe(rootPath, relPath);
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
  for (const p of relPaths) {
    const abs = resolveSafe(rootPath, p);
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

export async function listFiles(
  rootPath: string
): Promise<Array<{ path: string; type: FileType; size: number; mtime: number }>> {
  const out: Array<{ path: string; type: FileType; size: number; mtime: number }> = [];
  async function walk(dir: string, prefix: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (IGNORE.has(e.name) || e.name.startsWith('.')) {
        // .ai-design / .env 也跳过,但保留 .gitignore 等可见
        if (!['.gitignore', '.gitattributes', '.editorconfig'].includes(e.name)) continue;
      }
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
  await walk(rootPath, '');
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
