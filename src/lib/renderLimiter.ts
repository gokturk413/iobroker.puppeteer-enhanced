/**
 * A simple FIFO concurrency limiter (semaphore).
 *
 * It limits how many operations may run at the same time. Callers `acquire()` a
 * slot before starting work and `release()` it afterwards. If all slots are in
 * use, further callers wait in a queue and are served in first-in-first-out order
 * once a slot becomes free.
 *
 * Used to cap the number of parallel puppeteer render operations so low-memory
 * devices (e.g. a Raspberry Pi) do not run out of RAM.
 */
export class RenderLimiter {
    private max: number;
    private running = 0;
    private readonly queue: (() => void)[] = [];

    /**
     * @param max maximum number of operations allowed to run in parallel (coerced to an integer >= 1)
     */
    public constructor(max = 1) {
        this.max = RenderLimiter.normalize(max);
    }

    /** Number of operations currently running (slots in use) */
    public get runningCount(): number {
        return this.running;
    }

    /** Number of callers currently waiting for a free slot */
    public get queueLength(): number {
        return this.queue.length;
    }

    /** The configured maximum parallelism */
    public get maxParallel(): number {
        return this.max;
    }

    /**
     * Coerces an arbitrary value into a valid maximum (integer, at least 1).
     *
     * @param max the desired maximum
     */
    private static normalize(max: number): number {
        return Math.max(1, Math.round(Number(max)) || 1);
    }

    /**
     * Updates the maximum parallelism. Increasing it lets currently queued callers
     * proceed immediately if new slots become available.
     *
     * @param max the new maximum (coerced to an integer >= 1)
     */
    public setMax(max: number): void {
        this.max = RenderLimiter.normalize(max);
        // If the limit was raised, let waiters use the newly available slots
        while (this.running < this.max && this.queue.length) {
            const next = this.queue.shift()!;
            this.running++;
            next();
        }
    }

    /**
     * Acquires a slot. The returned promise resolves immediately if a slot is free,
     * otherwise once a slot becomes available (FIFO order).
     */
    public acquire(): Promise<void> {
        if (this.running < this.max) {
            this.running++;
            return Promise.resolve();
        }
        return new Promise<void>(resolve => this.queue.push(resolve));
    }

    /**
     * Releases a previously acquired slot and lets the next queued caller proceed.
     * Calling `release()` without a matching `acquire()` is a no-op.
     */
    public release(): void {
        if (this.running > 0) {
            this.running--;
        }
        // Start the next queued caller only if we are within the (possibly lowered) limit
        if (this.running < this.max && this.queue.length) {
            const next = this.queue.shift()!;
            this.running++;
            next();
        }
    }
}
