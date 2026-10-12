/**
 * Tells whether a string is one of a table's own keys, narrowing it to them.
 * @param table - The table whose keys are the allowed values.
 * @param key - The string to test, e.g. a select's value.
 * @returns True when the table has `key` as an own property; inherited names such as `toString` are not keys.
 */
export function isKeyOf<T extends object>(table: T, key: string): key is keyof T & string {
  return Object.hasOwn(table, key);
}
