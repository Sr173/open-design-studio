/* PreviewPane — iframe + viewport 切换 + writing 蒙层 + console 面板
 *
 * 见 plan「写入触发刷新」+「Writing 蒙层期间 UI 锁定」节
 *
 * 关键行为:
 *   - iframe 不在每次文件 write 时刷新 — 由外部触发 refresh
 *   - writing.active=true 时盖蒙层,iframe 不接受点击
 *   - console error 自动滚到底
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { onPreviewMessage, type PreviewMessage } from '../preview/sandboxBridge';
import { previewUrl } from '../preview/injectBuilder';
import { getElementBridge, type PreviewMode } from '../preview/elementBridge';
import { useCanvasPanZoom } from '../preview/useCanvasPanZoom';
import { ModeToggle } from './ModeToggle';
import { CommentBubble } from '../inspect/commentBubble';
import { installInlineEdit } from '../inspect/inlineEdit';
import { TweaksPanel } from './TweaksPanel';
import { detectVariants, type VariantInfo } from '../preview/variants';
import { listFiles, onFileChange, getProjectRoot } from '../store/files';
import { onShow } from '../preview/showSignal';
import { onWatcherRefresh } from '../native/useProjectWatcher';

export interface ViewportPreset {
  label: string;
  width: number;
  height: number;
}

export const VIEWPORTS: ViewportPreset[] = [
  { label: 'Desktop 1280', width: 1280, height: 800 },
  { label: 'Tablet 768', width: 768, height: 1024 },
  { label: 'Mobile 375', width: 375, height: 667 },
];

export interface WritingState {
  active: boolean;
  currentFile?: string;
}

export interface PreviewPaneProps {
  projectId: number;
  refreshKey: number;          // 父组件 +1 即触发 iframe 重载
  writing?: WritingState;
  initialPath?: string;
}

interface ConsoleEntry {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  text: string;
  ts: number;
}

export function PreviewPane({
  projectId,
  refreshKey,
  writing,
  initialPath = 'index.html',
}: PreviewPaneProps) {
  const [viewport, setViewport] = useState<ViewportPreset>(VIEWPORTS[0]);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const consoleRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // === 项目 rootPath(Electron 本地文件夹模式)===
  const [rootPath, setRootPath] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    getProjectRoot(projectId).then((rp) => {
      if (alive) setRootPath(rp);
    });
    return () => {
      alive = false;
    };
  }, [projectId]);

  // === 外部文件变动触发的本地刷新键(叠加在父组件的 refreshKey 上)===
  const [extRefresh, setExtRefresh] = useState(0);
  useEffect(() => {
    return onWatcherRefresh(() => setExtRefresh((v) => v + 1));
  }, []);
  const combinedRefreshKey = refreshKey + extRefresh * 10000; // 不冲突即可

  // === 多变体探测 + 当前选中 variant ===
  const [variants, setVariants] = useState<VariantInfo[]>([]);
  const [activeVariantSlug, setActiveVariantSlug] = useState<string | null>(null);
  /** 多变体显示模式:'single' 切 tab 看一个 / 'canvas' 并排看全部 */
  const [variantMode, setVariantMode] = useState<'single' | 'canvas'>(
    'canvas'
  );

  // 监听 AI show_to_user 信号 — 匹配到 variant 入口则切过去
  useEffect(() => {
    return onShow((pid, path) => {
      if (pid !== projectId) return;
      const m = /^variants\/([^/]+)\/index\.html?$/i.exec(path);
      if (m) setActiveVariantSlug(m[1]);
    });
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const files = await listFiles(projectId);
      const v = detectVariants(files);
      if (cancelled) return;
      setVariants(v);
      // 默认选中第一个;若用户在 initialPath 命中某个 variant,选它
      const fromPath = v.find((x) => x.path === initialPath);
      if (fromPath) {
        setActiveVariantSlug(fromPath.slug);
      } else if (v.length > 0 && !v.some((x) => x.slug === activeVariantSlug)) {
        setActiveVariantSlug(v[0].slug);
      }
    };
    refresh();
    const unsub = onFileChange((e) => {
      if (e.projectId === projectId && /^variants\//.test(e.path))
        refresh();
    });
    return () => {
      cancelled = true;
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, initialPath]);

  const bridge = useMemo(() => getElementBridge(projectId), [projectId]);
  const bridgeState = useSyncExternalStore(
    (cb) => bridge.subscribe(cb),
    () => bridge.getState()
  );

  useEffect(() => {
    return installInlineEdit(projectId);
  }, [projectId]);

  useEffect(() => {
    // 仅 single 模式下 PreviewStage 才渲染 iframeRef.current,canvas 模式由 VariantCanvas 自挂
    const detach = bridge.attachIframe(iframeRef.current);
    return () => detach();
  }, [bridge, refreshKey, variantMode]);

  useEffect(() => {
    if (writing?.active && bridge.getState().mode !== 'preview') {
      bridge.setMode('preview');
    }
  }, [writing?.active, bridge]);

  // 解析当前实际加载路径:有变体则用 variant 路径,否则 fallback 到 initialPath
  const effectivePath = useMemo(() => {
    if (variants.length > 0 && activeVariantSlug) {
      const v = variants.find((x) => x.slug === activeVariantSlug);
      if (v) return v.path;
    }
    return initialPath;
  }, [variants, activeVariantSlug, initialPath]);

  const url = useMemo(
    () => previewUrl(projectId, effectivePath, combinedRefreshKey, rootPath),
    [projectId, effectivePath, combinedRefreshKey, rootPath]
  );

  // 订阅 preview 消息(已按 projectId 过滤)
  useEffect(() => {
    setEntries([]);   // 切项目清空
    return onPreviewMessage(projectId, (msg: PreviewMessage) => {
      if (msg.type === 'console') {
        setEntries((prev) =>
          prev
            .concat({
              level: msg.level,
              text: msg.args.join(' '),
              ts: msg.ts,
            })
            .slice(-200)
        );
      } else if (msg.type === 'error') {
        setEntries((prev) =>
          prev
            .concat({
              level: 'error',
              text: msg.message + (msg.stack ? `\n${msg.stack}` : ''),
              ts: msg.ts,
            })
            .slice(-200)
        );
      }
    });
  }, [projectId]);

  // 自动滚底
  useEffect(() => {
    if (consoleOpen && consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [entries, consoleOpen]);

  const errorCount = entries.filter((e) => e.level === 'error').length;

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-base)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* 顶部 mode toggle + viewport 切换 */}
      <div
        style={{
          height: 36,
          padding: '0 var(--sp-3)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--sp-3)',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-panel)',
          fontSize: 'var(--fs-sm)',
          color: 'var(--text-secondary)',
        }}
      >
        <ModeToggle
          mode={bridgeState.mode}
          onChange={(m) => bridge.setMode(m)}
          disabled={writing?.active}
        />
        {variants.length > 0 && (
          <>
            <VariantSwitcher
              variants={variants}
              active={activeVariantSlug}
              onChange={(slug) => {
                setActiveVariantSlug(slug);
                setVariantMode('single');
              }}
              disabled={writing?.active}
            />
            {variants.length >= 2 && (
              <button
                onClick={() =>
                  setVariantMode((m) => (m === 'canvas' ? 'single' : 'canvas'))
                }
                title={
                  variantMode === 'canvas'
                    ? '切回单变体焦点模式'
                    : '并排显示全部 variants(canvas)'
                }
                style={{
                  padding: '4px 10px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 'var(--fs-xs)',
                  color:
                    variantMode === 'canvas'
                      ? 'var(--accent)'
                      : 'var(--text-tertiary)',
                  background:
                    variantMode === 'canvas'
                      ? 'rgba(255,164,81,0.12)'
                      : 'transparent',
                  border: '1px solid var(--border-subtle)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                ⊞ canvas
              </button>
            )}
          </>
        )}
        <div style={{ flex: 1 }} />
        {VIEWPORTS.map((v) => (
          <button
            key={v.label}
            onClick={() => setViewport(v)}
            style={{
              padding: '4px 10px',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--fs-xs)',
              color: viewport === v ? 'var(--text-primary)' : 'var(--text-tertiary)',
              background: viewport === v ? 'var(--bg-elevated)' : 'transparent',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {v.width}
          </button>
        ))}
      </div>

      {/* iframe 容器 — 等比缩放适配中栏,默认不出滚动条 */}
      {variantMode === 'canvas' && variants.length >= 2 ? (
        <VariantCanvas
          projectId={projectId}
          variants={variants}
          refreshKey={refreshKey}
          writingActive={!!writing?.active}
          bridge={bridge}
          rootPath={rootPath}
          onFocusVariant={(slug) => {
            setActiveVariantSlug(slug);
            setVariantMode('single');
          }}
        />
      ) : (
        <PreviewStage
          viewport={viewport}
          iframeRef={iframeRef}
          url={url}
          refreshKey={refreshKey}
          writingActive={!!writing?.active}
          projectId={projectId}
          mode={bridgeState.mode}
        >
          {writing?.active && <WritingOverlay file={writing.currentFile} />}

          {bridgeState.pendingComment && !writing?.active && (
            <CommentBubble
              target={bridgeState.pendingComment}
              onSubmit={(text) => bridge.submitComment(text)}
              onCancel={() => bridge.cancelComment()}
            />
          )}

          {bridgeState.selection && !writing?.active && (
            <SelectionBadge
              ancestry={bridgeState.selection.ancestry}
              onClear={() => bridge.clearSelection()}
            />
          )}
        </PreviewStage>
      )}

      {/* Tweaks 面板(没有 marker 时自隐) */}
      <TweaksPanel projectId={projectId} disabled={writing?.active} />

      {/* 底部 console 面板 */}
      <ConsoleBar
        open={consoleOpen}
        toggle={() => setConsoleOpen((v) => !v)}
        errorCount={errorCount}
        entries={entries}
        listRef={consoleRef}
        onClear={() => setEntries([])}
      />
    </div>
  );
}

/* PreviewStage — iframe 装载 + 等比缩放适配容器 + 双击全屏 + 真实尺寸下才出滚动条
 *
 * 默认行为:iframe 实际渲染在固定 viewport(1280x800),用 transform: scale 缩到容器大小
 * 用户双击 / 按 F:全屏遮罩,看真实尺寸
 */
function PreviewStage({
  viewport,
  iframeRef,
  url,
  refreshKey,
  writingActive,
  projectId,
  mode,
  children,
}: {
  viewport: ViewportPreset;
  iframeRef: React.RefObject<HTMLIFrameElement>;
  url: string;
  refreshKey: number;
  writingActive: boolean;
  projectId: number;
  mode: PreviewMode;
  children?: React.ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);

  // 单 iframe 预览模式:iframe 默认可交互(wheel 滚动 / click / hover),
  // pan 通过显式手势触发(空格 / 中键 / Cmd+drag);zoom 通过 Cmd+wheel(__aid_inject 转发)。
  // 之前 handMode 跟 mode='preview' 绑,导致 iframe 永远 pointer-events:none,wheel 失效。
  // canvas (多变体并排) 模式才需要默认 handMode — 那块代码在 VariantCanvas,跟这里独立。
  const handMode = false;

  const pz = useCanvasPanZoom({
    wrapRef,
    contentWidth: viewport.width,
    contentHeight: viewport.height,
    handMode,
  });

  // F 全屏 / Esc — 只剩 fullscreen 这俩本地状态,其它全走 useCanvasPanZoom
  useEffect(() => {
    const isEditable = (t: EventTarget | null) =>
      t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      if (e.key === 'f' || e.key === 'F') setFullscreen((v) => !v);
      if (e.key === 'Escape' && fullscreen) setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  // 切 viewport 自动 reset(让 auto-fit 重算)
  useEffect(() => {
    pz.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport]);

  // iframe 转发的 wheel_zoom — hook 内部用 ref 读最新 pan/scale,closure 不会失效
  useEffect(() => {
    return onPreviewMessage(projectId, (msg) => {
      if (msg.type !== 'wheel_zoom') return;
      pz.zoomAtIframeLocal(msg.ifx, msg.ify, msg.deltaY);
    });
  }, [projectId, pz.zoomAtIframeLocal]);

  const stageStyle: React.CSSProperties = fullscreen
    ? {
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: 'var(--bg-base)',
        padding: 'var(--sp-4)',
      }
    : {
        flex: 1,
        position: 'relative',
        overflow: 'hidden',
        minHeight: 0,
        cursor: pz.dragging
          ? 'grabbing'
          : pz.spaceHeld || handMode
            ? 'grab'
            : 'default',
      };

  const effectiveScale = fullscreen ? 1 : pz.scale;
  const effectivePan = fullscreen ? { x: 0, y: 0 } : { x: pz.panX, y: pz.panY };
  const showZoomPill = !fullscreen && pz.isFree;

  return (
    <div
      ref={wrapRef}
      style={{
        ...stageStyle,
        backgroundImage: fullscreen
          ? undefined
          : `radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px)`,
        backgroundSize: '20px 20px',
        backgroundPosition: `${effectivePan.x % 20}px ${effectivePan.y % 20}px`,
      }}
      onDoubleClick={(e) => {
        // 在 stage 空白处 dblclick 切全屏(iframe 区域不触发)
        if (e.target === wrapRef.current) setFullscreen((v) => !v);
      }}
    >
      {/* 单一 artwork wrapper:translate + scale,origin top-left */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: viewport.width,
          height: viewport.height,
          transform: `translate(${effectivePan.x}px, ${effectivePan.y}px) scale(${effectiveScale})`,
          transformOrigin: '0 0',
          boxShadow: 'var(--shadow-md)',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
          willChange: pz.dragging ? 'transform' : undefined,
        }}
      >
        <iframe
          ref={iframeRef}
          key={refreshKey}
          src={url}
          style={{
            width: viewport.width,
            height: viewport.height,
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            background: '#fff',
            display: 'block',
            // preview 模式 = hand tool;writing/drag/space 期间也禁交互让事件落到 stage
            pointerEvents:
              writingActive || pz.dragging || pz.spaceHeld || handMode
                ? 'none'
                : 'auto',
          }}
          title="preview"
        />
      </div>
      {/* overlays 在 stage 顶层(不被 scale 影响) */}
      {children}
      {!fullscreen && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 5,
            display: 'flex',
            gap: 6,
            alignItems: 'center',
          }}
        >
          {/* 缩放 pill — 显示当前比例 + 快捷缩放按钮 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              background: 'rgba(0,0,0,0.4)',
              borderRadius: 4,
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              color: '#fff',
              overflow: 'hidden',
            }}
            title={
              '空格 + 拖动 = 平移 · 中键拖动 = 平移 · ⌘/Ctrl + 滚轮 = 缩放 · ⌘0 = 重置 · trackpad pinch = 缩放 · F = 全屏'
            }
          >
            <button onClick={() => pz.zoomBy(0.8)} style={zoomBtn} title="缩小 (⌘-)">
              −
            </button>
            <span style={{ padding: '4px 6px', minWidth: 36, textAlign: 'center' }}>
              {showZoomPill ? `${Math.round(pz.scale * 100)}%` : 'fit'}
            </span>
            <button onClick={() => pz.zoomBy(1.25)} style={zoomBtn} title="放大 (⌘+)">
              +
            </button>
            {showZoomPill && (
              <button onClick={() => pz.reset()} style={zoomBtn} title="回到 fit-to-view(⌘0)">
                ⤢
              </button>
            )}
          </div>
          <button
            onClick={() => setFullscreen(true)}
            title="全屏(双击预览或按 F)"
            style={{
              padding: '4px 8px',
              background: 'rgba(0,0,0,0.4)',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              cursor: 'pointer',
            }}
          >
            ⤢ F
          </button>
        </div>
      )}
      {fullscreen && (
        <button
          onClick={() => setFullscreen(false)}
          title="退出全屏(Esc)"
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            zIndex: 99999,
            padding: '6px 12px',
            background: 'rgba(0,0,0,0.6)',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            fontSize: 12,
            fontFamily: 'var(--font-mono)',
            cursor: 'pointer',
          }}
        >
          ✕ Esc
        </button>
      )}
    </div>
  );
}

/* VariantCanvas — 把 2-4 个 variant iframe 并排展示。
 * 点 ⤢ 切到单变体焦点模式;每个 iframe 顶部显示 slug + DNA tooltip
 */
function VariantCanvas({
  projectId,
  variants,
  refreshKey,
  writingActive,
  bridge,
  rootPath,
  onFocusVariant,
}: {
  projectId: number;
  variants: VariantInfo[];
  refreshKey: number;
  writingActive: boolean;
  bridge: ReturnType<typeof getElementBridge>;
  rootPath: string | null;
  onFocusVariant: (slug: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const iframeRefs = useRef<Map<string, HTMLIFrameElement>>(new Map());

  // 把所有 variant iframe 挂到 bridge,模式切换时广播
  useEffect(() => {
    const detachers: Array<() => void> = [];
    for (const f of iframeRefs.current.values()) {
      detachers.push(bridge.attachIframe(f));
    }
    return () => {
      for (const d of detachers) d();
    };
  }, [bridge, refreshKey, variants.map((v) => v.slug).join('|')]);

  // 每个 variant artboard 设计尺寸固定 1280×800;横向排列;variant 之间 24px gap
  const DESIGN_W = 1280;
  const DESIGN_H = 800;
  const GAP = 48;
  const LABEL_H = 32;

  // 总 content 尺寸(供 useCanvasPanZoom 算 auto-fit)
  const totalW = variants.length * DESIGN_W + (variants.length - 1) * GAP;
  const totalH = DESIGN_H + LABEL_H + 8;

  // pan + zoom 引擎(canvas 模式默认就是 hand mode)
  const pz = useCanvasPanZoom({
    wrapRef,
    contentWidth: totalW,
    contentHeight: totalH,
    padding: 48,
    handMode: true,
  });

  // 订阅 iframe 转发的 wheel_zoom — 任意 variant iframe 都用同一套 pan/zoom
  useEffect(() => {
    return onPreviewMessage(projectId, (msg) => {
      if (msg.type !== 'wheel_zoom') return;
      // msg.ifx/ify 是 iframe-local;但我们不知道是哪个 variant 发的
      // 简化:把它视为该 variant 的左上 + 偏移,直接当 wrap-local 加上 panX/panY(粗略)
      // 更精确:在 iframe 注入 variant slug,这里映射到 left offset。当前先粗略,等用户精确反馈
      pz.zoomAtIframeLocal(msg.ifx, msg.ify, msg.deltaY);
    });
  }, [projectId, pz.zoomAtIframeLocal]);

  return (
    <div
      ref={wrapRef}
      style={{
        flex: 1,
        position: 'relative',
        overflow: 'hidden',
        minHeight: 0,
        background: 'var(--bg-base)',
        backgroundImage: `radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px)`,
        backgroundSize: '20px 20px',
        backgroundPosition: `${pz.panX % 20}px ${pz.panY % 20}px`,
        cursor: pz.dragging ? 'grabbing' : 'grab',
      }}
    >
      {/* 整个 multi-variant content,作为单一可变换层 */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: totalW,
          height: totalH,
          transform: `translate(${pz.panX}px, ${pz.panY}px) scale(${pz.scale})`,
          transformOrigin: '0 0',
          willChange: pz.dragging ? 'transform' : undefined,
        }}
      >
        {variants.map((v, i) => {
          const letter = String.fromCharCode(65 + i);
          const left = i * (DESIGN_W + GAP);
          return (
            <div
              key={v.slug}
              style={{
                position: 'absolute',
                left,
                top: 0,
                width: DESIGN_W,
                height: DESIGN_H + LABEL_H + 8,
              }}
            >
              <div
                style={{
                  height: LABEL_H,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '0 var(--sp-2)',
                  fontSize: 14,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-secondary)',
                }}
              >
                <span style={{ color: 'var(--accent)', fontWeight: 600, fontSize: 14 }}>
                  {letter}
                </span>
                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={
                    [
                      v.dna && `DNA: ${v.dna}`,
                      v.fits && `Fits: ${v.fits}`,
                      v.tradeoff && `Tradeoff: ${v.tradeoff}`,
                    ]
                      .filter(Boolean)
                      .join('\n') || v.slug
                  }
                >
                  {v.displayName ?? v.slug}
                </span>
                <button
                  onClick={() => onFocusVariant(v.slug)}
                  style={{
                    padding: '2px 8px',
                    fontSize: 13,
                    color: 'var(--text-tertiary)',
                    background: 'transparent',
                    border: 0,
                    cursor: 'pointer',
                  }}
                  title="单变体焦点模式"
                >
                  ⤢
                </button>
              </div>
              <div
                style={{
                  width: DESIGN_W,
                  height: DESIGN_H,
                  position: 'relative',
                  background: '#fff',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                  boxShadow: 'var(--shadow-md)',
                  overflow: 'hidden',
                  marginTop: 8,
                }}
              >
                <iframe
                  key={`${v.slug}-${refreshKey}`}
                  ref={(el) => {
                    if (el) iframeRefs.current.set(v.slug, el);
                    else iframeRefs.current.delete(v.slug);
                  }}
                  src={previewUrl(projectId, v.path, refreshKey, rootPath)}
                  style={{
                    width: DESIGN_W,
                    height: DESIGN_H,
                    border: 'none',
                    background: '#fff',
                    display: 'block',
                    // canvas 模式整个就是 hand,iframe 始终非交互让 drag 透过去
                    pointerEvents: writingActive || pz.dragging ? 'none' : 'auto',
                  }}
                  title={`preview ${v.slug}`}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* zoom pill */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          zIndex: 5,
          display: 'flex',
          gap: 6,
          alignItems: 'center',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            background: 'rgba(0,0,0,0.4)',
            borderRadius: 4,
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            color: '#fff',
            overflow: 'hidden',
          }}
          title="拖动 = 平移 · ⌘/Ctrl + 滚轮 = 缩放 · ⌘0 = 重置 · 双击 ⤢ = focus 单变体"
        >
          <button onClick={() => pz.zoomBy(0.8)} style={zoomBtn} title="缩小 (⌘-)">−</button>
          <span style={{ padding: '4px 6px', minWidth: 36, textAlign: 'center' }}>
            {pz.isFree ? `${Math.round(pz.scale * 100)}%` : 'fit'}
          </span>
          <button onClick={() => pz.zoomBy(1.25)} style={zoomBtn} title="放大 (⌘+)">+</button>
          {pz.isFree && (
            <button onClick={() => pz.reset()} style={zoomBtn} title="回到 fit-to-view(⌘0)">
              ⤢
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function VariantSwitcher({
  variants,
  active,
  onChange,
  disabled,
}: {
  variants: VariantInfo[];
  active: string | null;
  onChange: (slug: string) => void;
  disabled?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 2,
        background: 'var(--bg-elevated)',
        padding: 2,
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border-subtle)',
        opacity: disabled ? 0.4 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
      }}
    >
      {variants.map((v, i) => {
        const letter = String.fromCharCode(65 + i); // A / B / C ...
        const isActive = v.slug === active;
        return (
          <button
            key={v.slug}
            onClick={() => onChange(v.slug)}
            title={
              [v.dna && `DNA: ${v.dna}`, v.fits && `Fits: ${v.fits}`, v.tradeoff && `Tradeoff: ${v.tradeoff}`]
                .filter(Boolean)
                .join('\n') || v.slug
            }
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 10px',
              borderRadius: 3,
              fontSize: 'var(--fs-xs)',
              fontFamily: 'var(--font-mono)',
              color: isActive ? 'var(--text-primary)' : 'var(--text-tertiary)',
              background: isActive ? 'var(--bg-base)' : 'transparent',
            }}
          >
            <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{letter}</span>
            <span style={{ maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {v.displayName}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SelectionBadge({
  ancestry,
  onClear,
}: {
  ancestry: string;
  onClear: () => void;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        left: 16,
        padding: '4px 10px',
        background: 'rgba(255, 164, 81, 0.95)',
        color: '#1a1410',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--fs-xs)',
        borderRadius: 'var(--radius-sm)',
        zIndex: 15,
        boxShadow: 'var(--shadow-md)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <span style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {ancestry}
      </span>
      <button
        onClick={onClear}
        style={{ color: '#1a1410', fontSize: 'var(--fs-xs)' }}
      >
        ✕
      </button>
    </div>
  );
}

function WritingOverlay({ file }: { file?: string }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'var(--bg-overlay)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 12,
        backdropFilter: 'blur(2px)',
        zIndex: 10,
      }}
    >
      <div
        style={{
          fontSize: 'var(--fs-xs)',
          letterSpacing: '0.3em',
          color: 'var(--text-tertiary)',
          textTransform: 'uppercase',
        }}
      >
        writing
      </div>
      {file && (
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--fs-md)',
            color: 'var(--accent)',
          }}
        >
          {file}
        </div>
      )}
      <Spinner />
    </div>
  );
}

function Spinner() {
  return (
    <>
      <style>
        {`@keyframes aidSpin { to { transform: rotate(360deg); } }`}
      </style>
      <div
        style={{
          width: 20,
          height: 20,
          borderRadius: '50%',
          border: '2px solid var(--border-default)',
          borderTopColor: 'var(--accent)',
          animation: 'aidSpin 0.8s linear infinite',
        }}
      />
    </>
  );
}

interface ConsoleBarProps {
  open: boolean;
  toggle: () => void;
  errorCount: number;
  entries: ConsoleEntry[];
  listRef: React.RefObject<HTMLDivElement>;
  onClear: () => void;
}

function ConsoleBar({
  open,
  toggle,
  errorCount,
  entries,
  listRef,
  onClear,
}: ConsoleBarProps) {
  return (
    <div
      style={{
        borderTop: '1px solid var(--border-subtle)',
        background: 'var(--bg-panel)',
        flex: '0 0 auto',
        display: 'flex',
        flexDirection: 'column',
        maxHeight: open ? 240 : 28,
        transition: 'max-height 120ms ease',
        overflow: 'hidden',
      }}
    >
      <div
        onClick={toggle}
        style={{
          height: 28,
          display: 'flex',
          alignItems: 'center',
          padding: '0 var(--sp-3)',
          cursor: 'pointer',
          fontSize: 'var(--fs-xs)',
          color: 'var(--text-tertiary)',
          fontFamily: 'var(--font-mono)',
          userSelect: 'none',
        }}
      >
        <span>{open ? '▾' : '▸'}</span>
        <span style={{ marginLeft: 8 }}>console</span>
        <span style={{ marginLeft: 12, color: errorCount > 0 ? 'var(--error)' : 'var(--text-tertiary)' }}>
          {errorCount > 0 ? `${errorCount} err` : '0 err'}
        </span>
        <span style={{ flex: 1 }} />
        {open && entries.length > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
            style={{
              fontSize: 'var(--fs-xs)',
              color: 'var(--text-tertiary)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            clear
          </button>
        )}
      </div>
      {open && (
        <div
          ref={listRef}
          style={{
            flex: 1,
            overflow: 'auto',
            padding: 'var(--sp-2) var(--sp-3)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--fs-xs)',
          }}
        >
          {entries.length === 0 ? (
            <div style={{ color: 'var(--text-disabled)' }}>(empty)</div>
          ) : (
            entries.map((e, i) => (
              <div
                key={i}
                style={{
                  color:
                    e.level === 'error'
                      ? 'var(--error)'
                      : e.level === 'warn'
                      ? 'var(--warning)'
                      : 'var(--text-secondary)',
                  whiteSpace: 'pre-wrap',
                  paddingBottom: 2,
                }}
              >
                {e.text}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

const zoomBtn: React.CSSProperties = {
  width: 24,
  height: 24,
  display: 'grid',
  placeItems: 'center',
  background: 'rgba(255,255,255,0.06)',
  color: '#fff',
  border: 'none',
  cursor: 'pointer',
  fontSize: 13,
  fontFamily: 'inherit',
  lineHeight: 1,
};
