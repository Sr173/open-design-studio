/* iframe 注入脚本 — 由 SW 在 HTML 末尾注入
 *
 * v1:console/error 转发
 * v2:inspect/comment/edit 模式 — hover 描边、click 选中、blur 直改回写
 *
 * 多 tab 隔离:每条 postMessage 必带 projectId(SW 注入的 window.__previewProjectId)
 */
(function () {
  'use strict';
  var pid = window.__previewProjectId || null;

  function send(payload) {
    try {
      window.parent.postMessage(
        Object.assign({ __aidSource: 'preview', projectId: pid }, payload),
        '*'
      );
    } catch (_) {}
  }

  // ============================================================
  // v1: console + error 转发
  // ============================================================
  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (level) {
    var orig = console[level].bind(console);
    console[level] = function () {
      var args = Array.prototype.slice.call(arguments);
      try {
        send({
          type: 'console',
          level: level,
          args: args.map(safeStringify),
          ts: Date.now(),
        });
      } catch (_) {}
      orig.apply(null, args);
    };
  });

  window.addEventListener('error', function (ev) {
    send({
      type: 'error',
      message: String(ev.message || ev.error || ev),
      filename: ev.filename || null,
      lineno: ev.lineno || null,
      colno: ev.colno || null,
      stack: ev.error && ev.error.stack ? String(ev.error.stack) : null,
      ts: Date.now(),
    });
  });

  window.addEventListener('unhandledrejection', function (ev) {
    var reason = ev.reason;
    send({
      type: 'error',
      message:
        'Unhandled rejection: ' +
        (reason && reason.message ? reason.message : String(reason)),
      stack: reason && reason.stack ? String(reason.stack) : null,
      ts: Date.now(),
    });
  });

  // ============================================================
  // v6.2: Cmd/Ctrl + wheel 转发给 host
  // iframe 内部的 wheel 不会冒泡到 host window,必须显式转发
  // ============================================================
  window.addEventListener(
    'wheel',
    function (ev) {
      if (!(ev.ctrlKey || ev.metaKey)) return; // 普通滚动放过 — 让 iframe 内容自然滚
      ev.preventDefault();
      send({
        type: 'wheel_zoom',
        deltaY: ev.deltaY,
        // iframe-local 坐标(相对 iframe 左上)
        ifx: ev.clientX,
        ify: ev.clientY,
        ts: Date.now(),
      });
    },
    { passive: false }
  );

  // 空格按住时,把 iframe 的鼠标事件 "让" 给 host(便于 stage 拖动)
  // 通过 keydown 监听 + body 的 pointer-events 切换实现
  window.addEventListener('keydown', function (e) {
    if (e.code === 'Space' && !e.repeat) {
      document.body.style.pointerEvents = 'none';
    }
  });
  window.addEventListener('keyup', function (e) {
    if (e.code === 'Space') {
      document.body.style.pointerEvents = '';
    }
  });

  // ============================================================
  // v2: 模式系统
  // ============================================================
  var MODE = 'preview'; // 'preview' | 'inspect' | 'comment' | 'edit'
  var hoverEl = null;
  var selectedEl = null;
  var editBlurMap = new WeakMap(); // el → original textContent

  // 注入样式表
  function injectStyles() {
    var style = document.createElement('style');
    style.id = '__aid_styles';
    style.textContent =
      '[data-aid].__aid_hover { outline: 2px solid #ffa451 !important; outline-offset: 1px; }\n' +
      '[data-aid].__aid_selected { outline: 2px solid #ffa451 !important; outline-offset: 2px; box-shadow: 0 0 0 4px rgba(255, 164, 81, 0.18) !important; }\n' +
      '[data-aid][contenteditable="true"]:focus { outline: 2px solid #ffcc66 !important; outline-offset: 1px; }\n' +
      '[data-aid].__aid_locked:hover { outline: 1px dashed rgba(180, 180, 200, 0.6) !important; cursor: not-allowed; }\n';
    document.head.appendChild(style);
  }

  function isElementEditable(el) {
    // 仅含单个 text node 子代,且非空
    if (!el || el.nodeType !== 1) return false;
    if (el.children && el.children.length > 0) return false;
    var hasText = false;
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3) {
        if (n.textContent && n.textContent.trim()) hasText = true;
      } else {
        return false;
      }
    }
    return hasText;
  }

  function getAncestrySnippet(el) {
    var parts = [];
    var cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 6) {
      var tag = cur.tagName.toLowerCase();
      var aid = cur.getAttribute && cur.getAttribute('data-aid');
      var label = tag + (aid ? '#' + aid : '');
      parts.unshift(label);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  function getElementInfo(el) {
    var rect = el.getBoundingClientRect();
    var text = (el.textContent || '').trim().slice(0, 80);
    return {
      aid: el.getAttribute('data-aid'),
      tag: el.tagName.toLowerCase(),
      ancestry: getAncestrySnippet(el),
      textPreview: text,
      editable: isElementEditable(el),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  }

  function clearHover() {
    if (hoverEl) {
      hoverEl.classList.remove('__aid_hover');
      hoverEl = null;
    }
  }

  function clearSelected() {
    if (selectedEl) {
      selectedEl.classList.remove('__aid_selected');
      selectedEl = null;
    }
  }

  function findAidElement(target) {
    var cur = target;
    while (cur && cur.nodeType === 1) {
      if (cur.getAttribute && cur.getAttribute('data-aid')) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  // ===== 事件处理 =====

  function onMouseOver(e) {
    if (MODE !== 'inspect' && MODE !== 'comment') return;
    var el = findAidElement(e.target);
    if (el === hoverEl) return;
    clearHover();
    if (el) {
      hoverEl = el;
      el.classList.add('__aid_hover');
    }
  }

  function onMouseOut(e) {
    if (MODE !== 'inspect' && MODE !== 'comment') return;
    if (hoverEl && !e.relatedTarget) clearHover();
  }

  function onClick(e) {
    if (MODE === 'preview') return;

    if (MODE === 'inspect' || MODE === 'comment') {
      var el = findAidElement(e.target);
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      clearSelected();
      selectedEl = el;
      el.classList.add('__aid_selected');
      send({
        type: MODE === 'inspect' ? 'select' : 'comment_target',
        info: getElementInfo(el),
        ts: Date.now(),
      });
    }
    // edit 模式由 contentEditable 接管,不拦截 click
  }

  function onBlur(e) {
    if (MODE !== 'edit') return;
    var el = e.target;
    if (!el || !el.getAttribute || !el.getAttribute('data-aid')) return;
    if (el.contentEditable !== 'true') return;
    var aid = el.getAttribute('data-aid');
    var before = editBlurMap.get(el);
    var after = (el.textContent || '').trim();
    if (before === undefined) {
      editBlurMap.set(el, after);
      return;
    }
    if (before === after) return;
    editBlurMap.set(el, after);
    send({
      type: 'inline_edit',
      aid: aid,
      tag: el.tagName.toLowerCase(),
      before: before,
      after: after,
      ts: Date.now(),
    });
  }

  function enterEdit() {
    var nodes = document.querySelectorAll('[data-aid]');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (isElementEditable(n)) {
        n.contentEditable = 'true';
        n.spellcheck = false;
        editBlurMap.set(n, (n.textContent || '').trim());
      } else {
        n.classList.add('__aid_locked');
      }
    }
  }

  function exitEdit() {
    var nodes = document.querySelectorAll('[data-aid]');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.contentEditable === 'true') {
        n.contentEditable = 'false';
        n.removeAttribute('contenteditable');
      }
      n.classList.remove('__aid_locked');
    }
  }

  function setMode(next) {
    if (next === MODE) return;
    var prev = MODE;
    MODE = next;
    if (prev === 'edit') exitEdit();
    if (next === 'edit') enterEdit();
    if (next === 'preview') {
      clearHover();
      clearSelected();
    }
  }

  // ===== 安装监听 =====
  function install() {
    injectStyles();
    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('mouseout', onMouseOut, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('blur', onBlur, true);
  }

  // ===== host → iframe 控制消息 =====
  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || typeof d !== 'object') return;
    if (d.__aidTarget !== 'preview') return;
    if (typeof d.projectId === 'number' && d.projectId !== pid) return;
    if (d.type === 'set_mode') {
      setMode(d.mode);
    } else if (d.type === 'clear_selection') {
      clearSelected();
    } else if (d.type === 'get_element_info') {
      // 通过 aid 查
      var el = document.querySelector('[data-aid="' + d.aid + '"]');
      send({
        type: 'element_info_reply',
        requestId: d.requestId,
        info: el ? getElementInfo(el) : null,
      });
    }
  });

  // 准备就绪
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
  send({ type: 'ready', url: location.href });

  // ===== 工具:安全 stringify =====
  function safeStringify(v) {
    if (v == null) return String(v);
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    try {
      var seen = new WeakSet();
      return JSON.stringify(
        v,
        function (_k, val) {
          if (typeof val === 'object' && val !== null) {
            if (seen.has(val)) return '[Circular]';
            seen.add(val);
          }
          if (typeof val === 'function') return '[Function]';
          if (val instanceof Element) return '<' + val.tagName.toLowerCase() + '>';
          return val;
        },
        2
      );
    } catch (_) {
      try {
        return String(v);
      } catch (_) {
        return '[Unserializable]';
      }
    }
  }
})();
