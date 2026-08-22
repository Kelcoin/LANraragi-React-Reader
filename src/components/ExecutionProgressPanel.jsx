import React from 'react';

export default function ExecutionProgressPanel({ progress }) {
  if (!progress) return null;
  const total = Math.max(1, Number(progress.total) || 1);
  const current = Math.max(0, Math.min(total, Number(progress.current) || 0));
  const percent = current / total * 100;
  return (
    <div className="dedupe-execution-progress workbench-section" aria-live="polite">
      <div className="dedupe-execution-progress-heading">
        <strong>{progress.label}</strong>
        <span>{current} / {total}</span>
      </div>
      <div className="dedupe-execution-progress-detail">{progress.detail || '\u00a0'}</div>
      <div className="dedupe-execution-progress-track" aria-hidden="true">
        <span style={{ transform: `scaleX(${percent / 100})` }} />
      </div>
    </div>
  );
}
