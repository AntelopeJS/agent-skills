/** Whether `value` is a string. */
export function isText(value) {
  return typeof value === "string";
}

/** Whether `value` is a non-null object, an array included. */
export function isRecord(value) {
  return typeof value === "object" && value !== null;
}

/** Orders strings by UTF-16 code unit, the order `Array.prototype.sort` gives without a comparator. */
export function compareText(left, right) {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}
