/* vision 附件 — 见 plan「附件双通道」节
 *
 * 用户拖到 chat 输入框的图 → 进 user message 的 image content blocks(LLM 直接看图)
 * 不入 IndexedDB 项目文件;每个 turn 完事就忘
 */

export interface VisionImage {
  mediaType: string;
  data: string;          // base64
  filename?: string;
  bytes: number;         // 原始字节数,UI 显示
}

const ACCEPTED_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
];

export function isAcceptedImage(file: File): boolean {
  return ACCEPTED_TYPES.includes(file.type);
}

export async function fileToVisionImage(file: File): Promise<VisionImage> {
  if (!isAcceptedImage(file)) {
    throw new Error(`Unsupported image type: ${file.type}`);
  }
  const buf = await file.arrayBuffer();
  const data = bytesToBase64(new Uint8Array(buf));
  return {
    mediaType: file.type,
    data,
    filename: file.name,
    bytes: file.size,
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  // 大文件分片 btoa,避免超长 string
  const CHUNK = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
