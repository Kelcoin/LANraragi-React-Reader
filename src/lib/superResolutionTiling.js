export const DEFAULT_TILE_CORE = 128;
export const DEFAULT_TILE_PADDING = 18;

function normalizeDimension(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function normalizeTileCore(requested) {
  const number = Number(requested);
  return Number.isFinite(number) && number > 0 ? Math.max(1, Math.floor(number)) : DEFAULT_TILE_CORE;
}

function normalizePadding(options) {
  const number = Number(options.padding ?? DEFAULT_TILE_PADDING);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : DEFAULT_TILE_PADDING;
}

export function createTilePlan(width, height, options = {}) {
  const imageWidth = normalizeDimension(width);
  const imageHeight = normalizeDimension(height);
  const config = options && typeof options === 'object' ? options : {};
  const tileCore = normalizeTileCore(config.tileCore ?? config.tileSize ?? DEFAULT_TILE_CORE);
  const tileCoreWidth = normalizeTileCore(config.tileCoreWidth ?? tileCore);
  const tileCoreHeight = normalizeTileCore(config.tileCoreHeight ?? tileCore);
  const padding = normalizePadding(config);
  const columns = imageWidth > 0 ? Math.ceil(imageWidth / tileCoreWidth) : 0;
  const rows = imageHeight > 0 ? Math.ceil(imageHeight / tileCoreHeight) : 0;
  const tiles = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = column * tileCoreWidth;
      const y = row * tileCoreHeight;
      const coreWidth = Math.min(tileCoreWidth, imageWidth - x);
      const coreHeight = Math.min(tileCoreHeight, imageHeight - y);
      const inputX = Math.max(0, x - padding);
      const inputY = Math.max(0, y - padding);
      const inputRight = Math.min(imageWidth, x + coreWidth + padding);
      const inputBottom = Math.min(imageHeight, y + coreHeight + padding);

      tiles.push({
        index: tiles.length,
        row,
        column,
        core: { x, y, width: coreWidth, height: coreHeight },
        input: {
          x: inputX,
          y: inputY,
          width: inputRight - inputX,
          height: inputBottom - inputY,
        },
      });
    }
  }

  return {
    width: imageWidth,
    height: imageHeight,
    tileCore,
    tileCoreWidth,
    tileCoreHeight,
    padding,
    columns,
    rows,
    tiles,
  };
}

export function getOutputTileRect(tile, scale) {
  const core = tile?.core ?? tile;
  const outputScale = Number(scale);
  if (!core || !Number.isFinite(outputScale) || outputScale <= 0) return null;
  const x = Number(core.x);
  const y = Number(core.y);
  const width = Number(core.width);
  const height = Number(core.height);
  if (![x, y, width, height].every(Number.isFinite) || width < 0 || height < 0) return null;
  return { x: x * outputScale, y: y * outputScale, width: width * outputScale, height: height * outputScale };
}
