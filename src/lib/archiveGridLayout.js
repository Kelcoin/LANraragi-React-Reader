export const ARCHIVE_CARD_WIDTH = 150;
export const ARCHIVE_CARD_COVER_HEIGHT = 210;
export const ARCHIVE_CARD_TITLE_GAP = 8;
export const ARCHIVE_CARD_TITLE_SLOT_HEIGHT = 43.7;
export const ARCHIVE_CARD_META_GAP = 6;
export const ARCHIVE_CARD_META_ROW_HEIGHT = 14.85;

export function getWideArchiveCardWidth(gap = 16) {
  const safeGap = Number.isFinite(gap) && gap >= 0 ? gap : 16;
  return ARCHIVE_CARD_WIDTH * 2 + safeGap;
}

export const WIDE_ARCHIVE_CARD_WIDTH = getWideArchiveCardWidth();

export function getArchiveCardMove(previousRect, nextRect, animationOffset = null) {
  if (!previousRect || !nextRect) return null;
  const logicalX = previousRect.left - nextRect.left;
  const logicalY = previousRect.top - nextRect.top;
  if (Math.abs(logicalX) < 0.5 && Math.abs(logicalY) < 0.5) return null;
  return {
    x: logicalX + (animationOffset?.x || 0),
    y: logicalY + (animationOffset?.y || 0),
  };
}

function createFirstFitIndex(capacity) {
  let leafCount = 1;
  while (leafCount < capacity) leafCount *= 2;
  const tree = new Float64Array(leafCount * 2);
  tree.fill(Number.NEGATIVE_INFINITY);

  return {
    find(requiredWidth) {
      if (tree[1] + 0.5 < requiredWidth) return -1;
      let node = 1;
      while (node < leafCount) {
        const left = node * 2;
        node = tree[left] + 0.5 >= requiredWidth ? left : left + 1;
      }
      return node - leafCount;
    },
    update(index, remainingWidth) {
      let node = leafCount + index;
      tree[node] = remainingWidth;
      while (node > 1) {
        node = Math.floor(node / 2);
        tree[node] = Math.max(tree[node * 2], tree[node * 2 + 1]);
      }
    },
  };
}

export function packArchiveGridItems(items, containerWidth, gap = 0) {
  if (!Array.isArray(items) || items.length < 2 || !Number.isFinite(containerWidth) || containerWidth <= 0) {
    return items;
  }

  const safeGap = Number.isFinite(gap) && gap > 0 ? gap : 0;
  const rows = [];
  const firstFit = createFirstFitIndex(items.length);

  for (const item of items) {
    const width = Number.isFinite(item?.width) && item.width > 0 ? item.width : 0;
    const requiredWidth = width + safeGap;
    let rowIndex = firstFit.find(requiredWidth);

    if (rowIndex === -1) {
      rowIndex = rows.length;
      rows.push({ remaining: containerWidth - width, items: [item] });
    } else {
      rows[rowIndex].remaining -= requiredWidth;
      rows[rowIndex].items.push(item);
    }
    firstFit.update(rowIndex, rows[rowIndex].remaining);
  }

  return rows.flatMap((row) => row.items);
}
