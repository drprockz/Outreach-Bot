import React from 'react';

const stroke = (color) => ({
  fill: 'none', stroke: color, strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
});

const PATHS = {
  home: (c) => <path d="M3 10l7-6 7 6v8a1 1 0 01-1 1h-3v-5h-6v5H4a1 1 0 01-1-1z" {...stroke(c)} />,
  radar: (c) => <><circle cx="10" cy="10" r="7" {...stroke(c)} /><circle cx="10" cy="10" r="3.5" {...stroke(c)} /><circle cx="10" cy="10" r="1" fill={c} /><path d="M10 10l5-5" {...stroke(c)} /></>,
  leads: (c) => <><circle cx="7" cy="7" r="3" {...stroke(c)} /><path d="M2 17c0-2.8 2.2-5 5-5s5 2.2 5 5" {...stroke(c)} /><circle cx="14" cy="8" r="2.4" {...stroke(c)} /><path d="M11 17c0-1.6 1.3-3.5 3-3.5s3 1.4 3 3.5" {...stroke(c)} /></>,
  mail: (c) => <><rect x="2.5" y="4.5" width="15" height="11" rx="1.5" {...stroke(c)} /><path d="M3 6l7 5 7-5" {...stroke(c)} /></>,
  reply: (c) => <><path d="M9 5L3 10l6 5" {...stroke(c)} /><path d="M3 10h8a6 6 0 016 6v0" {...stroke(c)} /></>,
  funnel: (c) => <path d="M3 4h14l-5 7v6l-4-2v-4z" {...stroke(c)} />,
  target: (c) => <><circle cx="10" cy="10" r="7" {...stroke(c)} /><circle cx="10" cy="10" r="3.5" {...stroke(c)} /><circle cx="10" cy="10" r="0.5" fill={c} /></>,
  voice: (c) => <><rect x="8" y="3" width="4" height="10" rx="2" {...stroke(c)} /><path d="M5 10c0 2.8 2.2 5 5 5s5-2.2 5-5" {...stroke(c)} /><path d="M10 15v3M7 18h6" {...stroke(c)} /></>,
  spend: (c) => <><circle cx="10" cy="10" r="7" {...stroke(c)} /><path d="M10 5v10M13 7.5c-.5-1-1.7-1.5-3-1.5-1.7 0-3 .9-3 2 0 2.5 6 1.5 6 4 0 1.1-1.3 2-3 2-1.3 0-2.5-.5-3-1.5" {...stroke(c)} /></>,
  health: (c) => <path d="M3 10h3l2-4 4 8 2-4h3" {...stroke(c)} />,
  error: (c) => <><circle cx="10" cy="10" r="7" {...stroke(c)} /><path d="M10 6v5M10 14v.01" {...stroke(c)} /></>,
  log: (c) => <><rect x="3" y="3" width="14" height="14" rx="1.5" {...stroke(c)} /><path d="M6 7h8M6 10h8M6 13h5" {...stroke(c)} /></>,
  settings: (c) => <><circle cx="10" cy="10" r="2.5" {...stroke(c)} /><path d="M10 2v2M10 16v2M16 10h2M2 10h2M14.2 5.8l1.4-1.4M4.4 15.6l1.4-1.4M14.2 14.2l1.4 1.4M4.4 4.4l1.4 1.4" {...stroke(c)} /></>,
  shield: (c) => <><path d="M10 3l6 2v5c0 4-3 7-6 8-3-1-6-4-6-8V5z" {...stroke(c)} /><path d="M7 10l2 2 4-4" {...stroke(c)} /></>,
  users: (c) => <><circle cx="7" cy="7" r="3" {...stroke(c)} /><circle cx="14" cy="8" r="2.4" {...stroke(c)} /><path d="M2 17c0-2.8 2.2-5 5-5s5 2.2 5 5M11 17c0-1.6 1.3-3.5 3-3.5s3 1.4 3 3.5" {...stroke(c)} /></>,
  metrics: (c) => <path d="M3 17V8M9 17V4M15 17v-7" {...stroke(c)} />,
  chevron: (c) => <path d="M7 5l5 5-5 5" {...stroke(c)} />,
  chevronDown: (c) => <path d="M5 8l5 5 5-5" {...stroke(c)} />,
  chevronUp: (c) => <path d="M5 12l5-5 5 5" {...stroke(c)} />,
  arrowRight: (c) => <path d="M4 10h12M11 5l5 5-5 5" {...stroke(c)} />,
  arrowLeft: (c) => <path d="M16 10H4M9 15l-5-5 5-5" {...stroke(c)} />,
  plus: (c) => <path d="M10 4v12M4 10h12" {...stroke(c)} />,
  x: (c) => <path d="M5 5l10 10M15 5L5 15" {...stroke(c)} />,
  check: (c) => <path d="M4 10l4 4 8-9" {...stroke(c)} />,
  search: (c) => <><circle cx="9" cy="9" r="5" {...stroke(c)} /><path d="M13 13l4 4" {...stroke(c)} /></>,
  filter: (c) => <path d="M3 5h14l-5 6v5l-4-2v-3z" {...stroke(c)} />,
  bookmark: (c) => <path d="M5 3h10v15l-5-3-5 3z" {...stroke(c)} />,
  bell: (c) => <><path d="M5 14V9a5 5 0 0110 0v5l1.5 2H3.5z" {...stroke(c)} /><path d="M8 17a2 2 0 004 0" {...stroke(c)} /></>,
  play: (c) => <path d="M6 4l10 6-10 6z" {...stroke(c)} fill={c} />,
  pause: (c) => <><rect x="5" y="4" width="3" height="12" rx="0.5" fill={c} /><rect x="12" y="4" width="3" height="12" rx="0.5" fill={c} /></>,
  refresh: (c) => <path d="M16 6a7 7 0 10.5 7M16 3v3h-3" {...stroke(c)} />,
  moreH: (c) => <><circle cx="5" cy="10" r="1.2" fill={c} /><circle cx="10" cy="10" r="1.2" fill={c} /><circle cx="15" cy="10" r="1.2" fill={c} /></>,
  moreV: (c) => <><circle cx="10" cy="5" r="1.2" fill={c} /><circle cx="10" cy="10" r="1.2" fill={c} /><circle cx="10" cy="15" r="1.2" fill={c} /></>,
  google: () => <>
    <path d="M17 10.2c0-.6-.05-1.2-.15-1.7H10v3.3h3.9c-.17.95-.7 1.75-1.5 2.3v1.9h2.4c1.4-1.3 2.2-3.2 2.2-5.8z" fill="#4285F4" />
    <path d="M10 17.5c2 0 3.7-.65 4.9-1.8l-2.4-1.9c-.65.45-1.5.7-2.5.7-1.95 0-3.6-1.3-4.2-3.05H3.3v1.95C4.5 15.8 7 17.5 10 17.5z" fill="#34A853" />
    <path d="M5.8 11.45c-.15-.45-.25-.95-.25-1.45s.1-1 .25-1.45V6.6H3.3C2.8 7.6 2.5 8.75 2.5 10s.3 2.4.8 3.4l2.5-1.95z" fill="#FBBC05" />
    <path d="M10 5.5c1.1 0 2.1.4 2.85 1.1l2.15-2.15C13.7 3.25 12 2.5 10 2.5c-3 0-5.5 1.7-6.7 4.1l2.5 1.95C6.4 6.8 8.05 5.5 10 5.5z" fill="#EA4335" />
  </>,
  telegram: (c) => <path d="M17 4L2.5 9.5l4 1.5 1.5 4.5 2.5-2.5L14 16l3-12z" {...stroke(c)} />,
  sparkle: (c) => <path d="M10 3v3M10 14v3M3 10h3M14 10h3M5.5 5.5l2 2M12.5 12.5l2 2M5.5 14.5l2-2M12.5 7.5l2-2" {...stroke(c)} />,
  lock: (c) => <><rect x="4" y="9" width="12" height="8" rx="1.5" {...stroke(c)} /><path d="M7 9V6a3 3 0 016 0v3" {...stroke(c)} /></>,
  unlock: (c) => <><rect x="4" y="9" width="12" height="8" rx="1.5" {...stroke(c)} /><path d="M7 9V6a3 3 0 015.7-1.3" {...stroke(c)} /></>,
  eye: (c) => <><path d="M2 10s2.5-5 8-5 8 5 8 5-2.5 5-8 5-8-5-8-5z" {...stroke(c)} /><circle cx="10" cy="10" r="2.2" {...stroke(c)} /></>,
  impersonate: (c) => <><circle cx="10" cy="7" r="3" {...stroke(c)} /><path d="M3 17c0-3 3-6 7-6s7 3 7 6" {...stroke(c)} /><circle cx="15" cy="15" r="2.5" {...stroke(c)} fill={c} fillOpacity="0.4" /></>,
  bolt: (c) => <path d="M11 2L4 11h5l-1 7 7-9h-5l1-7z" {...stroke(c)} fill={c} fillOpacity="0.2" />,
  warning: (c) => <><path d="M10 3l8 14H2z" {...stroke(c)} /><path d="M10 8v4M10 14v.01" {...stroke(c)} /></>,
  info: (c) => <><circle cx="10" cy="10" r="7" {...stroke(c)} /><path d="M10 9v5M10 6v.01" {...stroke(c)} /></>,
  download: (c) => <path d="M10 3v10M5 9l5 5 5-5M3 17h14" {...stroke(c)} />,
  external: (c) => <path d="M11 4h5v5M16 4l-7 7M14 11v4a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h4" {...stroke(c)} />,
  copy: (c) => <><rect x="6" y="6" width="11" height="11" rx="1.5" {...stroke(c)} /><path d="M3 13V4a1 1 0 011-1h9" {...stroke(c)} /></>,
  trash: (c) => <path d="M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11" {...stroke(c)} />,
  edit: (c) => <path d="M14 3l3 3-9 9H5v-3z" {...stroke(c)} />,
  grip: (c) => <><circle cx="7" cy="6" r="1" fill={c} /><circle cx="13" cy="6" r="1" fill={c} /><circle cx="7" cy="10" r="1" fill={c} /><circle cx="13" cy="10" r="1" fill={c} /><circle cx="7" cy="14" r="1" fill={c} /><circle cx="13" cy="14" r="1" fill={c} /></>,
  calendar: (c) => <><rect x="3" y="4" width="14" height="13" rx="1.5" {...stroke(c)} /><path d="M3 8h14M7 2v4M13 2v4" {...stroke(c)} /></>,
  clock: (c) => <><circle cx="10" cy="10" r="7" {...stroke(c)} /><path d="M10 6v4l3 2" {...stroke(c)} /></>,
  flag: (c) => <path d="M5 17V3M5 4h10l-2 3 2 3H5" {...stroke(c)} />,
  fire: (c) => <path d="M10 17c-3 0-5-2.2-5-5 0-2 1.5-3 2-4.5C7.5 6 7 4 8.5 3c0 2 2 2.5 2 5 1-1 1.5-2 1.5-3 2 1 3 3.5 3 6 0 2.8-2 6-5 6z" {...stroke(c)} />,
  sidebar: (c) => <><rect x="3" y="4" width="14" height="12" rx="1.5" {...stroke(c)} /><path d="M8 4v12" {...stroke(c)} /></>,
};

export default function Icon({ name, size = 16, color = 'currentColor', style }) {
  const draw = PATHS[name];
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      style={{ width: size, height: size, flexShrink: 0, ...style }}
      aria-hidden="true"
    >
      {draw && draw(color)}
    </svg>
  );
}
