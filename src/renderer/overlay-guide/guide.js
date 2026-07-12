'use strict';

const targets = [...document.querySelectorAll('.pin-target')];

window.vaani.onOverlayGuide(({ position, accentColor }) => {
  const accent = /^#[0-9a-f]{6}$/i.test(String(accentColor || '')) ? accentColor : '#e8e9eb';
  document.documentElement.style.setProperty('--accent', accent);
  targets.forEach((target) => target.classList.toggle('active', target.dataset.position === position));
});
