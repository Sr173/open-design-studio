/* useCanvasPanZoom — 给 PreviewStage / VariantCanvas 共用的 pan+zoom 引擎
 *
 *  Figma 风:
 *    - 默认 hand mode(preview 模式 / 没有别的工具激活时)→ 左键直接拖 = pan
 *    - 空格临时切 hand,松开恢复(其它模式如 inspect 用)
 *    - 中键 / Cmd+左键 永远 = pan
 *    - ⌘/Ctrl + 滚轮 / Trackpad pinch = 光标锚点缩放
 *    - ⌘0 = reset 回 auto-fit
 *    - ⌘+ / ⌘- = 中心锚点缩放
 *    - F = 全屏
 *
 *  对外:
 *    - { transform, panX, panY, scale, spaceHeld, dragging, isFree, ... } 渲染层用
 *    - zoomAt(cx, cy, deltaY) — host 接收 iframe 转发 wheel_zoom 时调用
 *    - setManualPanScale(...) / reset() — 直接控制
 *
 *  contentSize:design 尺寸(VariantCanvas 算所有 artboard 的 bounding box;单变体 = viewport)
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';

export interface PanZoomOpts {
  /** stage 容器 — wheel / mousedown 监听挂这上面 */
  wrapRef: RefObject<HTMLElement | null>;
  /** 内容设计尺寸 — 算 auto-fit scale 用 */
  contentWidth: number;
  contentHeight: number;
  /** auto-fit padding(每边)*/
  padding?: number;
  /** "hand mode":default-pan 模式;preview 模式传 true */
  handMode?: boolean;
  /** 缩放范围 */
  minScale?: number;
  maxScale?: number;
}

export interface PanZoomState {
  panX: number;
  panY: number;
  scale: number;
  /** 用户已手动操作过(scale 或 pan)*/
  isFree: boolean;
  spaceHeld: boolean;
  dragging: boolean;
}

export interface PanZoomApi extends PanZoomState {
  /** 锚定缩放;cx/cy 是 wrap-local 坐标 */
  zoomAt(cx: number, cy: number, deltaY: number): void;
  /** 锚定缩放;ifx/ify 是 iframe-local 坐标 — 自动转换 */
  zoomAtIframeLocal(ifx: number, ify: number, deltaY: number): void;
  /** 中心锚点缩放(给按钮和 Cmd+/- 用)*/
  zoomBy(factor: number): void;
  /** 重置 manual,回到 auto-fit */
  reset(): void;
  /** 手动覆盖 pan(中键 / 空格 + 拖动 内部调用,通常不需要外部触)*/
  setManualPan(pan: { x: number; y: number }): void;
  /** 手动覆盖 scale */
  setManualScale(s: number): void;
}

