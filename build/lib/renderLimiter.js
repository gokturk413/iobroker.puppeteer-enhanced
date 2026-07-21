"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var renderLimiter_exports = {};
__export(renderLimiter_exports, {
  RenderLimiter: () => RenderLimiter
});
module.exports = __toCommonJS(renderLimiter_exports);
class RenderLimiter {
  /**
   * @param max maximum number of operations allowed to run in parallel (coerced to an integer >= 1)
   */
  constructor(max = 1) {
    this.running = 0;
    this.queue = [];
    this.max = RenderLimiter.normalize(max);
  }
  /** Number of operations currently running (slots in use) */
  get runningCount() {
    return this.running;
  }
  /** Number of callers currently waiting for a free slot */
  get queueLength() {
    return this.queue.length;
  }
  /** The configured maximum parallelism */
  get maxParallel() {
    return this.max;
  }
  /**
   * Coerces an arbitrary value into a valid maximum (integer, at least 1).
   *
   * @param max the desired maximum
   */
  static normalize(max) {
    return Math.max(1, Math.round(Number(max)) || 1);
  }
  /**
   * Updates the maximum parallelism. Increasing it lets currently queued callers
   * proceed immediately if new slots become available.
   *
   * @param max the new maximum (coerced to an integer >= 1)
   */
  setMax(max) {
    this.max = RenderLimiter.normalize(max);
    while (this.running < this.max && this.queue.length) {
      const next = this.queue.shift();
      this.running++;
      next();
    }
  }
  /**
   * Acquires a slot. The returned promise resolves immediately if a slot is free,
   * otherwise once a slot becomes available (FIFO order).
   */
  acquire() {
    if (this.running < this.max) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }
  /**
   * Releases a previously acquired slot and lets the next queued caller proceed.
   * Calling `release()` without a matching `acquire()` is a no-op.
   */
  release() {
    if (this.running > 0) {
      this.running--;
    }
    if (this.running < this.max && this.queue.length) {
      const next = this.queue.shift();
      this.running++;
      next();
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  RenderLimiter
});
//# sourceMappingURL=renderLimiter.js.map
