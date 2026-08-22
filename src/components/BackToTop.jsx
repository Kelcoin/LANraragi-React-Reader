import React, { useEffect, useState } from 'react';

export default function BackToTop({ enabled = true }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setVisible(false);
      return undefined;
    }
    const update = () => setVisible(window.scrollY > 320);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, [enabled]);

  return (
    <button
      type="button"
      aria-label="返回顶部"
      title="返回顶部"
      className={`btn btn-secondary btn-icon back-to-top${visible ? ' is-visible' : ''}`}
      onClick={() => window.scrollTo({ top: 0, left: 0, behavior: 'smooth' })}
    >
      ↑
    </button>
  );
}
