import { expect } from 'chai';
import { RenderLimiter } from '../../src/lib/renderLimiter';

/** Resolve after the current macrotask queue has been flushed */
const tick = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

describe('RenderLimiter', () => {
    it('normalizes the maximum to an integer >= 1', () => {
        expect(new RenderLimiter().maxParallel).to.equal(1, 'default');
        expect(new RenderLimiter(0).maxParallel).to.equal(1, 'zero -> 1');
        expect(new RenderLimiter(-5).maxParallel).to.equal(1, 'negative -> 1');
        expect(new RenderLimiter(Number.NaN).maxParallel).to.equal(1, 'NaN -> 1');
        expect(new RenderLimiter(2.7).maxParallel).to.equal(3, 'rounds');
        expect(new RenderLimiter(4).maxParallel).to.equal(4);
    });

    it('acquire resolves immediately while slots are free and tracks runningCount', async () => {
        const limiter = new RenderLimiter(2);
        expect(limiter.runningCount).to.equal(0);

        await limiter.acquire();
        expect(limiter.runningCount).to.equal(1);

        await limiter.acquire();
        expect(limiter.runningCount).to.equal(2);
        expect(limiter.queueLength).to.equal(0);
    });

    it('queues callers beyond the limit and serves them in FIFO order on release', async () => {
        const limiter = new RenderLimiter(1);
        const order: number[] = [];

        await limiter.acquire(); // slot taken
        const p2 = limiter.acquire().then(() => order.push(2));
        const p3 = limiter.acquire().then(() => order.push(3));
        expect(limiter.queueLength).to.equal(2);

        limiter.release(); // serves the first waiter (2)
        await p2;
        expect(order).to.deep.equal([2]);

        limiter.release(); // serves the second waiter (3)
        await p3;
        expect(order).to.deep.equal([2, 3]);
    });

    it('never exceeds the configured maximum concurrency', async () => {
        const limiter = new RenderLimiter(2);
        let active = 0;
        let peak = 0;

        const task = (): Promise<void> =>
            limiter.acquire().then(async () => {
                active++;
                peak = Math.max(peak, active);
                await new Promise(resolve => setTimeout(resolve, 10));
                active--;
                limiter.release();
            });

        await Promise.all([task(), task(), task(), task(), task()]);

        expect(peak, 'observed peak concurrency').to.be.at.most(2);
        expect(limiter.runningCount, 'no slot leaked').to.equal(0);
        expect(limiter.queueLength, 'queue drained').to.equal(0);
    });

    it('serializes work when the maximum is 1', async () => {
        const limiter = new RenderLimiter(1);
        let active = 0;
        let peak = 0;

        const task = (): Promise<void> =>
            limiter.acquire().then(async () => {
                active++;
                peak = Math.max(peak, active);
                await new Promise(resolve => setTimeout(resolve, 5));
                active--;
                limiter.release();
            });

        await Promise.all([task(), task(), task()]);
        expect(peak).to.equal(1);
    });

    it('release without a matching acquire is a no-op', () => {
        const limiter = new RenderLimiter(2);
        limiter.release();
        expect(limiter.runningCount).to.equal(0);
    });

    it('setMax raising the limit immediately releases queued waiters', async () => {
        const limiter = new RenderLimiter(1);
        const order: number[] = [];

        await limiter.acquire();
        const p2 = limiter.acquire().then(() => order.push(2));
        const p3 = limiter.acquire().then(() => order.push(3));
        expect(limiter.queueLength).to.equal(2);

        limiter.setMax(3); // 1 running + 2 free slots -> both waiters proceed
        await Promise.all([p2, p3]);

        expect(order).to.deep.equal([2, 3]);
        expect(limiter.runningCount).to.equal(3);
        expect(limiter.queueLength).to.equal(0);
    });

    it('setMax lowering the limit is enforced as running work drains', async () => {
        const limiter = new RenderLimiter(3);
        await limiter.acquire();
        await limiter.acquire();
        await limiter.acquire();
        expect(limiter.runningCount).to.equal(3);

        limiter.setMax(1);
        expect(limiter.maxParallel).to.equal(1);
        expect(limiter.runningCount, 'running work is not interrupted').to.equal(3);

        const started: string[] = [];
        const pending = limiter.acquire().then(() => started.push('x'));
        expect(limiter.queueLength, 'new caller must wait').to.equal(1);

        limiter.release(); // running 2, still >= max(1) -> stays queued
        await tick();
        expect(started).to.deep.equal([]);
        expect(limiter.queueLength).to.equal(1);

        limiter.release(); // running 1, still >= max(1) -> stays queued
        await tick();
        expect(started).to.deep.equal([]);

        limiter.release(); // running 0 -> now the waiter may proceed
        await pending;
        expect(started).to.deep.equal(['x']);
        expect(limiter.runningCount).to.equal(1);
    });
});
