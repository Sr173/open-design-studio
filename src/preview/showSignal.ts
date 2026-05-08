/* show_to_user 信号总线
 * AI 调 show_to_user(path) 时 chat.ts 触发 emit;PreviewPane 订阅切到对应 variant
 */

type Listener = (projectId: number, path: string) => void;
const listeners = new Set<Listener>();

export function emitShow(projectId: number, path: string): void {
  for (const fn of listeners) fn(projectId, path);
}

export function onShow(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
