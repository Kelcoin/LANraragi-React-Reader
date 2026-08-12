import React, { useLayoutEffect, useRef, useState } from 'react';
import { metadataTagFontScale, metadataTagReservedWidth } from '../lib/metadataTagLayout';
import { ToolbarGlyph } from './AppGlyphs';

const CHIP_CHROME_WIDTH = 57;

export default function MetadataTagChip({ tag, translatedTag, revealed, onMeasure, onToggle, onCopy, onDelete }) {
  const rootRef = useRef(null);
  const translatedMeasureRef = useRef(null);
  const originalMeasureRef = useRef(null);
  const lastPointerTypeRef = useRef('');
  const [textWidths, setTextWidths] = useState(null);
  const [fontScale, setFontScale] = useState(1);

  useLayoutEffect(() => {
    const translated = Math.ceil(translatedMeasureRef.current?.scrollWidth || 1);
    const original = Math.ceil(originalMeasureRef.current?.scrollWidth || 1);
    setTextWidths(current => (
      current?.translated === translated && current?.original === original
        ? current
        : { translated, original }
    ));
  }, [tag, translatedTag]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return undefined;
    const updateScale = () => {
      const visibleTextWidth = textWidths ? (revealed ? textWidths.original : textWidths.translated) : 1;
      setFontScale(metadataTagFontScale(root.clientWidth - CHIP_CHROME_WIDTH, visibleTextWidth));
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(root);
    return () => observer.disconnect();
  }, [revealed, textWidths]);

  const visibleTextWidth = textWidths ? (revealed ? textWidths.original : textWidths.translated) : 1;
  const reservedWidth = metadataTagReservedWidth(textWidths?.translated, textWidths?.original, CHIP_CHROME_WIDTH);
  const visibleWidth = visibleTextWidth + CHIP_CHROME_WIDTH;

  useLayoutEffect(() => {
    if (reservedWidth !== null) onMeasure?.(tag, reservedWidth);
  }, [onMeasure, reservedWidth, tag]);

  return (
    <span
      className="metadata-tag-slot"
      data-metadata-tag={tag}
      style={{ '--metadata-tag-visible-width': `${visibleWidth}px` }}
      onPointerDown={(event) => { lastPointerTypeRef.current = event.pointerType || ''; }}
    >
      <span
        ref={rootRef}
        className={`btn metadata-tag${revealed ? ' is-revealed' : ''}`}
        style={{
          '--metadata-tag-font-scale': fontScale,
        }}
      >
        <button
          type="button"
          className="metadata-tag-copy"
          aria-label={`复制标签 ${tag}`}
          aria-pressed={revealed}
          title={revealed ? tag : translatedTag}
          onClick={async () => {
            const revealOnTap = !!lastPointerTypeRef.current && lastPointerTypeRef.current !== 'mouse';
            lastPointerTypeRef.current = '';
            if (revealOnTap) onToggle();
            await onCopy();
          }}
        >
          <span className="metadata-tag-labels">
            <span className="metadata-tag-label metadata-tag-label-translated">{translatedTag}</span>
            <span className="metadata-tag-label metadata-tag-label-original">{tag}</span>
          </span>
        </button>
        <button type="button" className="metadata-tag-delete" aria-label={`删除 ${tag}`} title="删除标签" onClick={onDelete}><ToolbarGlyph name="close" size={13} /></button>
        <span ref={translatedMeasureRef} className="metadata-tag-measure" aria-hidden="true">{translatedTag}</span>
        <span ref={originalMeasureRef} className="metadata-tag-measure" aria-hidden="true">{tag}</span>
      </span>
    </span>
  );
}
