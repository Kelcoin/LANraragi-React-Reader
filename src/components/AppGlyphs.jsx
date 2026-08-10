import React from 'react';

const baseWrapStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  lineHeight: 0,
};

function GlyphBase({ size, color = 'currentColor', strokeWidth = 1.8, children, style }) {
  return (
    <span aria-hidden="true" style={{ ...baseWrapStyle, width: size, height: size, color, ...style }}>
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </span>
  );
}

function renderSectionGlyph(name) {
  switch (name) {
    case 'continue':
      return (
        <>
          <rect x="4.5" y="5.5" width="15" height="13" rx="3" fill="currentColor" fillOpacity="0.14" stroke="none" />
          <path d="M7.5 7.5h7a2.5 2.5 0 0 1 2.5 2.5V18" />
          <path d="M7.5 7.5A2.5 2.5 0 0 0 5 10v8" opacity="0.58" />
          <path d="M11.25 5.5v6.4l2-1.5 2 1.5V5.5" />
          <path d="M7.25 18.5h9.5" opacity="0.58" />
        </>
      );
    case 'watchlist':
      return (
        <>
          <rect x="5.5" y="4.75" width="13" height="15.5" rx="2.4" fill="currentColor" fillOpacity="0.12" stroke="none" />
          <path d="M8 5.5h8a2.5 2.5 0 0 1 2.5 2.5v11.5l-6.5-3.25-6.5 3.25V8A2.5 2.5 0 0 1 8 5.5z" />
          <path d="M12 8.7l.85 1.72 1.9.28-1.38 1.34.33 1.9L12 13.05l-1.7.89.33-1.9-1.38-1.34 1.9-.28L12 8.7z" fill="currentColor" fillOpacity="0.22" />
        </>
      );
    case 'random':
      return (
        <>
          <circle cx="12" cy="12" r="7.25" fill="currentColor" fillOpacity="0.1" stroke="none" />
          <path d="M12 4.75v2.1M19.25 12h-2.1M12 19.25v-2.1M4.75 12h2.1" opacity="0.52" />
          <path d="M12 8.25l2.9 3.1L12 17l-2.9-5.65L12 8.25z" />
          <circle cx="17.2" cy="7.2" r="1" fill="currentColor" stroke="none" />
        </>
      );
    case 'archives':
      return (
        <>
          <rect x="5" y="6" width="10.5" height="13" rx="2.2" fill="currentColor" fillOpacity="0.12" stroke="none" />
          <path d="M7.8 8.6h4.8M7.8 11.6h4.8M7.8 14.6h3.2" opacity="0.62" />
          <path d="M15.75 7.25H18a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5h-2.25" />
          <path d="M6.5 6h6a2.5 2.5 0 0 1 2.5 2.5V19" />
        </>
      );
    default:
      return <path d="M12 5v14M5 12h14" />;
  }
}

