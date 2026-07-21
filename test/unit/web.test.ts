import { expect } from 'chai';
import PuppeteerWebExtension from '../../src/lib/web';

/** 1x1 transparent PNG, base64 encoded */
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAQDXhZKKAAAAAElFTkSuQmCC';

type RouteHandler = (req: any, res: any) => void;
type SendTo = (instance: string, command: string, message: any, callback: (result: any) => void) => void;

const INSTANCE: any = { _id: 'system.adapter.puppeteer-enhanced.0', native: {} };

/** Collects the express routes the extension registers */
function createApp(): { routes: Record<string, RouteHandler>; get(path: string, handler: RouteHandler): void } {
    const routes: Record<string, RouteHandler> = {};
    return {
        routes,
        get(path: string, handler: RouteHandler): void {
            routes[path] = handler;
        },
    };
}

/** A minimal web-adapter stub with a configurable `sendTo` */
function createAdapter(sendTo?: SendTo): any {
    return {
        log: { info() {}, debug() {}, warn() {}, error() {} },
        sendTo: sendTo || ((): void => undefined),
    };
}

/** A minimal express response stub that records what was sent */
function createRes(): any {
    return {
        headers: {} as Record<string, string>,
        statusCode: undefined as number | undefined,
        body: undefined as unknown,
        ended: false,
        _onEnd: null as null | (() => void),
        status(code: number): any {
            this.statusCode = code;
            return this;
        },
        setHeader(name: string, value: string): any {
            this.headers[name] = value;
            return this;
        },
        send(body: unknown): void {
            this._finish(body);
        },
        end(body: unknown): void {
            this._finish(body);
        },
        _finish(body: unknown): void {
            this.body = body;
            this.ended = true;
            this._onEnd?.();
        },
    };
}

/** Resolves once the response has been sent */
function whenSent(res: any): Promise<void> {
    return new Promise(resolve => {
        if (res.ended) {
            resolve();
        } else {
            res._onEnd = resolve;
        }
    });
}

/** Registers the extension and invokes the screenshot route with the given query */
function callScreenshot(query: Record<string, any>, sendTo?: SendTo, instance: any = INSTANCE): any {
    const app = createApp();
    const adapter = createAdapter(sendTo);
    new PuppeteerWebExtension({}, {}, adapter, instance, app as any);
    const res = createRes();
    app.routes['/puppeteer-enhanced/screenshot']({ query }, res);
    return res;
}

/** Returns the message the extension forwards to the puppeteer instance for a query */
async function forwardedMessage(query: Record<string, any>): Promise<any> {
    let captured: any;
    const res = callScreenshot(query, (_instance, _command, message, cb) => {
        captured = message;
        cb({ result: PNG_B64 });
    });
    await whenSent(res);
    return captured;
}

