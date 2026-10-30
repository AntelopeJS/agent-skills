/**
 * Whether `value` is a string.
 * @param {unknown} value
 * @returns {value is string}
 */
export function isText(value) {
  return typeof value === "string";
}

/**
 * Whether `value` is a non-null object, an array included.
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isRecord(value) {
  return typeof value === "object" && value !== null;
}

/**
 * Prints a JSON value the way a template literal would, nothing for a falsy one.
 * @param {unknown} value
 * @returns {string}
 */
export function textIfTruthy(value) {
  const text = String(value);
  return value ? text : "";
}

/**
 * Whether `value` is callable.
 * @param {unknown} value
 * @returns {value is (...args: never[]) => unknown}
 */
export function isCallable(value) {
  return typeof value === "function";
}

/**
 * Orders strings by UTF-16 code unit, the order `Array.prototype.sort` gives without a comparator.
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
export function compareText(left, right) {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}
