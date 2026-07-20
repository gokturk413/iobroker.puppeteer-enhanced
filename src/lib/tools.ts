/**
 * Tests if the given item is an object
 *
 * @param it Item to test
 */
export function isObject(it: unknown): it is Record<string, unknown> {
    return Object.prototype.toString.call(it) === '[object Object]';
}
