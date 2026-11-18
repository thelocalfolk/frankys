/*
 * FRANKY'S (TLF) PDP: on the desktop image grid, picking a colour puts that colour's image first (top left) instead of
 * scrolling the page down to it (Eliza, 18 Nov 2026). The phone carousel keeps the theme's behaviour (it slides).
 * Works with the theme's own "variant:change" event; the theme's scrollIntoView is skipped for that one image only.
 */
(function () {
  if (window.frankysGalleryColour) return;
  window.frankysGalleryColour = true;

  const isGrid = (gallery) => gallery.carousel && !gallery.carousel.isScrollable;

  function moveFirst(gallery, mediaId) {
    const carousel = gallery.querySelector('.product-gallery__carousel');
    const item = carousel && carousel.querySelector(`:scope > [data-media-id="${mediaId}"]`);
    if (!item) return null;
    // Put the previous lead image back in its original place, then lead with the new one
    if (!gallery.frankysOrder) gallery.frankysOrder = Array.from(carousel.children);
    gallery.frankysOrder.forEach((el) => carousel.appendChild(el));
    carousel.prepend(item);
    // Keep the zoom buttons pointing at the right photo (same numbering the theme uses after a re-render)
    let index = 0;
    Array.from(carousel.children).forEach((cell) => {
      if (cell.getAttribute('data-media-type') !== 'image' || cell.hidden) return;
      const button = cell.querySelector('open-lightbox-button');
      if (button) button.setAttribute('image-index', String(index));
      index += 1;
    });
    return item;
  }

  // Capture phase, so this runs before the gallery's own listener on the form
  document.addEventListener('variant:change', (event) => {
    const variant = event.detail && event.detail.variant;
    const media = variant && variant.featured_media;
    if (!media) return;
    const formId = event.target && event.target.getAttribute && event.target.getAttribute('id');
    const gallery = formId && document.querySelector(`product-gallery[form="${formId}"]`);
    if (!gallery || !isGrid(gallery)) return;
    const item = moveFirst(gallery, media.id);
    if (item) {
      item.scrollIntoView = function () {};
      setTimeout(() => { delete item.scrollIntoView; }, 0);
    }
  }, true);

  // On load, lead with the chosen colour's image too (e.g. a link with ?variant=)
  function init() {
    document.querySelectorAll('product-gallery').forEach((gallery) => {
      if (!isGrid(gallery)) return;
      const initial = gallery.querySelector('.product-gallery__media.is-initial');
      if (initial && initial.previousElementSibling) moveFirst(gallery, initial.getAttribute('data-media-id'));
    });
  }
  if (document.readyState === 'complete') init(); else window.addEventListener('load', init, { once: true });
})();
