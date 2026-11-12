export const MIN_MUSHROOM_LEVEL = 3;
export const MUSHROOM_DATA_POLICY = 'large-giant-only-20261112';

/**
 * @param {number} level
 */
export function isUsefulMushroomLevel(level) {
  return level === 3 || level === 4;
}
