let owners = 0;
let previousBodyOverflow = '';
let previousRootOverflow = '';
let previousBodyPaddingRight = '';

export function acquireBodyScrollLock() {
  if (typeof document === 'undefined') return () => {};
  if (owners === 0) {
    previousBodyOverflow = document.body.style.overflow;
    previousRootOverflow = document.documentElement.style.overflow;
    previousBodyPaddingRight = document.body.style.paddingRight;
    const viewportWidth = typeof globalThis.window?.innerWidth === 'number'
      ? globalThis.window.innerWidth
      : Number(document.documentElement.clientWidth) || 0;
    const clientWidth = Number(document.documentElement.clientWidth) || viewportWidth;
    const scrollbarWidth = Math.max(0, viewportWidth - clientWidth);
    const computedStyle = typeof globalThis.getComputedStyle === 'function'
      ? globalThis.getComputedStyle(document.body)
      : null;
    const computedPaddingRight = Number.parseFloat(computedStyle?.paddingRight || document.body.style.paddingRight) || 0;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${computedPaddingRight + scrollbarWidth}px`;
  }
  owners += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    owners = Math.max(0, owners - 1);
    if (owners !== 0) return;
    document.body.style.overflow = previousBodyOverflow;
    document.documentElement.style.overflow = previousRootOverflow;
    document.body.style.paddingRight = previousBodyPaddingRight;
  };
}
