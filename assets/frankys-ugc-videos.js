/*
  FRANKY'S (TLF) P4: <frankys-ugc-video> for sections/frankys-ugc-videos.liquid.

  Site speed rules:
  - No <video> in the page: it's created the first time a card plays, with
    preload="none" until then, so nothing downloads for videos nobody watches.
  - Only one video plays at a time across the page.
  - Desktop (hover): plays while the pointer is over a card.
    Touch: plays the card most in view once it's at least 75% visible.
  - Reduced motion, data saver or a 2G connection: nothing plays by itself,
    only on tap.
  - Everything pauses when the row scrolls off screen or the tab is hidden.
*/
const canHover = window.matchMedia('(hover: hover) and (pointer: fine)');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const connection = navigator.connection;

const autoplayAllowed = () =>
  !reducedMotion.matches &&
  !(connection && (connection.saveData || /(^|-)2g$/.test(connection.effectiveType || '')));

let current = null; // the card that's playing

const visibility = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      entry.target.visibleRatio = entry.isIntersecting ? entry.intersectionRatio : 0;
    });

    if (current && current.visibleRatio < 0.5) current.pause();

    // Touch screens: play whichever card is most in view (no hover to go on)
    if (canHover.matches || !autoplayAllowed()) return;

    const cards = [...document.querySelectorAll('frankys-ugc-video[data-src]')];
    const best = cards
      .filter((card) => card.visibleRatio >= 0.75 && !card.userPaused)
      .sort((a, b) => b.visibleRatio - a.visibleRatio)[0];

    if (best && best !== current) best.play();
  },
  { threshold: [0, 0.5, 0.75, 1] }
);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) current?.pause();
});

class FrankysUgcVideo extends HTMLElement {
  connectedCallback() {
    if (!this.dataset.src) return;

    this.visibleRatio = 0;
    this.userPaused = false;
    this.toggle = this.querySelector('.ugc-videos__toggle');

    this.toggle.addEventListener('click', () => {
      if (this.playing) {
        this.userPaused = true;
        this.pause();
      } else {
        this.userPaused = false;
        this.play();
      }
    });

    this.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'mouse' && autoplayAllowed() && !this.userPaused) this.play();
    });

    this.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'mouse' && this === current) this.pause();
    });

    visibility.observe(this);
  }

  disconnectedCallback() {
    visibility.unobserve(this);
    if (this === current) current = null;
  }

  get playing() {
    return this.video ? !this.video.paused : false;
  }

  // Build the <video> on first play only
  get videoElement() {
    if (!this.video) {
      const video = document.createElement('video');
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = 'none';
      video.setAttribute('muted', '');
      video.setAttribute('playsinline', '');
      video.setAttribute('aria-hidden', 'true');
      video.className = 'ugc-videos__video';
      video.src = this.dataset.src;

      video.addEventListener('playing', () => this.setAttribute('playing', ''));
      video.addEventListener('pause', () => this.removeAttribute('playing'));

      this.querySelector('.ugc-videos__media').prepend(video);
      this.video = video;
    }

    return this.video;
  }

  play() {
    if (current && current !== this) current.pause();
    current = this;

    this.videoElement.play().catch(() => {
      // Browser blocked playback (e.g. low power mode): leave the poster showing
      this.removeAttribute('playing');
    });

    this.toggle.setAttribute('aria-pressed', 'true');
  }

  pause() {
    this.video?.pause();
    this.toggle.setAttribute('aria-pressed', 'false');
    if (this === current) current = null;
  }
}

if (!customElements.get('frankys-ugc-video')) {
  customElements.define('frankys-ugc-video', FrankysUgcVideo);
}
