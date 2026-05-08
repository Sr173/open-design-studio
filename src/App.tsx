import { useEffect, useState } from 'react';
import { Shell } from './layout/Shell';
import { registerPreviewSW } from './preview/swRegister';
import { ensureDbOpen } from './store/db';

export function App() {
  const [swReady, setSwReady] = useState(false);
  const [swError, setSwError] = useState(false);
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  useEffect(() => {
    ensureDbOpen()
      .then(() => setDbReady(true))
      .catch((e) => setDbError(e?.message ?? String(e)));
    registerPreviewSW().then((reg) => {
      if (reg) setSwReady(true);
      else setSwError(true);
    });
  }, []);

  if (dbError) {
    return (
      <div style={{ padding: 'var(--sp-5)', color: 'var(--error)' }}>
        <h2>IndexedDB 打不开</h2>
        <p style={{ color: 'var(--text-secondary)' }}>{dbError}</p>
        <p style={{ color: 'var(--text-tertiary)', fontSize: 'var(--fs-xs)' }}>
          可手动清:F12 → Application → IndexedDB → 删 ai-design-app → 刷新
        </p>
      </div>
    );
  }

  if (!dbReady || (!swReady && !swError)) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-tertiary)',
        }}
      >
        booting…
      </div>
    );
  }

  if (swError) {
    return (
      <div
        style={{
          height: '100%',
          padding: 'var(--sp-5)',
          color: 'var(--error)',
          maxWidth: 520,
          margin: '0 auto',
          fontSize: 'var(--fs-sm)',
          lineHeight: 1.6,
        }}
      >
        <h2 style={{ marginBottom: 12 }}>Service Worker 注册失败</h2>
        <p>
          ai-design 用 Service Worker 把 IndexedDB 里的项目文件当成"虚拟服务器"
          serve 给预览 iframe。这是基础能力,挂了就不能跑。
        </p>
        <p style={{ marginTop: 12 }}>检查:浏览器是否禁用 SW、是否在私密模式下,
          以及 dev server 是否在 localhost。</p>
      </div>
    );
  }

  return <Shell />;
}
