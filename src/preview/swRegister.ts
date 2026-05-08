/* 注册 service worker
 * 失败时不致命 — 只是预览不可用,UI 可降级显示提示
 */

let registration: ServiceWorkerRegistration | null = null;

export async function registerPreviewSW(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) {
    console.warn('[ai-design] Service Worker not supported in this browser');
    return null;
  }
  if (registration) return registration;
  try {
    registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
    });
    // 等首次激活,避免第一次 iframe 加载时 SW 还没拦截
    if (registration.installing) {
      await new Promise<void>((resolve) => {
        const sw = registration!.installing!;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'activated' || sw.state === 'redundant') resolve();
        });
      });
    }
    await navigator.serviceWorker.ready;
    return registration;
  } catch (e) {
    console.error('[ai-design] SW register failed:', e);
    return null;
  }
}

export function isSWReady(): boolean {
  return navigator.serviceWorker?.controller != null;
}
