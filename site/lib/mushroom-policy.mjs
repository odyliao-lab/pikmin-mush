export const MIN_MUSHROOM_LEVEL = 2;

/**
 * @param {number} level
 */
export function isUsefulMushroomLevel(level) {
  return Number.isFinite(level) && level >= MIN_MUSHROOM_LEVEL;
}
