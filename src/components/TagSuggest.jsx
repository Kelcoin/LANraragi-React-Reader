import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { searchTags, isDBReady, NS_CN_LABELS } from '../lib/tags';
import { getTagSuggestPlacement } from '../lib/tagSuggestLayout';
import { NamespaceGlyph } from './AppGlyphs';

const NS_COLORS = {
  artist: 'var(--tag-artist)',
  parody: 'var(--tag-parody)',
  category: 'var(--tag-category)',
  character: 'var(--tag-character)',
  female: 'var(--tag-female)',
  male: 'var(--tag-male)',
  mixed: 'var(--tag-mixed)',
  other: 'var(--tag-other)',
  group: 'var(--tag-group)',
  series: 'var(--tag-series)',
  language: 'var(--tag-language)',
  uploader: 'var(--tag-uploader)',
  date_added: 'var(--tag-date-added)',
  timestamp: 'var(--tag-timestamp)',
  source: 'var(--tag-source)',
  general: 'var(--tag-general)',
};

export default function TagSuggest({ inputValue, onSelectTag, containerRef, onSetActive }) {
  const [suggestions, setSuggestions] = useState([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [visible, setVisible] = useState(false);
  const listRef = useRef(null);
  const debounceRef = useRef(null);
  const dismissTimerRef = useRef(null);
  const [anchor, setAnchor] = useState(null);

  const updateSuggestions = useCallback((val) => {
    if (!isDBReady()) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        if (typeof val !== 'undefined') updateSuggestions(val);
      }, 300);
      return;
    }

    const raw = (val || '');
    const lastSep = raw.lastIndexOf(',');
    const segment = (lastSep >= 0 ? raw.slice(lastSep + 1) : raw).trim();
    if (segment.length === 0) {
      setSuggestions([]);
      setVisible(false);
      return;
    }

    const results = searchTags(segment);
    if (results.length > 0) {
      setSuggestions(results);
      setVisible(true);
    } else {
      setSuggestions([]);
      setVisible(false);
    }
  }, []);

  useEffect(() => {
    updateSuggestions(inputValue);
    setActiveIndex(-1);
  }, [inputValue, updateSuggestions]);

  useEffect(() => {
    if (onSetActive) onSetActive(visible);
  }, [visible, onSetActive]);

  const isNarrow = typeof window !== 'undefined' && window.innerWidth < 600;

  useEffect(() => {
    if (!visible || !containerRef?.current) { setAnchor(null); return undefined; }
    const update = () => {
      const rect = containerRef.current.getBoundingClientRect();
      const visualViewport = window.visualViewport;
      const viewportLeft = visualViewport?.offsetLeft || 0;
      const viewportTop = visualViewport?.offsetTop || 0;
      const viewportWidth = visualViewport?.width || window.innerWidth;
      const viewportHeight = visualViewport?.height || window.innerHeight;
      setAnchor(getTagSuggestPlacement(rect, window.innerWidth, window.innerHeight, {
        viewportLeft,
        viewportTop,
        viewportRight: viewportLeft + viewportWidth,
        viewportBottom: viewportTop + viewportHeight,
      }));
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, [containerRef, visible]);

  // ── Dismiss on outside click/tap ──
  // Panel uses stopPropagation to prevent events from reaching document.
  // Any event that reaches the document listener is from outside the panel.
  useEffect(() => {
    if (!visible) return;

    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    let armed = false;
    dismissTimerRef.current = setTimeout(() => { armed = true; }, 200);

    const handleDismiss = (e) => {
      if (!armed) return;
      // Allow clicks on the input itself (containerRef)
      if (containerRef?.current && containerRef.current.contains(e.target)) return;
      setVisible(false);
    };

    document.addEventListener('mousedown', handleDismiss);
    document.addEventListener('touchstart', handleDismiss, { passive: true });
    return () => {
      armed = false;
      clearTimeout(dismissTimerRef.current);
      document.removeEventListener('mousedown', handleDismiss);
      document.removeEventListener('touchstart', handleDismiss);
    };
  }, [visible, containerRef]);

  useEffect(() => {
    if (activeIndex >= 0 && listRef.current && visible) {
      const items = listRef.current.querySelectorAll('[data-suggest-index]');
      if (items[activeIndex]) {
        items[activeIndex].scrollIntoView({ block: 'nearest' });
      }
    }
  }, [activeIndex, visible]);

  const selectItem = useCallback((item) => {
    const tag = `${item.ns}:${item.key}$`;
    onSelectTag(tag);
    setVisible(false);
    setSuggestions([]);
  }, [onSelectTag]);

  const handleKeyDown = useCallback((e) => {
    if (!visible || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(prev => (prev + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < suggestions.length) {
        selectItem(suggestions[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      setVisible(false);
    }
  }, [visible, suggestions, activeIndex, selectItem]);

  useEffect(() => {
    if (!visible || !containerRef?.current) return undefined;
    const handleInputKeyDown = (event) => {
      if (event.target !== containerRef.current) return;
      handleKeyDown(event);
    };
    document.addEventListener('keydown', handleInputKeyDown);
    return () => document.removeEventListener('keydown', handleInputKeyDown);
  }, [containerRef, handleKeyDown, visible]);

  if (!visible || suggestions.length === 0 || !anchor) return null;

  return createPortal(
      <div
        ref={listRef}
        className="dropdown-animate no-scrollbar tag-suggest-panel popover"
        data-filter-popover="true"
        style={anchor}
        onKeyDown={handleKeyDown}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
      >
        {suggestions.map((item, idx) => {
          const ns = item.ns;
          const key = item.key;
          const label = item.label;
          const tag = `${ns}:${key}$`;
          const nsColor = NS_COLORS[ns] || NS_COLORS.general;
          const nsLabel = (NS_CN_LABELS && NS_CN_LABELS[ns]) || ns;

          // ── Responsive item layout ──
          // Desktop: [badge] [label (flex:1, ellipsis)] [tag]
          // Mobile: row1=[badge][label (flex:1, ellipsis)] / row2=[tag (small, gray)]
          if (isNarrow) {
            return (
              <div
                key={`${ns}|${key}`}
                className={`tag-suggest-option is-narrow${activeIndex === idx ? ' is-active' : ''}`}
                data-suggest-index={idx}
                role="option"
                aria-selected={activeIndex === idx}
                onMouseDown={(e) => { e.preventDefault(); selectItem(item); }}
                onClick={(e) => { e.preventDefault(); selectItem(item); }}
                onMouseEnter={() => setActiveIndex(idx)}
              >
                {/* Row 1: badge + Chinese label */}
                <div className="tag-suggest-option-main">
                  <span className="tag-suggest-badge" style={{ '--tag-suggest-ns-color': nsColor }}>
                    <NamespaceGlyph ns={ns} size={12} color="currentColor" />
                    <span className="tag-suggest-badge-label">{nsLabel}</span>
                  </span>
                  <span className="tag-suggest-label">
                    {label}
                  </span>
                </div>
                {/* Row 2: original tag (small, gray) */}
                <span className="tag-suggest-tag is-mobile-tag">
                  {tag.length > 36 ? tag.slice(0, 36) + '…' : tag}
                </span>
              </div>
            );
          }

          // ── Desktop layout ──
          return (
            <div
              key={`${ns}|${key}`}
              className={`tag-suggest-option${activeIndex === idx ? ' is-active' : ''}`}
              data-suggest-index={idx}
              role="option"
              aria-selected={activeIndex === idx}
              onMouseDown={(e) => { e.preventDefault(); selectItem(item); }}
              onMouseEnter={() => setActiveIndex(idx)}
            >
              <span className="tag-suggest-badge" style={{ '--tag-suggest-ns-color': nsColor }}>
                <NamespaceGlyph ns={ns} size={12} color="currentColor" />
                <span className="tag-suggest-badge-label">{nsLabel}</span>
              </span>
              <span className="tag-suggest-label">
                {label}
              </span>
              <span className="tag-suggest-tag">
                {tag.length > 30 ? tag.slice(0, 30) + '…' : tag}
              </span>
            </div>
          );
        })}
      </div>,
    document.body,
  );
}
