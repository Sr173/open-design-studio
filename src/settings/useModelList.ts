/* useModelList — 动态拉取 + IDB 缓存的 model 列表 hook
 *
 * 行为:
 *   1. mount 时先读 IDB 缓存(有就用)
 *   2. 后台跑一次 native.models.list 拉新数据(stale-while-revalidate)
 *   3. 拉到了写回 IDB,重新 render
 *   4. refresh() 强制重拉
 *
 * 返回:
 *   apiModels  — 从 provider 拉到的(可能空,Codex 这种就是空)
 *   loading    — 是否正在拉
 *   error      — 拉取失败信息
 *   source     — 'api' | 'unsupported' | 'cache' | 'none'
 *   fetchedAt  — 上次 fetch 时戳(ms)
 *   refresh()  — 强刷
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { native, isElectron } from '../native';
import { type LLMProvider } from '../store/db';
import {
  getCachedModels,
  setCachedModels,
  isStale,
  type CachedModels,
} from '../store/modelsCache';

interface UseModelListOpts {
  provider: LLMProvider;
  /** keychain account 或 'oauth:xxx' */
  account: string;
  baseUrl?: string | null;
  /** 'unsupported' provider 不拉(避免无意义 IPC),传 true 跳过 */
  skip?: boolean;
}

interface UseModelListResult {
  apiModels: string[];
  displayNames: Record<string, string>;
  loading: boolean;
  error: string | null;
  source: 'api' | 'unsupported' | 'cache' | 'none';
  fetchedAt: number | null;
  refresh: () => void;
}

export function useModelList(opts: UseModelListOpts): UseModelListResult {
  const [apiModels, setApiModels] = useState<string[]>([]);
  const [displayNames, setDisplayNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<UseModelListResult['source']>('none');
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

  const reqIdRef = useRef(0);

  const fetchFresh = useCallback(
    async (force: boolean) => {
      if (!isElectron()) return;
      if (opts.skip) return;
      const n = native();
      if (!n) return;
      // 没 account 的话不能拉(还没保存过 key)
      if (!opts.account) return;
      const reqId = ++reqIdRef.current;
      setLoading(true);
      setError(null);
      try {
        const res = await n.models.list({
          provider: opts.provider,
          account: opts.account,
          baseUrl: opts.baseUrl ?? undefined,
        });
        if (reqId !== reqIdRef.current) return; // stale request,丢弃
        if (res.source === 'unsupported') {
          setApiModels([]);
          setDisplayNames({});
          setSource('unsupported');
          setFetchedAt(res.fetchedAt);
        } else {
          setApiModels(res.models);
          setDisplayNames(res.displayNames ?? {});
          setSource('api');
          setFetchedAt(res.fetchedAt);
          // 写缓存
          const cached: CachedModels = {
            models: res.models,
            displayNames: res.displayNames,
            source: res.source,
            fetchedAt: res.fetchedAt,
          };
          await setCachedModels(opts.provider, opts.baseUrl, cached).catch(() => {});
        }
      } catch (e: any) {
        if (reqId === reqIdRef.current) {
          setError(e?.message ?? String(e));
          if (!force) {
            // 静默失败,UI 仍可用 preset 兜底
            console.warn('[useModelList] fetch failed silently:', e?.message);
          }
        }
      } finally {
        if (reqId === reqIdRef.current) setLoading(false);
      }
    },
    [opts.provider, opts.account, opts.baseUrl, opts.skip]
  );

  // mount / opts 变化:先读 cache,后台拉新
  useEffect(() => {
    let canceled = false;
    (async () => {
      if (opts.skip) {
        setApiModels([]);
        setDisplayNames({});
        setSource('none');
        return;
      }
      // 1. cache hit
      const cached = await getCachedModels(opts.provider, opts.baseUrl).catch(() => null);
      if (!canceled && cached) {
        setApiModels(cached.models);
        setDisplayNames(cached.displayNames ?? {});
        setSource(cached.source === 'unsupported' ? 'unsupported' : 'cache');
        setFetchedAt(cached.fetchedAt);
      }
      // 2. 后台 revalidate(cache stale 或没 cache 都拉)
      if (canceled) return;
      if (!cached || isStale(cached)) {
        fetchFresh(false);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [opts.provider, opts.account, opts.baseUrl, opts.skip, fetchFresh]);

  const refresh = useCallback(() => fetchFresh(true), [fetchFresh]);

  return { apiModels, displayNames, loading, error, source, fetchedAt, refresh };
}

/** 合并 preset 推荐 + API 拉到的(去重,推荐在前) */
export function mergeModels(preset: string[], api: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of preset) {
    if (!seen.has(m)) { seen.add(m); out.push(m); }
  }
  for (const m of api) {
    if (!seen.has(m)) { seen.add(m); out.push(m); }
  }
  return out;
}
