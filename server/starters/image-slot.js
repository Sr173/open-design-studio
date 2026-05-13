/* image-slot — drag-and-drop image placeholder web component
 *
 * Usage in HTML:
 *   <image-slot slot-id="hero-bg" aspect="16/9" hint="Drop hero image"></image-slot>
 *   <image-slot slot-id="logo" aspect="1/1" hint="Drop logo"></image-slot>
 *
 * Or with default placeholder behavior:
 *   <image-slot slot-id="avatar" w="80" h="80"></image-slot>
 *
 * Behavior:
 *   - Shows a labeled striped placeholder when empty (skill rule 5: striped > AI image)
 *   - Drop an image file → reads as data URL, persists to <slot-id>:<dataurl> in localStorage
 *     (host can intercept and write to uploads/ if integrated)
 *   - Postmessage signal on drop: { type:'image-slot:set', slotId, dataUrl, size, name }
 *   - Click "clear" link to remove
 *
 * Attributes:
 *   slot-id   (required) — identifier across reloads
 *   aspect    optional   — CSS aspect-ratio, e.g. "16/9", "1/1"
 *   w / h     optional   — fixed pixel dimensions (overrides aspect)
 *   hint      optional   — text shown in empty state (default: "Drop image")
 *   round     optional   — "true" for circular slot (avatar)
 */

(function () {
  'use strict';
  if (customElements.get('image-slot')) return;

  const STORAGE_PREFIX = '__image_slot:';

  class ImageSlot extends HTMLElement {
    static get observedAttributes() {
      return ['slot-id', 'aspect', 'w', 'h', 'hint', 'round'];
    }

    connectedCallback() {
      if (!this._mounted) {
        this._mounted = true;
        this.attachShadow({ mode: 'open' });
        this._render();
        this._bindEvents();
      }
    }

    attributeChangedCallback() {
      if (this._mounted) this._render();
    }

    get slotId() {
      return this.getAttribute('slot-id') || 'unnamed';
    }

    _render() {
      const aspect = this.getAttribute('aspect');
      const w = this.getAttribute('w');
      const h = this.getAttribute('h');
      const hint = this.getAttribute('hint') || 'Drop image';
      const round = this.getAttribute('round') === 'true';

      let sizeCSS = '';
      if (w && h) sizeCSS = `width:${w}px;height:${h}px;`;
      else if (aspect) sizeCSS = `aspect-ratio:${aspect};width:100%;`;
      else sizeCSS = 'min-height:120px;width:100%;';

      const stored = localStorage.getItem(STORAGE_PREFIX + this.slotId);

      this.shadowRoot.innerHTML = `
        <style>
          :host { display: inline-block; ${sizeCSS} }
          .slot {
            width: 100%; height: 100%;
            ${round ? 'border-radius:50%;' : 'border-radius:6px;'}
            border: 1.5px dashed rgba(0,0,0,0.18);
            background: repeating-linear-gradient(
              45deg,
              rgba(0,0,0,0.025),
              rgba(0,0,0,0.025) 10px,
              rgba(0,0,0,0.06) 10px,
              rgba(0,0,0,0.06) 20px
            );
            display: flex; align-items: center; justify-content: center;
            position: relative;
            cursor: pointer;
            transition: border-color 120ms;
            overflow: hidden;
          }
          .slot.dragover { border-color: #ffa451; background: rgba(255,164,81,0.08); }
          .slot.filled { border-style: solid; border-color: rgba(0,0,0,0.08); background: none; }
          .slot img {
            width: 100%; height: 100%;
            object-fit: cover;
            display: block;
          }
          .label {
            font: 11px/1.4 ui-monospace, "SF Mono", Menlo, monospace;
            color: rgba(0,0,0,0.45);
            text-align: center; padding: 4px 8px;
            user-select: none;
          }
          .clear {
            position: absolute; top: 4px; right: 4px;
            background: rgba(0,0,0,0.6); color: #fff;
            font: 10px ui-monospace, monospace;
            border-radius: 3px; padding: 2px 6px;
            cursor: pointer; opacity: 0;
            transition: opacity 120ms;
          }
          .slot.filled:hover .clear { opacity: 1; }
          input[type="file"] { display: none; }
        </style>
        <label class="slot ${stored ? 'filled' : ''}">
          ${stored
            ? `<img src="${stored}" alt="${this.slotId}"><span class="clear" data-clear>× clear</span>`
            : `<span class="label">[ ${this.slotId} ]<br>${hint}</span>`}
          <input type="file" accept="image/*">
        </label>
      `;
    }

    _bindEvents() {
      const slot = this.shadowRoot.querySelector('.slot');
      const fileInput = this.shadowRoot.querySelector('input[type="file"]');

      slot.addEventListener('dragover', (e) => {
        e.preventDefault();
        slot.classList.add('dragover');
      });
      slot.addEventListener('dragleave', () => slot.classList.remove('dragover'));
      slot.addEventListener('drop', (e) => {
        e.preventDefault();
        slot.classList.remove('dragover');
        const f = e.dataTransfer?.files?.[0];
        if (f) this._handleFile(f);
      });

      fileInput.addEventListener('change', (e) => {
        const f = e.target.files?.[0];
        if (f) this._handleFile(f);
      });

      slot.addEventListener('click', (e) => {
        if (e.target.matches('[data-clear]')) {
          e.preventDefault();
          e.stopPropagation();
          localStorage.removeItem(STORAGE_PREFIX + this.slotId);
          this._render();
          window.parent?.postMessage({ type: 'image-slot:clear', slotId: this.slotId }, '*');
        }
      });
    }

    _handleFile(file) {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        try {
          localStorage.setItem(STORAGE_PREFIX + this.slotId, dataUrl);
        } catch (e) {
          console.warn('[image-slot] localStorage quota exceeded', e);
        }
        this._render();
        window.parent?.postMessage({
          type: 'image-slot:set',
          slotId: this.slotId,
          dataUrl,
          size: file.size,
          name: file.name,
        }, '*');
      };
      reader.readAsDataURL(file);
    }
  }

  customElements.define('image-slot', ImageSlot);
  console.log('[image-slot] custom element registered');
})();
