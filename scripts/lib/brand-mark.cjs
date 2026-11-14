/* Original Azkript ribbon geometry shared by app sprites and Windows icons.
 * Copyright (C) 2026 Darren Meng. SPDX-License-Identifier: GPL-3.0-only
 */
'use strict';
const SMALL_OPTICAL_MAX_PX = 32;
const MASTER = {
  start: [8, 22],
  tail: 'M30 5.7C30 4.2 31 3.7 32.8 4.2L37.4 5.7C39.1 6.2 40.3 7 40.3 7.8C40.3 9.1 36.6 10.1 30 11.7Z',
  face: 'M8 22C8 18.4 10.1 16.7 13.6 15.6L35.3 9.1C37.5 8.4 38.9 8 39.7 7.5Q40.3 7.1 40.3 8.1V22.3C40.3 25.5 38.1 27.4 34.6 28.5L14 34.8',
  return: { control1: [10.4, 35.9], control2: [8, 35.2], end: [8, 31.4] },
  back: 'M8 25L40.3 21V41.3C40.3 43 39.2 43.4 37.5 42.9L13.7 36.4C10.1 35.4 8 34.7 8 31.4Z',
  scale: 1,
};
const SMALL = {
  start: [1.75, 7.35],
  tail: 'M10.5 2.1Q10.5 1 11.5 1.3L13.4 1.9Q14.25 2.25 14.25 2.6L10.5 4Z',
  face: 'M1.75 7.35Q1.75 5.8 3.5 5.25L12.55 2.65Q13.7 2.3 14 2Q14.25 1.85 14.25 2.5V7.25Q14.25 8.65 12.6 9.2L4.1 11.8',
  return: { control1: [2.5, 12.3], control2: [1.75, 11.4], end: [1.75, 10.4] },
  back: 'M1.75 8L14.25 6.4V13.6Q14.25 14.5 13.4 14.25L4.1 12.4C2.6 11.95 1.75 11.6 1.75 10.4Z',
  scale: 3,
};
function validateGeometry(g) {
  const { control1, control2, end } = g.return;
  for (const p of [g.start, control1, control2, end]) {
    if (p.length !== 2 || p.some(n => !Number.isFinite(n))) throw new Error('Invalid ribbon return coordinates');
  }
  // Arrive upward and continue upward along the left edge. Reversing direction
  // at this join creates the pointed tip rejected during the artwork review.
  if (control2[0] !== end[0] || end[0] !== g.start[0] || control2[1] <= end[1] || end[1] <= g.start[1]) {
    throw new Error('Ribbon return must join the left edge smoothly without a cusp');
  }
}
function facePath(g) {
  validateGeometry(g);
  const r = g.return;
  return `${g.face}C${r.control1.join(' ')} ${r.control2.join(' ')} ${r.end.join(' ')}Z`;
}
function validateTheme(theme) {
  for (const [field, count] of [['face', 4], ['smallFace', 3], ['back', 3], ['tail', 2]]) {
    if (!Array.isArray(theme[field]) || theme[field].length !== count || theme[field].some(c => !/^#[0-9a-f]{6}$/i.test(c))) {
      throw new Error(`Ribbon theme needs ${count} hex colors for ${field}`);
    }
  }
}
function stops(colors, offsets) {
  return colors.map((color, i) => `<stop offset="${offsets[i]}" stop-color="${color}"/>`).join('');
}
function svg(theme, g) {
  validateTheme(theme);
  const small = g === SMALL;
  const face = facePath(g);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48" role="img" aria-label="Azkript script ribbon">
  <!-- Generated from scripts/lib/brand-mark.cjs and app/brand/palettes.json. Font-free original geometry. -->
  <title>Azkript script ribbon${small ? ' — small optical size' : ''}</title>
  <defs>
    <linearGradient id="ribbon-face" x1="0.1" y1="0" x2="0.85" y2="1">${stops(small ? theme.smallFace : theme.face, small ? [0, .5, 1] : [0, .32, .7, 1])}</linearGradient>
    <linearGradient id="ribbon-back" x1="0.75" y1="0.1" x2="0.1" y2="1">${stops(theme.back, [0, .58, 1])}</linearGradient>
    <linearGradient id="ribbon-tail" x1="0" y1="0" x2="0.8" y2="1">${stops(theme.tail, [0, 1])}</linearGradient>
    <clipPath id="ribbon-back-clip"><path d="${g.back}"/></clipPath>
    ${small ? '' : '<filter id="fold-soft" x="0" y="0" width="48" height="48" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="0.6"/></filter>'}
  </defs>
  <g${small ? ' transform="scale(3)"' : ''}>
    <path id="ribbon-tail-plane" fill="url(#ribbon-tail)" d="${g.tail}"/>
    <path id="ribbon-back-plane" fill="url(#ribbon-back)" d="${g.back}"/>
    ${small ? '' : '<path id="ribbon-contact-shadow" d="M8 31.4C8 35.2 10.4 35.9 14 34.8L34.6 28.5C38.1 27.4 40.3 25.5 40.3 22.3" fill="none" stroke="#702707" stroke-width="1.8" stroke-opacity="0.36" filter="url(#fold-soft)" clip-path="url(#ribbon-back-clip)"/>'}
    <path id="ribbon-front-plane" fill="url(#ribbon-face)" d="${face}"/>
  </g>
</svg>
`.replace(/^[ \t]+$/gm, '');
}
module.exports = { MASTER, SMALL, SMALL_OPTICAL_MAX_PX, validateGeometry, validateTheme, facePath,
  masterSvg: theme => svg(theme, MASTER), smallSvg: theme => svg(theme, SMALL) };