function renderNamespaceGlyph(ns) {
  switch (ns) {
    case 'artist':
      return (
        <>
          <path d="M15.75 4.75l3.5 3.5-7.6 7.6-3.95.45.45-3.95 7.6-7.6z" />
          <path d="M14.1 6.4l3.5 3.5" opacity="0.6" />
          <circle cx="6.75" cy="17.25" r="1.1" fill="currentColor" stroke="none" />
        </>
      );
    case 'parody':
      return (
        <>
          <path d="M6 7.5A2.5 2.5 0 0 1 8.5 5H18v13H8.5A2.5 2.5 0 0 0 6 20.5V7.5z" />
          <path d="M8.5 5A2.5 2.5 0 0 0 6 7.5V18" opacity="0.6" />
          <path d="M10.5 9.25h4.75M10.5 12h4.75" opacity="0.56" />
        </>
      );
    case 'category':
      return (
        <>
          <path d="M4.75 8.5A2.5 2.5 0 0 1 7.25 6H10l1.7 1.9H18a1.75 1.75 0 0 1 1.75 1.75v6.85A2.5 2.5 0 0 1 17.25 19H7.25a2.5 2.5 0 0 1-2.5-2.5V8.5z" />
          <path d="M4.75 10h15" opacity="0.56" />
        </>
      );
    case 'character':
      return (
        <>
          <circle cx="12" cy="9" r="3" />
          <path d="M6.5 18c1.45-2.2 3.4-3.3 5.5-3.3S16.05 15.8 17.5 18" />
        </>
      );
    case 'female':
      return (
        <>
          <circle cx="11.5" cy="10" r="4" />
          <path d="M11.5 14v5M8.75 16.75h5.5" />
        </>
      );
    case 'male':
      return (
        <>
          <circle cx="10.5" cy="13.5" r="4" />
          <path d="M13.25 10.75L18.5 5.5M15.25 5.5h3.25v3.25" />
        </>
      );
    case 'mixed':
      return (
        <>
          <circle cx="9.25" cy="12" r="3.75" />
          <circle cx="14.75" cy="12" r="3.75" opacity="0.72" />
          <path d="M9.25 15.75v3M7.75 17.25h3" opacity="0.8" />
          <path d="M16.4 9.6l2.6-2.6M17.15 7h1.85v1.85" opacity="0.8" />
        </>
      );
    case 'other':
      return (
        <>
          <path d="M12 5.5l1.35 3.15L16.5 10l-3.15 1.35L12 14.5l-1.35-3.15L7.5 10l3.15-1.35L12 5.5z" />
          <circle cx="17.75" cy="6.75" r="0.9" fill="currentColor" stroke="none" />
          <circle cx="6.25" cy="17.25" r="0.9" fill="currentColor" stroke="none" />
        </>
      );
    case 'group':
      return (
        <>
          <rect x="5" y="10" width="4.5" height="8" rx="1.2" />
          <rect x="9.75" y="7" width="4.5" height="11" rx="1.2" opacity="0.82" />
          <rect x="14.5" y="9.5" width="4.5" height="8.5" rx="1.2" opacity="0.64" />
        </>
      );
    case 'series':
      return (
        <>
          <path d="M6 6.5h10.5a2 2 0 0 1 2 2v9H8a2 2 0 0 0-2 2V6.5z" />
          <path d="M8.5 9h6M8.5 12h6M8.5 15h4" opacity="0.56" />
        </>
      );
    case 'language':
      return (
        <>
          <path d="M6.5 7.25h11A1.75 1.75 0 0 1 19.25 9v6A1.75 1.75 0 0 1 17.5 16.75h-5L8 19v-2.25H6.5A1.75 1.75 0 0 1 4.75 15V9A1.75 1.75 0 0 1 6.5 7.25z" />
          <path d="M8.75 10.25h6.5M8.75 13h4.5" opacity="0.58" />
        </>
      );
    case 'uploader':
      return (
        <>
          <path d="M12 5.5v8.25M8.75 8.75L12 5.5l3.25 3.25" />
          <path d="M5.5 14.75v1.75A2.5 2.5 0 0 0 8 19h8a2.5 2.5 0 0 0 2.5-2.5v-1.75" />
        </>
      );
    case 'date_added':
      return (
        <>
          <rect x="5.5" y="6.5" width="13" height="12" rx="2.2" />
          <path d="M8.75 4.75v3.5M15.25 4.75v3.5M5.5 10h13" />
          <path d="M12 12.25v4M10 14.25h4" opacity="0.72" />
        </>
      );
    case 'timestamp':
      return (
        <>
          <circle cx="12" cy="12" r="6.75" />
          <path d="M12 8.75v3.6l2.6 1.6" />
        </>
      );
    case 'source':
      return (
        <>
          <path d="M9.25 14.75l5.5-5.5" />
          <path d="M11 6.5h7.5V14" />
          <path d="M14 8.75l4.5-4.5" />
          <path d="M5.5 10.25v6a2.25 2.25 0 0 0 2.25 2.25h6" opacity="0.6" />
        </>
      );
    case 'general':
    default:
      return (
        <>
          <path d="M10.5 5.25H6.9A1.9 1.9 0 0 0 5 7.15v3.55l7.85 8.05L19 12.6l-6.15-7.35H10.5z" />
          <circle cx="8.25" cy="8.5" r="1.05" fill="currentColor" stroke="none" />
        </>
      );
  }
}

