/* ==========================================================================
   FRANKY'S (TLF) P1 — Build Your Setting
   <setting-builder> reads the JSON in [data-builder-data] (built by
   sections/build-your-setting.liquid) and runs the flow:
   0 look (optional, loads every piece) → 1 shape → 2 colour → 3 how many settings
   → 4 complete the table → 5 add to cart.
   The same element will power the product-page block (P2).
   Cart: follows the theme's own add-to-cart (theme.js ProductForm) so the
   cart drawer opens and refreshes as normal.
   ========================================================================== */
(() => {
  if (window.customElements.get('setting-builder')) return;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tpl = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
  const imgUrl = (src, width) => {
    try {
      const url = new URL(src, window.location.href);
      url.searchParams.set('width', width);
      return url.toString();
    } catch (e) { return src; }
  };
  const root = () => (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';

  function formatMoney(cents, format) {
    const plain = String(format || '${{amount}}').replace(/<[^>]*>/g, '');
    const fmt = (value, decimals, thousands, decimal) => {
      const parts = (value / 100).toFixed(decimals).split('.');
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
      return parts.join(decimal);
    };
    return plain.replace(/\{\{\s*(\w+)\s*\}\}/, (_, key) => {
      switch (key) {
        case 'amount_no_decimals': return fmt(cents, 0, ',', '.');
        case 'amount_with_comma_separator': return fmt(cents, 2, '.', ',');
        case 'amount_no_decimals_with_comma_separator': return fmt(cents, 0, '.', ',');
        default: return fmt(cents, 2, ',', '.');
      }
    });
  }

  class SettingBuilder extends HTMLElement {
    connectedCallback() {
      const dataEl = this.querySelector('[data-builder-data]');
      try {
        this.data = JSON.parse(dataEl.textContent);
      } catch (error) {
        console.error('[setting-builder] Could not read builder data', error);
        return;
      }

      this.uid = this.dataset.sectionId || Math.random().toString(36).slice(2, 8);
      this.strings = this.data.strings;
      this.ranges = new Map(this.data.ranges.map((r) => [r.key, r]));
      this.looks = new Map((this.data.looks || []).map((l) => [l.key, l]));
      // Every coaster the builder knows about — a look can pair one range's placemats with another's coasters.
      this.coasters = [];
      [...this.data.ranges.map((r) => r.coaster), ...(this.data.looks || []).map((l) => l.coaster && l.coaster.product)]
        .forEach((p) => { if (p && !this.coasters.some((c) => c.id === p.id)) this.coasters.push(p); });
      this.activeLook = null;
      this.cartSubtotal = 0;
      this.state = {
        range: null,
        colour: null,
        settings: this.data.defaultSettings || 4,
        customSettings: false,
        coaster: { on: !!this.data.coastersOnByDefault, colour: null, touched: false, product: null },
        addons: {}
      };
      this.data.addons.forEach((a) => {
        this.state.addons[a.key] = { on: !!a.on, product: 0, colour: null, touched: false };
      });

      this.$ = (sel) => this.querySelector(sel);
      this.$$ = (sel) => Array.from(this.querySelectorAll(sel));

      this.bindEvents();
      this.readUrl();
      this.renderAll();
      this.fetchCart();
      this.setupStickyBar();
    }

    /* ---------- data helpers ---------- */
    get range() { return this.ranges.get(this.state.range) || null; }

    variantFor(product, key) {
      return product ? product.variants.find((v) => v.key === key) || null : null;
    }

    pickColour(product, preferredKey) {
      const preferred = this.variantFor(product, preferredKey);
      if (preferred && preferred.available) return preferred.key;
      const firstAvailable = product.variants.find((v) => v.available);
      return (firstAvailable || product.variants[0]).key;
    }

    covers(product) {
      return product.covers === null || product.covers === undefined ? 1 : Number(product.covers);
    }

    qtyFor(product) {
      const covers = this.covers(product);
      if (covers <= 0) return 1;
      return Math.ceil(this.state.settings / covers);
    }

    // The coaster in use: a look's override, else the range's own coaster.
    coasterProduct() {
      return this.state.coaster.product || (this.range && this.range.coaster) || null;
    }

    coasterOptions() {
      const list = [];
      if (this.range && this.range.coaster) list.push(this.range.coaster);
      const override = this.state.coaster.product;
      if (override && !list.some((p) => p.id === override.id)) list.push(override);
      return list;
    }

    setCoasterProduct(product) {
      const own = this.range && this.range.coaster;
      this.state.coaster.product = own && product && own.id === product.id ? null : product;
    }

    addonProduct(addon) {
      const s = this.state.addons[addon.key];
      return addon.products[s.product] || addon.products[0] || null;
    }

    lines() {
      const range = this.range;
      if (!range || !this.state.colour) return [];
      const out = [];
      const placematVariant = this.variantFor(range.placemat, this.state.colour);
      if (placematVariant) out.push({ product: range.placemat, variant: placematVariant, qty: this.state.settings, role: 'placemat' });

      const coaster = this.coasterProduct();
      if (coaster && this.state.coaster.on) {
        const v = this.variantFor(coaster, this.state.coaster.colour);
        if (v) out.push({ product: coaster, variant: v, qty: this.state.settings, role: 'coaster' });
      }

      this.data.addons.forEach((addon) => {
        const s = this.state.addons[addon.key];
        const product = this.addonProduct(addon);
        if (!s.on || !product) return;
        const v = this.variantFor(product, s.colour);
        if (v) out.push({ product, variant: v, qty: this.qtyFor(product), role: addon.key });
      });
      return out;
    }

    settingName() {
      const range = this.range;
      const placematVariant = range && this.variantFor(range.placemat, this.state.colour);
      if (!range || !placematVariant) return '';
      return tpl(this.strings.settingName, { range: range.name, colour: placematVariant.colour, count: this.state.settings });
    }

    money(cents) { return formatMoney(cents, this.data.moneyFormat); }

    /* ---------- state changes ---------- */
    setRange(key, { silent = false } = {}) {
      if (!this.ranges.has(key)) return;
      const firstPick = this.state.range === null;
      this.state.range = key;
      const range = this.range;
      const current = this.variantFor(range.placemat, this.state.colour);
      if (!current || !current.available) this.state.colour = null;
      this.state.coaster.touched = false;
      this.state.coaster.product = null;
      if (this.state.colour) this.syncExtraColours();
      if (!silent) this.track(firstPick ? 'builder_start' : 'builder_step', { step: 'shape', range: key });
    }

    setColour(key, { silent = false } = {}) {
      const range = this.range;
      const v = range && this.variantFor(range.placemat, key);
      if (!v || !v.available) return;
      this.state.colour = key;
      this.syncExtraColours(true);
      if (!silent) this.track('builder_step', { step: 'colour', range: this.state.range, colour: key });
    }

    setSettings(n, { custom } = {}) {
      const max = this.data.maxSettings || 16;
      const value = Math.min(Math.max(parseInt(n, 10) || 1, 1), max);
      this.state.settings = value;
      // Custom mode sticks until a preset count is picked; links/presets use custom only for counts not on offer.
      this.state.customSettings = custom ?? !this.$$('[data-settings-input]').some((i) => i.value === String(value));
    }

    // Coasters and add-ons follow the placemat colour until the shopper changes them by hand.
    syncExtraColours(resetTouched = false) {
      const range = this.range;
      const coaster = this.coasterProduct();
      if (range && coaster && (resetTouched || !this.state.coaster.touched)) {
        this.state.coaster.colour = this.pickColour(coaster, this.state.colour);
        this.state.coaster.touched = false;
      }
      this.data.addons.forEach((addon) => {
        const s = this.state.addons[addon.key];
        const product = this.addonProduct(addon);
        if (!product) return;
        if (resetTouched || !s.touched || !s.colour) {
          s.colour = this.pickColour(product, this.state.colour);
          s.touched = false;
        }
      });
    }

    /* ---------- URL (shareable + prefill from PDPs / Klaviyo) ---------- */
    readUrl() {
      const params = new URLSearchParams(window.location.search);
      this.source = params.get('source') || (document.referrer ? 'referral' : 'direct');
      const range = params.get('range');
      const colour = params.get('colour') || params.get('color');
      const settings = params.get('settings');
      if (settings) this.setSettings(settings);
      if (range && this.ranges.has(range)) {
        this.setRange(range, { silent: true });
        if (colour) this.setColour(colour, { silent: true });
        if (this.state.colour) this.applyPieces({ coaster: params.get('coaster'), add: params.get('add') });
        this.track('builder_prefill_source', { source: this.source, range, colour: this.state.colour });
      }
    }

    // coaster = "<handle>.<colour>" or "none"; add = "<handle>.<colour>,<handle>.<colour>"
    applyPieces({ coaster, add }) {
      const split = (token) => { const [handle, colour] = token.split('.'); return { handle, colour }; };
      if (coaster === 'none') {
        this.state.coaster.on = false;
      } else if (coaster) {
        const { handle, colour } = split(coaster);
        const product = this.coasters.find((p) => p.handle === handle);
        if (product) {
          this.setCoasterProduct(product);
          this.state.coaster.on = true;
          this.state.coaster.colour = this.pickColour(product, colour);
          this.state.coaster.touched = true;
        }
      }
      if (add === null || add === undefined) return;
      this.resetAddons();
      add.split(',').filter(Boolean).forEach((token) => {
        const { handle, colour } = split(token);
        this.turnOnPiece((p) => p.handle === handle, colour);
      });
    }

    resetAddons() {
      this.data.addons.forEach((addon) => {
        const s = this.state.addons[addon.key];
        s.on = false; s.product = 0; s.touched = false;
        s.colour = this.pickColour(this.addonProduct(addon), this.state.colour);
      });
    }

    turnOnPiece(match, colour) {
      const addon = this.data.addons.find((a) => a.products.some(match));
      if (!addon) { console.warn('[setting-builder] Look piece is not in any "Complete the table" block'); return; }
      const s = this.state.addons[addon.key];
      s.on = true;
      s.product = addon.products.findIndex(match);
      s.colour = this.pickColour(addon.products[s.product], colour);
      s.touched = true;
    }

    /* ---------- looks ("Be inspired") ---------- */
    loadLook(key) {
      const look = this.looks.get(key);
      const range = look && this.data.ranges.find((r) => r.placemat.id === look.placemat);
      if (!range) return;

      this.setSettings(look.settings || this.data.defaultSettings);
      this.setRange(range.key, { silent: true });
      this.state.colour = null;
      this.setColour(look.colour, { silent: true });
      if (!this.state.colour) this.state.colour = this.pickColour(range.placemat, look.colour);

      if (look.coaster) {
        this.setCoasterProduct(look.coaster.product);
        this.state.coaster.on = true;
        this.state.coaster.colour = this.pickColour(look.coaster.product, look.coaster.colour);
        this.state.coaster.touched = true;
      } else {
        this.state.coaster.on = false;
      }

      this.resetAddons();
      look.pieces.forEach((piece) => this.turnOnPiece((p) => p.id === piece.product, piece.colour));

      this.activeLook = key;
      this.track('builder_start', { source: 'look', look: look.title });
      this.renderAll({ colours: true, extras: true });
      const status = this.$('[data-look-status]');
      if (status) status.textContent = tpl(this.strings.lookLoaded, { look: look.title });
    }

    // Back to a blank builder: no shape, colour or pieces.
    resetBuilder() {
      this.activeLook = null;
      this.state.range = null;
      this.state.colour = null;
      this.state.settings = this.data.defaultSettings || 4;
      this.state.customSettings = false;
      this.state.coaster = { on: !!this.data.coastersOnByDefault, colour: null, touched: false, product: null };
      this.data.addons.forEach((a) => {
        this.state.addons[a.key] = { on: !!a.on, product: 0, colour: null, touched: false };
      });
      this.track('builder_step', { step: 'reset' });
      this.renderAll({ colours: true, extras: true });
      const status = this.$('[data-look-status]');
      if (status) status.textContent = this.strings.cleared;
      this.$('.sb__presets, [data-step="shape"]')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    clearLook() {
      if (!this.activeLook) return;
      this.activeLook = null;
      const status = this.$('[data-look-status]');
      if (status) status.textContent = '';
    }

    writeUrl() {
      const url = new URL(window.location.href);
      const set = (k, v) => (v ? url.searchParams.set(k, v) : url.searchParams.delete(k));
      set('range', this.state.range);
      set('colour', this.state.colour);
      set('settings', this.state.range ? String(this.state.settings) : null);
      const ready = this.state.range && this.state.colour;
      const coaster = this.coasterProduct();
      set('coaster', ready && coaster ? (this.state.coaster.on ? `${coaster.handle}.${this.state.coaster.colour}` : 'none') : null);
      const add = this.data.addons
        .filter((a) => this.state.addons[a.key].on && this.addonProduct(a))
        .map((a) => `${this.addonProduct(a).handle}.${this.state.addons[a.key].colour}`);
      if (ready) url.searchParams.set('add', add.join(',')); else url.searchParams.delete('add');
      window.history.replaceState(window.history.state, '', url.toString());
    }

    /* ---------- events ---------- */
    bindEvents() {
      this.addEventListener('change', (event) => {
        const t = event.target;
        this.clearLook();
        if (t.matches('[data-range-input]')) {
          this.setRange(t.value);
          this.renderAll({ colours: true, extras: true });
          this.$('[data-step="colour"]')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else if (t.matches('[data-colour-input]')) {
          this.setColour(t.value);
          this.renderAll({ extras: true });
        } else if (t.matches('[data-settings-input]')) {
          const custom = this.$('[data-settings-custom]');
          if (t.value === 'custom') {
            if (custom) { custom.hidden = false; this.setSettings(custom.value, { custom: true }); custom.focus(); custom.select(); }
          } else {
            if (custom) custom.hidden = true;
            this.setSettings(t.value, { custom: false });
          }
          this.track('builder_step', { step: 'settings', settings: this.state.settings });
          this.renderAll({ extras: true });
        } else if (t.matches('[data-extra-toggle]')) {
          const key = t.dataset.extraToggle;
          if (key === 'coaster') this.state.coaster.on = t.checked;
          else this.state.addons[key].on = t.checked;
          this.track('builder_step', { step: 'extras', item: key, on: t.checked });
          this.renderAll({ extras: true });
        } else if (t.matches('[data-extra-product]') && t.dataset.extraProduct === 'coaster') {
          const product = this.coasterOptions()[Number(t.value)];
          this.setCoasterProduct(product);
          this.state.coaster.colour = this.pickColour(product, this.state.coaster.touched ? this.state.coaster.colour : this.state.colour);
          this.renderAll({ extras: true });
        } else if (t.matches('[data-extra-product]')) {
          const addon = this.data.addons.find((a) => a.key === t.dataset.extraProduct);
          const s = this.state.addons[addon.key];
          s.product = Number(t.value);
          s.colour = this.pickColour(this.addonProduct(addon), s.touched ? s.colour : this.state.colour);
          this.renderAll({ extras: true });
        } else if (t.matches('[data-extra-colour]')) {
          const key = t.dataset.extraColour;
          const s = key === 'coaster' ? this.state.coaster : this.state.addons[key];
          s.colour = t.value;
          s.touched = true;
          this.renderAll({ extras: true });
        }
      });

      this.addEventListener('input', (event) => {
        if (event.target.matches('[data-settings-custom]')) {
          if (event.target.value === '') return; // let the shopper clear the box while typing
          this.clearLook();
          this.setSettings(event.target.value, { custom: true });
          this.renderAll({ extras: true });
        }
      });

      this.addEventListener('click', (event) => {
        const atc = event.target.closest('[data-add-to-cart]');
        const look = event.target.closest('[data-look]');
        if (atc) this.addSetting();
        if (look) {
          // Tapping the selected look again clears the whole look.
          if (look.dataset.look === this.activeLook) this.resetBuilder();
          else this.loadLook(look.dataset.look);
        }
        if (event.target.closest('[data-reset]')) this.resetBuilder();
      });
    }

    /* ---------- rendering ---------- */
    renderAll({ colours = true, extras = true } = {}) {
      const range = this.range;
      const hasColour = !!(range && this.state.colour);

      this.$$('[data-range-input]').forEach((input) => { input.checked = input.value === this.state.range; });
      this.$$('[data-look]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.look === this.activeLook)));
      this.$$('[data-reset]').forEach((b) => { b.hidden = !range; });
      this.$('[data-step="colour"]').disabled = !range;
      this.$('[data-step="settings"]').disabled = !hasColour;
      this.$('[data-step="extras"]').disabled = !hasColour;

      if (colours) this.renderColours();
      this.renderSettings();
      if (extras) this.withFocus(() => this.renderExtras());
      this.renderSummary();
      this.renderPreview();
      this.writeUrl();
    }

    // Re-rendering replaces inputs; put focus back on the same control.
    withFocus(fn) {
      const id = document.activeElement && this.contains(document.activeElement) ? document.activeElement.id : null;
      fn();
      if (id) document.getElementById(id)?.focus({ preventScroll: true });
    }

    swatchList(product, selectedKey, name, dataAttr, size = '') {
      return product.variants.map((v) => {
        const id = `${name}-${v.key}`;
        const bg = product.swatches[v.colour] || v.colour.toLowerCase();
        const label = v.available ? v.colour : `${v.colour}, ${this.strings.soldOut.toLowerCase()}`;
        return `<div class="sb__swatch ${size}">
          <input class="sr-only" type="radio" name="${esc(name)}" id="${esc(id)}" value="${esc(v.key)}" ${dataAttr}
            ${v.key === selectedKey ? 'checked' : ''} ${v.available ? '' : 'disabled'}>
          <label for="${esc(id)}" title="${esc(label)}" style="--swatch: ${esc(bg)}">
            <span class="sr-only">${esc(label)}</span>
          </label>
        </div>`;
      }).join('');
    }

    soldOutNote(product) {
      const soldOut = product.variants.filter((v) => !v.available);
      if (!soldOut.length) return '';
      const links = soldOut.map((v) => `<a class="link" href="${esc(product.url)}?variant=${v.id}">${esc(v.colour)}</a>`).join(', ');
      return `<p class="sb__hint text-xs text-subdued">${esc(this.strings.soldOut)}: ${links} — ${esc(this.strings.notify.toLowerCase())} on the product page.</p>`;
    }

    renderColours() {
      const list = this.$('[data-colour-list]');
      const range = this.range;
      if (!range) { list.innerHTML = ''; return; }
      list.innerHTML = `<div class="sb__swatch-row">${this.swatchList(range.placemat, this.state.colour, `sb-colour-${this.uid}`, 'data-colour-input')}</div>${this.soldOutNote(range.placemat)}`;
    }

    renderSettings() {
      const variant = this.range && this.variantFor(this.range.placemat, this.state.colour);
      this.$('[data-colour-name]').textContent = variant ? `· ${variant.colour}` : '';
      const inputs = this.$$('[data-settings-input]');
      const custom = this.$('[data-settings-custom]');
      const match = this.state.customSettings && custom ? null : inputs.find((i) => i.value === String(this.state.settings));
      if (match) {
        match.checked = true;
        if (custom) custom.hidden = true;
      } else {
        const customRadio = inputs.find((i) => i.value === 'custom');
        if (customRadio) customRadio.checked = true;
        if (custom) { custom.hidden = false; if (document.activeElement !== custom) custom.value = this.state.settings; }
      }
    }

    extraRow({ key, label, product, state, products = null, productIndex = 0 }) {
      const toggleId = `sb-x-${this.uid}-${key}`;
      const qty = this.qtyFor(product);
      const variant = this.variantFor(product, state.colour);
      const price = variant ? this.money(variant.price * qty) : '';
      const thumb = (variant && variant.image) || product.image;
      const covers = this.covers(product);

      let note = '';
      if (state.on) {
        if (covers === 0) note = this.strings.perTable;
        else if (covers > 1) note = tpl(this.strings.packNote, { covers, units: qty, total: qty * covers });
        const placemat = this.variantFor(this.range.placemat, this.state.colour);
        if (!state.touched && placemat) {
          const match = this.variantFor(product, this.state.colour);
          if ((!match || !match.available) && variant) note = `${tpl(this.strings.noMatch, { colour: placemat.colour, picked: variant.colour })} ${note}`.trim();
        }
      }

      const productPicker = products && products.length > 1
        ? `<div class="sb__pills" role="radiogroup" aria-label="${esc(label)}">${products.map((p, i) => {
            const id = `sb-xp-${this.uid}-${key}-${i}`;
            return `<span class="sb__pill"><input class="sr-only" type="radio" name="sb-xp-${this.uid}-${key}" id="${id}" value="${i}" data-extra-product="${esc(key)}" ${i === productIndex ? 'checked' : ''}><label for="${id}">${esc(p.title)}</label></span>`;
          }).join('')}</div>`
        : '';

      return `<div class="sb__extra ${state.on ? 'is-on' : ''}">
        <div class="sb__extra-head">
          <input type="checkbox" class="sb__check" id="${toggleId}" data-extra-toggle="${esc(key)}" ${state.on ? 'checked' : ''}>
          <label for="${toggleId}">
            ${thumb ? `<img class="sb__extra-thumb" src="${esc(imgUrl(thumb, 120))}" alt="" width="48" height="48" loading="lazy">` : ''}
            <span class="sb__extra-name">${esc(label)}</span>
            <span class="sb__extra-meta text-xs text-subdued">${state.on ? `${qty} × ${esc(product.title)} · ${price}` : `from ${this.money(Math.min(...product.variants.map((v) => v.price)))}`}</span>
          </label>
        </div>
        ${state.on ? `<div class="sb__extra-body">
          ${productPicker}
          <div class="sb__swatch-row">${this.swatchList(product, state.colour, `sb-xc-${this.uid}-${key}`, `data-extra-colour="${esc(key)}"`, 'sb__swatch--sm')}</div>
          ${note ? `<p class="sb__hint text-xs text-subdued">${esc(note)}</p>` : ''}
        </div>` : ''}
      </div>`;
    }

    renderExtras() {
      const list = this.$('[data-extras-list]');
      const range = this.range;
      if (!range || !this.state.colour) { list.innerHTML = ''; return; }
      const rows = [];
      const coaster = this.coasterProduct();
      if (coaster) {
        const options = this.coasterOptions();
        const label = range.coaster && coaster.id === range.coaster.id ? `Matching ${range.name} coasters` : 'Coasters';
        rows.push(this.extraRow({ key: 'coaster', label, product: coaster, state: this.state.coaster, products: options, productIndex: options.findIndex((p) => p.id === coaster.id) }));
      }
      this.data.addons.forEach((addon) => {
        const product = this.addonProduct(addon);
        if (!product) return;
        const s = this.state.addons[addon.key];
        if (!s.colour) s.colour = this.pickColour(product, this.state.colour);
        rows.push(this.extraRow({ key: addon.key, label: addon.label, product, state: s, products: addon.products, productIndex: s.product }));
      });
      list.innerHTML = rows.join('');
    }

    renderSummary() {
      const lines = this.lines();
      const total = lines.reduce((sum, l) => sum + l.variant.price * l.qty, 0);
      const ready = lines.length > 0 && lines.every((l) => l.variant.available);
      const list = this.$('[data-summary-lines]');

      if (!lines.length) {
        list.innerHTML = `<li class="text-subdued">${esc(this.range ? this.strings.chooseColour : this.strings.chooseShape)}</li>`;
      } else {
        list.innerHTML = lines.map((l) => `<li class="sb__line ${l.variant.available ? '' : 'is-sold-out'}">
          <span>${l.qty} × ${esc(l.product.title)} <span class="text-subdued">· ${esc(l.variant.colour)}</span>${l.variant.available ? '' : ` <span class="text-subdued">(${esc(this.strings.soldOut)})</span>`}</span>
          <span>${this.money(l.variant.price * l.qty)}</span>
        </li>`).join('');
      }

      const totalText = this.money(total);
      this.$('[data-summary-total]').textContent = totalText;
      this.$$('[data-add-to-cart]').forEach((b) => { b.disabled = !ready; });
      const atcLabel = this.$('[data-atc-label]');
      if (atcLabel) atcLabel.textContent = ready ? `${this.strings.atc} · ${totalText}` : this.strings.atc;
      const barLabel = this.$('[data-bar-label]');
      if (barLabel) barLabel.textContent = this.settingName();
      const barTotal = this.$('[data-bar-total]');
      if (barTotal) barTotal.textContent = totalText;

      this.renderShipping(total);
      this.updateStickyBar();
    }

    renderShipping(total) {
      const box = this.$('[data-shipping]');
      const threshold = Number(this.data.freeShippingThreshold) || 0;
      if (!box || !threshold || !this.data.showShipping || !total) { if (box) box.hidden = true; return; }
      const reached = this.cartSubtotal + total;
      const remaining = threshold - reached;
      box.hidden = false;
      this.$('[data-shipping-text]').textContent = remaining > 0
        ? tpl(this.strings.toFreeShipping, { amount: this.money(remaining) })
        : this.strings.freeShipping;
      this.$('[data-shipping-bar]').style.width = `${Math.min(100, (reached / threshold) * 100)}%`;
    }

    renderPreview() {
      const range = this.range;
      const img = this.$('[data-preview-main]');
      const empty = this.$('[data-preview-empty]');
      const extras = this.$('[data-preview-extras]');
      const caption = this.$('[data-preview-caption]');
      if (!range) {
        img.hidden = true; empty.hidden = false; extras.innerHTML = ''; caption.textContent = '';
        return;
      }
      const placemat = this.variantFor(range.placemat, this.state.colour);
      const src = (placemat && placemat.image) || range.placemat.image;
      if (src) {
        img.src = imgUrl(src, 900);
        img.srcset = [600, 900, 1200].map((w) => `${imgUrl(src, w)} ${w}w`).join(', ');
        img.sizes = '(min-width: 1000px) 50vw, 100vw';
        img.alt = placemat ? `${range.placemat.title} in ${placemat.colour}` : range.placemat.title;
        img.hidden = false; empty.hidden = true;
      }
      extras.innerHTML = this.lines().filter((l) => l.role !== 'placemat').map((l) => {
        const s = l.variant.image || l.product.image;
        return s ? `<li><img src="${esc(imgUrl(s, 200))}" alt="" width="100" height="100" loading="lazy"></li>` : '';
      }).join('');
      caption.textContent = placemat ? `${range.name} · ${placemat.colour}` : range.name;
    }

    /* ---------- sticky mobile bar ---------- */
    setupStickyBar() {
      this.bar = this.$('[data-sticky-bar]');
      const summary = this.$('.sb__summary');
      if (!this.bar || !summary || !('IntersectionObserver' in window)) return;
      this.summaryVisible = false;
      new IntersectionObserver(([entry]) => {
        this.summaryVisible = entry.isIntersecting;
        this.updateStickyBar();
      }).observe(summary);
    }

    updateStickyBar() {
      if (!this.bar) return;
      this.bar.hidden = !(this.state.range && this.state.colour) || this.summaryVisible;
    }

    /* ---------- cart ---------- */
    async fetchCart() {
      try {
        const cart = await (await fetch(`${root()}cart.js`)).json();
        this.cartSubtotal = cart.items_subtotal_price || 0;
        this.renderSummary();
      } catch (e) { /* free-shipping message just ignores the existing cart */ }
    }

    addSetting() {
      const lines = this.lines();
      if (!lines.length) return;
      const name = this.settingName();
      const items = lines.map((l) => ({ id: l.variant.id, quantity: l.qty, properties: { _setting: name } }));
      const total = lines.reduce((sum, l) => sum + l.variant.price * l.qty, 0);
      this.track('builder_add_to_cart', {
        range: this.state.range, colour: this.state.colour, settings: this.state.settings,
        items: items.length, value: total / 100, source: this.source
      });
      this.addToCart(items, this.$$('[data-add-to-cart]'));
    }

    async addToCart(items, buttons = []) {
      const status = this.$('[data-status]');
      const sections = new Set();
      document.documentElement.dispatchEvent(new CustomEvent('cart:prepare-bundled-sections', { bubbles: true, detail: { sections } }));
      buttons.forEach((b) => b.setAttribute('aria-busy', 'true'));
      if (status) status.textContent = this.strings.adding;

      try {
        const response = await fetch(`${root()}cart/add.js`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          body: JSON.stringify({ items, sections: [...sections].join(',') })
        });
        const json = await response.json();

        if (!response.ok) {
          const message = json.description || json.message || 'Something went wrong.';
          if (status) status.textContent = message;
          document.dispatchEvent(new CustomEvent('toast:show', { detail: { message, tone: 'error' } }));
          return;
        }

        const settings = (window.themeVariables && window.themeVariables.settings) || {};
        if (settings.cartType === 'page') {
          window.location.href = `${root()}cart`;
          return;
        }

        const cart = await (await fetch(`${root()}cart.js`)).json();
        cart.sections = json.sections;
        this.cartSubtotal = cart.items_subtotal_price || 0;
        const added = json.items || [json];
        this.dispatchEvent(new CustomEvent('variant:add', { bubbles: true, detail: { items: added, cart } }));
        document.documentElement.dispatchEvent(new CustomEvent('cart:change', { bubbles: true, detail: { baseEvent: 'variant:add', cart } }));
        if (settings.cartType === 'message') {
          document.dispatchEvent(new CustomEvent('toast:show', { detail: { message: this.strings.added } }));
        }
        if (status) status.textContent = this.strings.added;
        this.renderSummary();
      } catch (error) {
        console.error('[setting-builder]', error);
        if (status) status.textContent = 'Something went wrong. Please try again.';
      } finally {
        buttons.forEach((b) => b.removeAttribute('aria-busy'));
      }
    }

    /* ---------- tracking (plan f2) ---------- */
    track(name, payload = {}) {
      const detail = { name, ...payload };
      this.dispatchEvent(new CustomEvent('setting-builder:track', { bubbles: true, detail }));
      try { window.Shopify?.analytics?.publish?.(name, payload); } catch (e) { /* analytics is optional */ }
    }
  }

  window.customElements.define('setting-builder', SettingBuilder);
})();