describe('PuppeteerWebExtension', () => {
    describe('route registration', () => {
        it('registers the screenshot and info routes', () => {
            const app = createApp();
            new PuppeteerWebExtension({}, {}, createAdapter(), INSTANCE, app as any);
            expect(app.routes['/puppeteer-enhanced/screenshot'], 'screenshot route').to.be.a('function');
            expect(app.routes['/puppeteer-enhanced/'], 'info route with slash').to.be.a('function');
            expect(app.routes['/puppeteer-enhanced'], 'info route without slash').to.be.a('function');
        });

        it('does not throw when no instance object is provided', () => {
            const app = createApp();
            expect(() => new PuppeteerWebExtension({}, {}, createAdapter(), undefined, app as any)).to.not.throw();
            expect(app.routes['/puppeteer-enhanced/screenshot']).to.be.a('function');
        });
    });

    describe('GET /screenshot', () => {
        it('responds 400 when the url is missing and does not call the adapter', () => {
            let called = false;
            const res = callScreenshot({}, () => {
                called = true;
            });
            expect(res.statusCode).to.equal(400);
            expect(called, 'adapter must not be contacted').to.equal(false);
            expect(String(res.body)).to.match(/url/);
        });

        it('returns the image as a buffer with a 200 status', async () => {
            const res = callScreenshot({ url: 'https://example.com' }, (_i, _c, _m, cb) => cb({ result: PNG_B64 }));
            await whenSent(res);
            expect(res.statusCode).to.equal(200);
            expect(res.headers['Content-Type']).to.equal('image/png');
            expect(res.headers['Cache-Control']).to.equal('no-store');
            expect(Buffer.isBuffer(res.body), 'body is a Buffer').to.equal(true);
            expect(res.body.length).to.be.greaterThan(0);
        });

        it('forwards the request to the configured instance', async () => {
            let instance: string | undefined;
            const res = callScreenshot({ url: 'https://x' }, (i, _c, _m, cb) => {
                instance = i;
                cb({ result: PNG_B64 });
            });
            await whenSent(res);
            expect(instance).to.equal('puppeteer-enhanced.0');
        });

        it('uses the instance number from the instance object', async () => {
            let instance: string | undefined;
            const res = callScreenshot(
                { url: 'https://x' },
                (i, _c, _m, cb) => {
                    instance = i;
                    cb({ result: PNG_B64 });
                },
                { _id: 'system.adapter.puppeteer-enhanced.2', native: {} },
            );
            await whenSent(res);
            expect(instance).to.equal('puppeteer-enhanced.2');
        });

        it('sets the correct content type per image type', async () => {
            const cases: [string, string][] = [
                ['png', 'image/png'],
                ['jpeg', 'image/jpeg'],
                ['jpg', 'image/jpeg'],
                ['webp', 'image/webp'],
                ['unknown', 'image/png'],
            ];
            for (const [type, mime] of cases) {
                const res = callScreenshot({ url: 'https://x', type }, (_i, _c, _m, cb) => cb({ result: PNG_B64 }));
                await whenSent(res);
                expect(res.headers['Content-Type'], `type=${type}`).to.equal(mime);
            }
        });

        it('sets a Content-Disposition header when filename is given', async () => {
            const res = callScreenshot({ url: 'https://x', filename: 'dash.png' }, (_i, _c, _m, cb) =>
                cb({ result: PNG_B64 }),
            );
            await whenSent(res);
            expect(res.headers['Content-Disposition']).to.equal('attachment; filename="dash.png"');
        });

        it('responds 500 when the adapter returns an error', async () => {
            const res = callScreenshot({ url: 'https://x' }, (_i, _c, _m, cb) => cb({ error: { message: 'boom' } }));
            await whenSent(res);
            expect(res.statusCode).to.equal(500);
            expect(String(res.body)).to.match(/boom/);
        });

        it('responds 500 when the adapter returns no usable result', async () => {
            const res = callScreenshot({ url: 'https://x' }, (_i, _c, _m, cb) => cb({}));
            await whenSent(res);
            expect(res.statusCode).to.equal(500);
        });

        it('responds 504 when the adapter does not answer within requestTimeout', async () => {
            const res = callScreenshot({ url: 'https://x', requestTimeout: '20' }, () => {
                /* never calls back */
            });
            await whenSent(res);
            expect(res.statusCode).to.equal(504);
        });
    });

    describe('buildMessage (query -> screenshot options)', () => {
        it('always requests base64 encoding and a png type by default', async () => {
            const message = await forwardedMessage({ url: 'https://x' });
            expect(message.url).to.equal('https://x');
            expect(message.encoding).to.equal('base64');
            expect(message.type).to.equal('png');
        });

        it('maps the common query parameters', async () => {
            const message = await forwardedMessage({
                url: 'https://x',
                type: 'jpeg',
                quality: '80',
                fullPage: 'true',
                omitBackground: '1',
                width: '800',
                height: '600',
                waitForSelector: '#id',
                username: 'admin',
                password: 'secret',
                storagePath: 'shots/a.jpg',
                clipX: '1',
                clipY: '2',
                clipWidth: '3',
                clipHeight: '4',
            });
            expect(message.type).to.equal('jpeg');
            expect(message.quality).to.equal(80);
            expect(message.fullPage).to.equal(true);
            expect(message.omitBackground).to.equal(true);
            expect(message.viewportOptions).to.deep.equal({ width: 800, height: 600 });
            expect(message.waitOption).to.deep.equal({ waitForSelector: '#id' });
            expect(message.loginCredentials).to.deep.equal({ username: 'admin', password: 'secret' });
            expect(message.ioBrokerOptions).to.deep.equal({ storagePath: 'shots/a.jpg' });
            expect(message.clip).to.deep.equal({ x: 1, y: 2, width: 3, height: 4 });
        });

        it('ignores quality for png screenshots', async () => {
            const message = await forwardedMessage({ url: 'https://x', quality: '50' });
            expect(message.type).to.equal('png');
            expect(message.quality).to.equal(undefined);
        });

        it('requires both width and height for a viewport', async () => {
            const message = await forwardedMessage({ url: 'https://x', width: '800' });
            expect(message.viewportOptions).to.equal(undefined);
        });

        it('uses renderTime as a timeout wait option', async () => {
            const message = await forwardedMessage({ url: 'https://x', renderTime: '3000' });
            expect(message.waitOption).to.deep.equal({ waitForTimeout: 3000 });
        });

        it('prefers a selector over renderTime', async () => {
            const message = await forwardedMessage({ url: 'https://x', renderTime: '3000', waitForSelector: '#a' });
            expect(message.waitOption).to.deep.equal({ waitForSelector: '#a' });
        });

        it('accepts the clipLeft/clipTop aliases', async () => {
            const message = await forwardedMessage({
                url: 'https://x',
                clipLeft: '10',
                clipTop: '20',
                clipWidth: '30',
                clipHeight: '40',
            });
            expect(message.clip).to.deep.equal({ x: 10, y: 20, width: 30, height: 40 });
        });
    });

    describe('toBuffer', () => {
        const toBuffer = (PuppeteerWebExtension as any).toBuffer as (result: unknown) => Buffer;

        it('decodes a base64 string', () => {
            expect(Buffer.isBuffer(toBuffer(PNG_B64))).to.equal(true);
        });

        it('returns a Buffer unchanged', () => {
            const buf = Buffer.from([1, 2, 3]);
            expect(toBuffer(buf)).to.equal(buf);
        });

        it('rebuilds a serialized Buffer object', () => {
            expect([...toBuffer({ type: 'Buffer', data: [1, 2, 3] })]).to.deep.equal([1, 2, 3]);
        });

        it('accepts a plain array of bytes', () => {
            expect([...toBuffer([1, 2, 3])]).to.deep.equal([1, 2, 3]);
        });

        it('throws on empty or unsupported input', () => {
            expect(() => toBuffer(null)).to.throw();
            expect(() => toBuffer(undefined)).to.throw();
            expect(() => toBuffer({ foo: 'bar' })).to.throw();
        });
    });

    describe('lifecycle', () => {
        it('waitForReady invokes the callback synchronously', () => {
            const ext = new PuppeteerWebExtension({}, {}, createAdapter(), INSTANCE, createApp() as any);
            let ready = false;
            ext.waitForReady(() => {
                ready = true;
            });
            expect(ready).to.equal(true);
        });

        it('unload resolves', async () => {
            const ext = new PuppeteerWebExtension({}, {}, createAdapter(), INSTANCE, createApp() as any);
            await ext.unload();
        });
    });
});