function renderToolbarGlyph(name) {
  switch (name) {
    case 'back':
      return <path d="M19 12H5M12 19l-7-7 7-7" />;
    case 'close':
      return <path d="M6 6l12 12M18 6 6 18" />;
    case 'history':
      return <path d="M12 8v4l3 3M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />;
    case 'resetProgress':
      return (
        <>
          <path d="M5 8V4.5L2.75 6.75A8.25 8.25 0 1 0 5.1 17.9" />
          <path d="M5 4.5H1.5M8.5 9.25l7 5.5M15.5 9.25l-7 5.5" />
        </>
      );
    case 'quickJump':
      return (
        <>
          <circle cx="12" cy="12" r="8.25" />
          <path d="M14.9 8.1 13.1 13.1 8.1 14.9l1.8-5 5-1.8z" />
          <circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none" />
        </>
      );
    case 'random':
      return <path d="M4 7h2.2c5.6 0 5.6 10 11.6 10H20M17 14l3 3-3 3M4 17h2.2c2.3 0 3.7-1.7 4.9-3.6M14 7.6c1-0.4 2.2-0.6 3.8-0.6H20M17 4l3 3-3 3" />;
    case 'edit':
      return (
        <>
          <path d="M4.75 19.25h3.4L18.8 8.6a1.8 1.8 0 0 0 0-2.55l-.85-.85a1.8 1.8 0 0 0-2.55 0L4.75 15.85v3.4z" />
          <path d="m13.9 6.7 3.4 3.4M4.75 15.85l3.4 3.4" opacity="0.72" />
        </>
      );
    case 'watchlist':
      return <path d="M6 4.5h12v16l-6-3-6 3v-16z" />;
    case 'favorite':
      return <path d="m12 3.8 2.55 5.18 5.72.83-4.14 4.04.98 5.7L12 16.86l-5.11 2.69.98-5.7-4.14-4.04 5.72-.83L12 3.8z" fill="currentColor" fillOpacity="0.16" />;
    case 'comment':
      return <path d="M5.25 5.5h13.5A1.75 1.75 0 0 1 20.5 7.25v7.5a1.75 1.75 0 0 1-1.75 1.75H11l-4.75 3v-3H5.25a1.75 1.75 0 0 1-1.75-1.75v-7.5A1.75 1.75 0 0 1 5.25 5.5z" />;
    case 'check':
      return <path d="m5 12.5 4.2 4.2L19 7" />;
    case 'eyedropper':
      return (
        <>
          <path d="m14.6 5.2 4.2 4.2M16.2 3.6l4.2 4.2" />
          <path d="m13.4 6.4-7.9 7.9-1.1 4.3 4.3-1.1 7.9-7.9a2.25 2.25 0 0 0-3.2-3.2z" />
          <path d="m7.1 14.9 2 2" opacity="0.62" />
        </>
      );
    case 'play':
      return <path d="M5 3l14 9-14 9V3z" />;
    case 'pause':
      return <path d="M10 4H6v16h4V4zM18 4h-4v16h4V4z" />;
    case 'grid':
      return <path d="M3 3h7v7H3V3zM14 3h7v7h-7V3zM14 14h7v7h-7V14zM3 14h7v7H3V14z" />;
    case 'settings':
      return <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />;
    case 'superResolution':
      return (
        <>
          <circle cx="10.6" cy="10.6" r="6.1" />
          <path d="M15.3 15.3 20 20" />
          <path d="M10.6 7.6 11.75 9.85 14.05 10.6l-2.3.75L10.6 13.6l-1.15-2.25-2.3-.75 2.3-.75z" fill="currentColor" stroke="none" />
        </>
      );
    case 'metadata':
      return (
        <>
          <path d="M6.5 4.5h7.25l3.75 3.75v11.25h-11V4.5z" />
          <path d="M13.5 4.75V8.5h3.75" />
          <path d="M8.75 12.25h6.5M8.75 15h4.25" opacity="0.72" />
          <path d="M15.6 14.85l2.05 2.05M16.1 14.35l-2.95 2.95-.45 1.65 1.65-.45 2.95-2.95a.86.86 0 0 0-1.2-1.2z" />
        </>
      );
    case 'upload':
      return (
        <>
          <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" />
          <path d="M5 14.5v4A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5v-4" />
          <path d="M5 14.5h3l1.5 2h5l1.5-2h3" opacity="0.72" />
        </>
      );
    case 'cloudDownload':
      return (
        <>
          <path d="M7.5 18.5H6a4 4 0 0 1-.4-7.98A6.5 6.5 0 0 1 18.2 9a4.75 4.75 0 0 1-.7 9.5H16" />
          <path d="M12 11.5v9M8.75 17.25 12 20.5l3.25-3.25" />
        </>
      );
    case 'external':
      return (
        <>
          <path d="M13.5 5H19v5.5" />
          <path d="M19 5l-8 8" />
          <path d="M10 7H6.75A1.75 1.75 0 0 0 5 8.75v8.5A1.75 1.75 0 0 0 6.75 19h8.5A1.75 1.75 0 0 0 17 17.25V14" opacity="0.82" />
        </>
      );
    case 'reload':
      return (
        <>
          <path d="M19 8V4.5l-2.15 2.15A7.5 7.5 0 1 0 19.2 14" />
          <path d="M19 4.5h-3.5" opacity="0.72" />
        </>
      );
    case 'cover':
      return (
        <>
          <rect x="4" y="5" width="16" height="14" rx="2.5" />
          <path d="M7.5 15.5l3.2-3.4 2.2 2.3 1.5-1.6 2.2 2.7" />
          <circle cx="15.5" cy="9" r="1.2" />
          <path d="M8 3.5h8" opacity="0.6" />
        </>
      );
    case 'fullscreen':
      return <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />;
    case 'fullscreenExit':
      return <path d="M4 8V5a2 2 0 0 1 2-2h3M17 3h2a2 2 0 0 1 2 2v3M4 16v3a2 2 0 0 0 2 2h3M17 21h2a2 2 0 0 0 2-2v-3" />;
    default:
      return <path d="M12 5v14M5 12h14" />;
  }
}

