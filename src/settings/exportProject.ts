/* 项目导出 zip
 *
 * 含开关:strip data-aid + TWEAK marker → 干净版
 * Tweak marker strip 在 v3 加;v1 仅 strip data-aid
 */

import JSZip from 'jszip';
import { listFiles } from '../store/files';
import { stripAids } from '../preview/postProcess';
import { stripTweakMarkers } from '../tweaks/markerWriter';

export interface ExportOpts {
  /** 删 data-aid 属性 + (v3) Tweak marker 块 */
  stripDevMarkers?: boolean;
}

export async function exportProjectAsZip(
  projectId: number,
  projectName: string,
  opts: ExportOpts = {}
): Promise<void> {
  const zip = new JSZip();
  const files = await listFiles(projectId);
  for (const f of files) {
    let content = f.content;
    if (opts.stripDevMarkers) {
      const lower = f.path.toLowerCase();
      if (lower.endsWith('.html') || lower.endsWith('.htm')) {
        content = stripAids(content);
      }
      content = stripTweakMarkers(f.path, content);
    }
    if (f.type === 'binary') {
      zip.file(f.path, content, { base64: true });
    } else {
      zip.file(f.path, content);
    }
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  triggerDownload(blob, `${projectName || 'project'}.zip`);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1000);
}
