/* 项目资源附件 — 拖到文件树的图等
 *
 * 入 IndexedDB 项目文件,放在 uploads/ 路径下
 * AI read_file 看不到二进制内容,只看 metadata,但能在 HTML 用 <img src="uploads/x.png">
 */

import { writeFile } from '../store/files';

const ACCEPTED = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]);

export async function uploadFileToProject(
  projectId: number,
  file: File
): Promise<string> {
  const safeName = sanitizeName(file.name);
  const path = `uploads/${safeName}`;
  if (file.type.startsWith('image/svg')) {
    // SVG 当 text 存,可被 read_file 读源
    const text = await file.text();
    await writeFile(projectId, path, text, 'text', 'user');
  } else if (ACCEPTED.has(file.type)) {
    const buf = await file.arrayBuffer();
    const b64 = bytesToBase64(new Uint8Array(buf));
    await writeFile(projectId, path, b64, 'binary', 'user');
  } else {
    // 文本类
    const text = await file.text();
    await writeFile(projectId, path, text, 'text', 'user');
  }
  return path;
}

function sanitizeName(n: string): string {
  return n
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'file';
}

function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
