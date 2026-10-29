/*
 * FRANKY'S (TLF) PDP: <complete-the-look> on the product page (snippets/complete-the-look.liquid).
 *
 * Each row is a category. Ticking it picks a piece that matches the product's colour (same range first, then the
 * cheapest range in that exact colour, then the closest colour by swatch) and opens quantity, range and colour
 * choices. Ticked rows add to the set picker's Total and go into the cart with the product in one items[] add,
 * through the theme's own product form so the cart drawer and events behave as usual.
 */
(function () {
  if (customElements.get('complete-the-look')) return;

  // Row choices survive the re-render a colour change triggers, keyed by form id then row number.
  const saved = {};

  const rangeOf = (product) => String(product.title || '').split(' ')[0].toLowerCase();
  const titleCase = (text) => text.charAt(0).toUpperCase() + text.slice(1);

  function hexToRgb(css) {
    const match = /#([0-9a-f]{6}|[0-9a-f]{3})\b/i.exec(css || '');
    if (!match) return null;
    let hex = match[1];
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    return [0, 2, 4].map((i) => parseInt(hex.substr(i, 2), 16));
  }

  function distance(a, b) {
    const x = hexToRgb(a), y = hexToRgb(b);
    if (!x || !y) return 1000;
    return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
  }

  function coversOf(product, rowCovers) {
    if (product.covers != null) return Number(product.covers);
    const match = /set of (\d+)/i.exec(product.title || '');
    return match ? parseInt(match[1], 10) : rowCovers;
  }

  class CompleteTheLook extends HTMLElement {
    connectedCallback() {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.init(), { once: true });
      } else {
        this.init();
      }
    }

    disconnectedCallback() {
      if (this.abort) this.abort.abort();
    }

    init() {
      if (this.ready) return;
      this.ready = true;

      try {
        this.config = JSON.parse(this.querySelector('[data-look-config]').textContent);
      } catch (error) {
        console.error('[complete-the-look] config failed to parse', error);
        return;
      }

      this.formId = this.getAttribute('form');
      this.form = document.getElementById(this.formId);
      this.heroRange = this.dataset.heroRange;
      this.heroColour = this.dataset.heroColour;
      this.heroSwatch = this.dataset.heroSwatch;
      this.setSize = this.readSetSize();
      saved[this.formId] = saved[this.formId] || {};

      this.rows = Array.from(this.querySelectorAll('[data-row]')).map((el) => this.setUpRow(el)).filter(Boolean);

      this.abort = new AbortController();
      const signal = this.abort.signal;

      this.addEventListener('change', (event) => {
        if (!event.target.matches('[data-row-toggle]')) return;
        const row = this.rows.find((r) => r.el.contains(event.target));
        if (row) this.toggle(row, event.target.checked);
      }, { signal });

      this.addEventListener('click', (event) => this.onClick(event), { signal });

      document.addEventListener('set:change', (event) => {
        if (!this.form || !this.form.contains(event.target)) return;
        this.setSize = event.detail.quantity;
        this.rows.forEach((row) => { if (!row.manualUnits && row.selected) row.units = this.defaultUnits(row); this.renderRow(row); });
        this.refreshTotal();
      }, { signal });

      // Before the theme's own submit handler (capture on an ancestor), so one items[] add carries everything.
      if (this.form) {
        this.form.parentElement.addEventListener('submit', (event) => this.beforeSubmit(event), { capture: true, signal });
      }

      this.rows.forEach((row) => this.renderRow(row));
      this.refreshTotal();
    }

    readSetSize() {
      const input = this.form && this.form.querySelector('[data-set-quantity]');
      return input ? parseInt(input.value, 10) || 1 : 1;
    }

    setUpRow(el) {
      let data;
      try { data = JSON.parse(el.querySelector('[data-row-products]').textContent); } catch (e) { return null; }

      // Group products into ranges; each range lists its colours with the cheapest available variant per colour.
      const ranges = {};
      data.products.forEach((product) => {
        const key = rangeOf(product);
        const covers = coversOf(product, data.covers);
        const range = ranges[key] || (ranges[key] = { key, name: titleCase(key), colours: {} });
        product.variants.forEach((variant) => {
          if (!variant.available) return;
          const colour = variant.colour;
          const current = range.colours[colour];
          const perSetting = variant.price / Math.max(covers, 1);
          if (!current || perSetting < current.price / Math.max(current.covers, 1)) {
            range.colours[colour] = {
              id: variant.id, price: variant.price, colour, covers, title: product.title,
              swatch: (product.swatches || {})[colour] || ''
            };
          }
        });
      });
      Object.keys(ranges).forEach((key) => { if (!Object.keys(ranges[key].colours).length) delete ranges[key]; });
      if (!Object.keys(ranges).length) return null;

      const row = {
        el, index: el.dataset.row, ranges,
        toggle: el.querySelector('[data-row-toggle]'),
        price: el.querySelector('[data-row-price]'),
        options: el.querySelector('[data-row-options]'),
        fromHtml: el.querySelector('[data-row-price]').innerHTML,
        selected: false, units: 1, manualUnits: false, range: null, colour: null
      };

      this.applyDefaults(row);

      const previous = saved[this.formId][row.index];
      if (previous) {
        row.selected = previous.selected;
        if (previous.manualUnits) { row.units = previous.units; row.manualUnits = true; }
      }
      if (row.selected) row.units = row.manualUnits ? row.units : this.defaultUnits(row);
      row.toggle.checked = row.selected;
      return row;
    }

    // Range and colour that follow the product: same range in the same colour, the cheapest range made in that
    // colour, or the range whose colour is closest to it.
    applyDefaults(row) {
      const ranges = Object.values(row.ranges);
      const heroColour = this.heroColour;
      let pick = null;

      const own = row.ranges[this.heroRange];
      if (own && own.colours[heroColour]) pick = { range: own, colour: heroColour };

      if (!pick) {
        const exact = ranges.filter((r) => r.colours[heroColour])
          .sort((a, b) => a.colours[heroColour].price / Math.max(a.colours[heroColour].covers, 1) - b.colours[heroColour].price / Math.max(b.colours[heroColour].covers, 1));
        if (exact.length) pick = { range: exact[0], colour: heroColour };
      }

      if (!pick) {
        let best = null;
        ranges.forEach((range) => {
          Object.values(range.colours).forEach((option) => {
            const d = distance(option.swatch, this.heroSwatch);
            if (!best || d < best.d) best = { d, range, colour: option.colour };
          });
        });
        pick = best;
      }

      row.range = pick.range.key;
      row.colour = pick.colour;
    }

    current(row) {
      return row.ranges[row.range].colours[row.colour];
    }

    // Quantity choices: one per table (tablecloth), sets (napkins sold in fours), or single pieces (coasters)
    quantityOptions(row) {
      const s = this.config.strings;
      const covers = this.current(row).covers;
      if (covers === 0) return [{ units: 1, label: s.one }, { units: 2, label: s.two }];
      if (covers > 1) {
        const isSetOf = /set of \d+/i.test(this.current(row).title);
        return [1, 2, 3].map((units) => ({
          units,
          label: isSetOf ? s.setOf.replace('{count}', covers * units) : (units === 1 ? s.oneSet : s.sets.replace('{count}', units))
        }));
      }
      const sizes = [2, 4, 6, 8];
      if (!sizes.includes(this.setSize) && this.setSize > 0) sizes.push(this.setSize);
      return sizes.sort((a, b) => a - b).map((units) => ({ units, label: String(units) }));
    }

    defaultUnits(row) {
      const covers = this.current(row).covers;
      if (covers === 0) return 1;
      if (covers > 1) return Math.max(1, Math.ceil(this.setSize / covers));
      return Math.max(1, this.setSize);
    }

    toggle(row, on) {
      row.selected = on;
      if (on && !row.manualUnits) row.units = this.defaultUnits(row);
      this.renderRow(row);
      this.refreshTotal();
    }

    onClick(event) {
      const button = event.target.closest('[data-pick]');
      if (!button) return;
      const row = this.rows.find((r) => r.el.contains(button));
      if (!row) return;
      const [kind, value] = [button.dataset.pick, button.dataset.value];

      if (kind === 'units') {
        row.units = parseInt(value, 10);
        row.manualUnits = true;
      } else if (kind === 'range') {
        row.range = value;
        const colours = row.ranges[value].colours;
        if (!colours[row.colour]) {
          row.colour = Object.values(colours).sort((a, b) => distance(a.swatch, this.heroSwatch) - distance(b.swatch, this.heroSwatch))[0].colour;
        }
        if (!row.manualUnits) row.units = this.defaultUnits(row);
      } else if (kind === 'colour') {
        row.colour = value;
      }

      this.renderRow(row);
      this.refreshTotal();
    }

    renderRow(row) {
      const s = this.config.strings;
      const option = this.current(row);
      saved[this.formId][row.index] = { selected: row.selected, units: row.units, manualUnits: row.manualUnits };

      row.el.classList.toggle('is-selected', row.selected);
      row.options.hidden = !row.selected;
      row.price.innerHTML = row.selected ? this.formatMoney(option.price * row.units) : row.fromHtml;
      if (!row.selected) { row.options.innerHTML = ''; return; }

      const range = row.ranges[row.range];
      const exact = option.colour === this.heroColour;
      const summary = (exact ? s.inColour : s.closestColour).replace('{range}', range.name).replace('{colour}', option.colour);
      const isMix = row.range !== this.heroRange;

      const pills = (kind, items) => items.map((item) =>
        `<button type="button" class="complete-the-look__pill" data-pick="${kind}" data-value="${this.escape(item.value)}" aria-pressed="${item.on}">${item.html}</button>`
      ).join('');

      const quantity = pills('units', this.quantityOptions(row).map((q) => ({ value: q.units, on: q.units === row.units, html: this.escape(q.label) })));

      const ranges = Object.values(row.ranges).sort((a, b) => a.name.localeCompare(b.name));
      const rangePills = ranges.length > 1 ? pills('range', ranges.map((r) => ({
        value: r.key, on: r.key === row.range,
        html: this.escape(r.name) + (r.key !== this.heroRange && !r.colours[this.heroColour] ? ` <span class="complete-the-look__mix">${this.escape(s.mix)}</span>` : '')
      }))) : '';

      const swatches = Object.values(range.colours).map((c) =>
        `<button type="button" class="complete-the-look__swatch" data-pick="colour" data-value="${this.escape(c.colour)}" aria-pressed="${c.colour === row.colour}" aria-label="${this.escape(c.colour)}" title="${this.escape(c.colour)}" style="background: ${this.escape(c.swatch || c.colour)}"></button>`
      ).join('');

      row.options.innerHTML = `
        <p class="complete-the-look__summary text-sm">${this.escape(summary)}${isMix ? ` <span class="complete-the-look__mix">${this.escape(s.mix)}</span>` : ''}</p>
        <div class="complete-the-look__group" role="group" aria-label="${this.escape(s.quantity)}">${quantity}</div>
        ${rangePills ? `<p class="complete-the-look__sub">${this.escape(s.range)}</p><div class="complete-the-look__group" role="group" aria-label="${this.escape(s.range)}">${rangePills}</div>` : ''}
        <p class="complete-the-look__sub">${this.escape(s.colour)}: ${this.escape(option.colour)}</p>
        <div class="complete-the-look__group" role="group" aria-label="${this.escape(s.colour)}">${swatches}</div>`;
    }

    selectedLines() {
      return this.rows.filter((row) => row.selected).map((row) => ({ id: this.current(row).id, quantity: row.units, price: this.current(row).price }));
    }

    // Added to the set picker's Total
    extraCents() {
      return this.selectedLines().reduce((sum, line) => sum + line.price * line.quantity, 0);
    }

    refreshTotal() {
      const setQuantity = this.form && this.form.querySelector('set-quantity');
      if (setQuantity && typeof setQuantity.update === 'function') setQuantity.update(true);
    }

    beforeSubmit(event) {
      if (event.target !== this.form) return;
      const extras = this.selectedLines();
      if (!extras.length) return;

      const idInput = this.form.elements.namedItem('id');
      const quantityInput = this.form.elements.namedItem('quantity');
      const lines = [{ id: idInput.value, quantity: quantityInput ? quantityInput.value : 1 }].concat(extras);

      const added = [];
      lines.forEach((line, index) => {
        ['id', 'quantity'].forEach((key) => {
          const hidden = document.createElement('input');
          hidden.type = 'hidden';
          hidden.name = `items[${index}][${key}]`;
          hidden.value = line[key];
          this.form.appendChild(hidden);
          added.push(hidden);
        });
      });

      // The theme builds its FormData synchronously in its submit handler; put the form back straight after.
      [idInput, quantityInput].forEach((input) => { if (input) input.disabled = true; });
      setTimeout(() => {
        added.forEach((input) => input.remove());
        [idInput, quantityInput].forEach((input) => { if (input) input.disabled = false; });
      });
    }

    escape(value) {
      return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    formatMoney(cents) {
      const fmt = (decimals, thousands, decimal) => {
        const parts = (cents / 100).toFixed(decimals).split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
        return parts.join(decimal);
      };
      return String(this.config.moneyFormat || '${{amount}}').replace(/<[^>]*>/g, '').replace(/\{\{\s*(\w+)\s*\}\}/, (_, key) => {
        switch (key) {
          case 'amount_no_decimals': return fmt(0, ',', '.');
          case 'amount_with_comma_separator': return fmt(2, '.', ',');
          case 'amount_no_decimals_with_comma_separator': return fmt(0, '.', ',');
          default: return fmt(2, ',', '.');
        }
      });
    }
  }

  customElements.define('complete-the-look', CompleteTheLook);
})();
