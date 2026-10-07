/* ==========================================================================
   FRANKY'S (TLF) P4: Shop by Colour switcher
   Loaded by sections/frankys-colour-switcher.liquid only.

   Baseline: every tile is a normal link to its colour collection.
   Enhancement: intercept the click, fetch the target collection's breadcrumbs,
   header, heading, filters and grid with the Section Rendering API, swap them in
   place, then pushState to the collection URL. Back / forward re-run the swap.
   If the target page doesn't use the same template (a section comes back empty),
   fall back to a normal page load.
   ========================================================================== */
(() => {
  if (window.customElements.get('colour-switcher')) return;

  const SWAP_SECTIONS = [
    'shopify-section--breadcrumbs',
    'shopify-section--colour-switcher',
    'shopify-section--colour-heading',
    'shopify-section--main-collection'
  ];

  /* Collection description: clamp to N lines with a "Read more" toggle.
     Only clamps when JS runs, so the full text is always in the HTML. */
  const initDescriptions = (root = document) => {
    root.querySelectorAll('[data-colour-description]').forEach((wrapper) => {
      const text = wrapper.querySelector('[data-colour-description-text]');
      const toggle = wrapper.querySelector('[data-colour-description-toggle]');
      if (!text || !toggle || toggle.dataset.ready) return;

      toggle.dataset.ready = 'true';
      text.classList.add('line-clamp');

      requestAnimationFrame(() => {
        if (text.scrollHeight - text.clientHeight < 2) {
          text.classList.remove('line-clamp');
          return;
        }

        toggle.hidden = false;
        toggle.addEventListener('click', () => {
          const expanded = toggle.getAttribute('aria-expanded') === 'true';
          toggle.setAttribute('aria-expanded', String(!expanded));
          text.classList.toggle('line-clamp', expanded);
        });
      });
    });
  };

  class ColourSwitcher extends HTMLElement {
    connectedCallback() {
      this.list = this.querySelector('[data-colour-switcher-list]');
      this.status = this.querySelector('[data-colour-switcher-status]');
      this.currentPath = window.location.pathname;

      this.list.addEventListener('click', (event) => this.onTileClick(event));
      this.querySelector('[data-colour-switcher-prev]')?.addEventListener('click', () => this.scrollTiles(-1));
      this.querySelector('[data-colour-switcher-next]')?.addEventListener('click', () => this.scrollTiles(1));

      this.onPopState = this.onPopState.bind(this);
      window.addEventListener('popstate', this.onPopState);

      // Remember this page so "back" to the first colour also swaps in place
      if (!history.state || !history.state.colourSwitcher) {
        history.replaceState({ ...(history.state || {}), colourSwitcher: true }, '', window.location.href);
      }

      this.revealCurrentTile();
      initDescriptions();
    }

    disconnectedCallback() {
      window.removeEventListener('popstate', this.onPopState);
    }

    get tiles() {
      return Array.from(this.list.querySelectorAll('a[data-colour-handle]'));
    }

    // Scroll the tile row (not the page) so the current colour is visible
    revealCurrentTile() {
      const current = this.list.querySelector('[aria-current="page"]');
      if (!current) return;

      const listRect = this.list.getBoundingClientRect();
      const tileRect = current.getBoundingClientRect();
      if (tileRect.left >= listRect.left && tileRect.right <= listRect.right) return;

      this.list.scrollLeft += tileRect.left - listRect.left - (listRect.width - tileRect.width) / 2;
    }

    scrollTiles(direction) {
      const isRtl = getComputedStyle(this.list).direction === 'rtl';
      this.list.scrollBy({ left: this.list.clientWidth * 0.8 * direction * (isRtl ? -1 : 1), behavior: 'smooth' });
    }

    onTileClick(event) {
      const tile = event.target.closest('a[data-colour-handle]');
      if (!tile || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (window.Shopify?.designMode) return;

      const url = new URL(tile.href);
      if (url.origin !== window.location.origin) return;

      event.preventDefault();
      if (url.pathname === this.currentPath && !window.location.search.includes('filter.')) return;

      this.swap(url, { push: true });
    }

    onPopState() {
      if (window.location.pathname === this.currentPath) return;
      this.swap(new URL(window.location.href), { push: false });
    }

    // Keep the preview template (?view=colour) while QA'ing on the dev theme
    pageUrl(url) {
      const pageUrl = new URL(url.pathname, window.location.origin);
      const view = new URLSearchParams(window.location.search).get('view');
      if (view) pageUrl.searchParams.set('view', view);
      return pageUrl;
    }

    async swap(url, { push }) {
      const pageUrl = push ? this.pageUrl(url) : new URL(window.location.href);
      const sections = SWAP_SECTIONS
        .map((className) => document.querySelector(`.shopify-section.${className}`))
        .filter(Boolean);
      const sectionIds = sections.map((section) => section.id.replace('shopify-section-', ''));

      const fetchUrl = new URL(pageUrl);
      fetchUrl.searchParams.set('sections', sectionIds.join(','));

      this.abortController?.abort();
      this.abortController = new AbortController();

      document.documentElement.dispatchEvent(new CustomEvent('theme:loading:start', { bubbles: true }));
      this.setBusy(sections, true);

      let response;
      try {
        response = await (await fetch(fetchUrl.toString(), { signal: this.abortController.signal })).json();
      } catch (error) {
        if (error.name === 'AbortError') return;
        window.location.href = pageUrl.toString();
        return;
      } finally {
        document.documentElement.dispatchEvent(new CustomEvent('theme:loading:end', { bubbles: true }));
      }

      // A missing section means the target uses another template: load it normally
      if (sectionIds.some((id) => !response[id])) {
        window.location.href = pageUrl.toString();
        return;
      }

      sections.forEach((section, index) => {
        const doc = new DOMParser().parseFromString(response[sectionIds[index]], 'text/html');
        const fresh = doc.querySelector('.shopify-section');
        if (!fresh) return;

        if (section.contains(this)) {
          // Don't re-render the tile row (keeps its scroll position and focus):
          // only the header text and the highlighted tile change.
          const intro = section.querySelector('.colour-switcher__intro');
          const freshIntro = fresh.querySelector('.colour-switcher__intro');
          if (intro && freshIntro) intro.replaceWith(document.importNode(freshIntro, true));
          return;
        }

        section.replaceChildren(...document.importNode(fresh, true).childNodes);
      });

      this.setBusy(sections, false);
      this.currentPath = pageUrl.pathname;
      this.updateCurrentTile(pageUrl.pathname);

      if (push) {
        history.pushState({ colourSwitcher: true }, '', pageUrl.toString());
      }

      const title = document.querySelector('[data-colour-document-title]')?.dataset.colourDocumentTitle;
      if (title) document.title = title;

      initDescriptions();

      const heading = document.querySelector('[data-colour-heading]') || document.querySelector('.colour-switcher__intro h1');
      if (this.status && heading) {
        this.status.textContent = '';
        requestAnimationFrame(() => {
          this.status.textContent = heading.textContent.trim();
        });
      }
    }

    updateCurrentTile(pathname) {
      this.tiles.forEach((tile) => {
        const isCurrent = new URL(tile.href).pathname === pathname;
        tile.toggleAttribute('aria-current', isCurrent);
        if (isCurrent) tile.setAttribute('aria-current', 'page');
      });
      this.revealCurrentTile();
    }

    setBusy(sections, busy) {
      sections.forEach((section) => {
        if (section.contains(this)) return;
        section.toggleAttribute('aria-busy', busy);
      });
    }
  }

  window.customElements.define('colour-switcher', ColourSwitcher);
})();