function renderThemeModeGlyph(mode) {
  switch (mode) {
    case 'light':
      return (
        <>
          <circle cx="12" cy="12" r="3.7" fill="currentColor" fillOpacity="0.16" />
          <circle cx="12" cy="12" r="3.15" />
          <path d="M12 3.75v1.7M12 18.55v1.7M4.55 12h-1.7M21.15 12h-1.7M6.75 6.75l-1.2-1.2M18.45 18.45l-1.2-1.2M17.25 6.75l1.2-1.2M5.55 18.45l1.2-1.2" />
        </>
      );
    case 'dark':
      return (
        <>
          <path d="M18.55 15.15A7.1 7.1 0 0 1 8.85 5.45 7.75 7.75 0 1 0 18.55 15.15z" fill="currentColor" fillOpacity="0.12" />
          <path d="M18.55 15.15A7.1 7.1 0 0 1 8.85 5.45 7.75 7.75 0 1 0 18.55 15.15z" />
          <path d="M15.6 5.3l.55 1.25 1.25.55-1.25.55-.55 1.25-.55-1.25-1.25-.55 1.25-.55.55-1.25z" fill="currentColor" stroke="none" />
        </>
      );
    case 'auto':
    default:
      return (
        <>
          <rect x="4.5" y="5.75" width="15" height="10.5" rx="2.2" fill="currentColor" fillOpacity="0.1" />
          <rect x="4.5" y="5.75" width="15" height="10.5" rx="2.2" />
          <path d="M9 20.25h6M12 16.25v4" opacity="0.72" />
          <path d="M8.35 10.65a2.2 2.2 0 0 1 3.75-1.55 2.9 2.9 0 0 0 3.55 3.55 3.85 3.85 0 0 1-7.3-2z" />
        </>
      );
  }
}

const SECTION_GLYPH_COLORS = {
  continue: 'var(--olive)',
  watchlist: 'var(--olive)',
  random: 'var(--accent)',
  archives: 'var(--olive-strong)',
};

export function HomeSectionGlyph({ name, size = 18, color = 'currentColor', style }) {
  return (
    <GlyphBase size={size} color={color} style={style}>
      {renderSectionGlyph(name)}
    </GlyphBase>
  );
}

export function NamespaceGlyph({ ns, size = 13, color = 'currentColor', style }) {
  return (
    <GlyphBase size={size} color={color} strokeWidth={1.7} style={style}>
      {renderNamespaceGlyph(ns)}
    </GlyphBase>
  );
}

export function ToolbarGlyph({ name, size = 20, color = 'currentColor', style }) {
  return (
    <GlyphBase size={size} color={color} strokeWidth={2} style={style}>
      {renderToolbarGlyph(name)}
    </GlyphBase>
  );
}

export function ThemeModeGlyph({ mode = 'auto', size = 18, color = 'currentColor', style }) {
  return (
    <GlyphBase size={size} color={color} strokeWidth={1.85} style={style}>
      {renderThemeModeGlyph(mode)}
    </GlyphBase>
  );
}

export function getSectionGlyphColor(name) {
  return SECTION_GLYPH_COLORS[name] || 'currentColor';
}

export function stripDecoratedLabel(label = '') {
  return label.replace(/^[^A-Za-z\u4e00-\u9fff]+/u, '').trim();
}
