// This is a dummy TypeScript source file
// The actual compiled code is in build/lib/tools.js

export function isObject(it: unknown): it is Record<string, unknown> {
    return Object.prototype.toString.call(it) === "[object Object]";
}