export function useCanvasPanZoom(opts: PanZoomOpts): PanZoomApi {
  const {
    wrapRef,
    contentWidth,
    contentHeight,
    padding = 32,
    handMode = false,
    minScale = 0.1,
    maxScale = 4,
  } = opts;

  const [autoFitScale, setAutoFitScale] = useState(1);
  const [autoFitPan, setAutoFitPan] = useState({ x: 0, y: 0 });
  const [manualScale, setManualScaleState] = useState<number | null>(null);
  const [manualPan, setManualPanState] = useState<{ x: number; y: number } | null>(
    null
  );
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [dragging, setDragging] = useState(false);

  // === auto-fit ===
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const recalc = () => {
      const cw = wrap.clientWidth;
      const ch = wrap.clientHeight;
      const sx = (cw - padding) / contentWidth;
      const sy = (ch - padding) / contentHeight;
      const next = Math.min(1, Math.max(minScale, Math.min(sx, sy)));
      setAutoFitScale(next);
      setAutoFitPan({
        x: (cw - contentWidth * next) / 2,
        y: (ch - contentHeight * next) / 2,
      });
    };
    recalc();
    const ro = new ResizeObserver(recalc);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [wrapRef, contentWidth, contentHeight, padding, minScale]);

  // === refs(在原生事件回调里读最新值)===
  const scaleRef = useRef(autoFitScale);
  const panRef = useRef(autoFitPan);
  useEffect(() => {
    scaleRef.current = manualScale ?? autoFitScale;
  }, [manualScale, autoFitScale]);
  useEffect(() => {
    panRef.current = manualPan ?? autoFitPan;
  }, [manualPan, autoFitPan]);
  const draggingRef = useRef(dragging);
  useEffect(() => {
    draggingRef.current = dragging;
  }, [dragging]);
  const spaceHeldRef = useRef(spaceHeld);
  useEffect(() => {
    spaceHeldRef.current = spaceHeld;
  }, [spaceHeld]);
  const handModeRef = useRef(handMode);
  useEffect(() => {
    handModeRef.current = handMode;
  }, [handMode]);

  // === wheel zoom ===
  const zoomAt = useCallback(
    (cx: number, cy: number, deltaY: number) => {
      const cur = scaleRef.current;
      const factor = Math.exp(-deltaY * 0.01);
      const next = Math.max(minScale, Math.min(maxScale, cur * factor));
      if (next === cur) return;
      const p = panRef.current;
      const vx = (cx - p.x) / cur;
      const vy = (cy - p.y) / cur;
      setManualScaleState(next);
      setManualPanState({ x: cx - vx * next, y: cy - vy * next });
    },
    [minScale, maxScale]
  );

  /** iframe-local → wrap-local 再做 zoom(消息来自 iframe 内部的 wheel 转发)*/
  const zoomAtIframeLocal = useCallback(
    (ifx: number, ify: number, deltaY: number) => {
      const p = panRef.current;
      const s = scaleRef.current;
      zoomAt(p.x + ifx * s, p.y + ify * s, deltaY);
    },
    [zoomAt]
  );

  const zoomBy = useCallback(
    (factor: number) => {
      const el = wrapRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const cur = scaleRef.current;
      const next = Math.max(minScale, Math.min(maxScale, cur * factor));
      const p = panRef.current;
      const vx = (cx - p.x) / cur;
      const vy = (cy - p.y) / cur;
      setManualScaleState(next);
      setManualPanState({ x: cx - vx * next, y: cy - vy * next });
    },
    [wrapRef, minScale, maxScale]
  );

  const reset = useCallback(() => {
    setManualScaleState(null);
    setManualPanState(null);
  }, []);

  // === 监听:wheel / keydown / mousedown ===
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [wrapRef, zoomAt]);

  // keyboard
  useEffect(() => {
    const isEditable = (t: EventTarget | null) =>
      t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        setSpaceHeld(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '0') {
        e.preventDefault();
        reset();
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === '+' || e.key === '=' || e.key === '-')) {
        e.preventDefault();
        zoomBy(e.key === '-' ? 0.8 : 1.25);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceHeld(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [reset, zoomBy]);

  // mouse drag pan
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    let startX = 0;
    let startY = 0;
    let startPan = { x: 0, y: 0 };

    const onDown = (e: MouseEvent) => {
      // 触发条件:中键 / 空格+左键 / Cmd+左键 / hand mode + 左键
      const isMiddle = e.button === 1;
      const isSpaceDrag = e.button === 0 && spaceHeldRef.current;
      const isCmdDrag = e.button === 0 && (e.metaKey || e.ctrlKey);
      const isHandDrag = e.button === 0 && handModeRef.current && !e.shiftKey;
      if (!isMiddle && !isSpaceDrag && !isCmdDrag && !isHandDrag) return;
      e.preventDefault();
      startX = e.clientX;
      startY = e.clientY;
      startPan = panRef.current;
      setDragging(true);
    };
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      e.preventDefault();
      setManualPanState({
        x: startPan.x + (e.clientX - startX),
        y: startPan.y + (e.clientY - startY),
      });
      // 进入 free mode(避免 ResizeObserver 又把 auto-fit 推回去)
      if (manualScale === null) setManualScaleState(scaleRef.current);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      setDragging(false);
    };

    el.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      el.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [wrapRef, manualScale]);

  const isFree = manualScale !== null || manualPan !== null;
  const scale = manualScale ?? autoFitScale;
  const pan = manualPan ?? autoFitPan;

  return {
    panX: pan.x,
    panY: pan.y,
    scale,
    isFree,
    spaceHeld,
    dragging,
    zoomAt,
    zoomAtIframeLocal,
    zoomBy,
    reset,
    setManualPan: (p) => setManualPanState(p),
    setManualScale: (s) => setManualScaleState(s),
  };
}
