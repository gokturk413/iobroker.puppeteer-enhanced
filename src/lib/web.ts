/*
 * ioBroker.puppeteer-enhanced web extension
 *
 * This module is loaded by the ioBroker `web` adapter (see `common.webExtension`
 * in io-package.json). It runs *inside the web adapter process* and adds HTTP
 * routes that allow taking screenshots via a simple GET request, e.g.:
 *
 *     http://<iobroker-ip>:8082/puppeteer-enhanced/screenshot?url=https://iobroker.net
 *
 * The extension itself does NOT launch puppeteer. Instead, it forwards the request
 * via `sendTo` to the running puppeteer-enhanced instance, which performs the
 * screenshot with its already running browser and returns the image (base64).
 */

const ADAPTER_NAME = 'puppeteer-enhanced';

/** Default time (ms) we wait for the puppeteer instance to answer before giving up */
const DEFAULT_REQUEST_TIMEOUT = 60000;

interface ImageType {
    mime: string;
    ext: string;
}

/** Map of screenshot type -> mime type / file extension */
const IMAGE_TYPES: Record<string, ImageType> = {
    png: { mime: 'image/png', ext: 'png' },
    jpeg: { mime: 'image/jpeg', ext: 'jpg' },
    jpg: { mime: 'image/jpeg', ext: 'jpg' },
    webp: { mime: 'image/webp', ext: 'webp' },
};

/** Minimal shape of the express request/response we rely on */
interface WebRequest {
    query: Record<string, any>;
}
interface WebResponse {
    status(code: number): WebResponse;
    setHeader(name: string, value: string): WebResponse;
    send(body: unknown): void;
    end(body?: unknown): void;
}
interface WebApp {
    get(path: string, handler: (req: WebRequest, res: WebResponse) => void): void;
}

/**
 * Parses a value coming from a URL query string into a boolean.
 * Accepts true/1/yes/on (case-insensitive) as `true`.
 *
 * @param value value from the query string
 * @param defaultValue value to use if not provided
 */
function parseBoolean(value: any, defaultValue?: boolean): boolean | undefined {
    if (value === undefined || value === null || value === '') {
        return defaultValue;
    }
    return ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase());
}

/**
 * Parses a value coming from a URL query string into a finite number.
 *
 * @param value value from the query string
 */
function parseNumber(value: any): number | undefined {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }
    const num = Number(value);
    return Number.isFinite(num) ? num : undefined;
}

interface ScreenshotRequest {
    message: Record<string, any>;
    imageType: ImageType;
    download?: string;
}

/**
 * Web extension for the ioBroker `web` adapter that exposes a screenshot endpoint via GET request.
 */
export default class PuppeteerWebExtension {
    private readonly adapter: ioBroker.Adapter;
    private readonly app: WebApp;
    private readonly config: PuppeteerEnhancedAdapterConfig;
    /** e.g. "puppeteer-enhanced.0" - the instance we forward the requests to */
    private readonly instance: string;
    /** URL prefix under which the routes are mounted, e.g. "/puppeteer-enhanced" */
    private readonly path: string;

    /**
     * @param _server http(s) server object of the web adapter (unused)
     * @param _webSettings settings of the web adapter (unused)
     * @param adapter the web adapter instance
     * @param instanceSettings the puppeteer-enhanced instance object (common, native, _id)
     * @param app the express application of the web adapter
     */
    public constructor(
        _server: unknown,
        _webSettings: unknown,
        adapter: ioBroker.Adapter,
        instanceSettings: ioBroker.InstanceObject | undefined,
        app: WebApp,
    ) {
        this.adapter = adapter;
        this.app = app;
        this.config =
            (instanceSettings?.native as PuppeteerEnhancedAdapterConfig) || ({} as PuppeteerEnhancedAdapterConfig);

        this.instance = instanceSettings?._id
            ? instanceSettings._id.substring('system.adapter.'.length)
            : `${ADAPTER_NAME}.0`;

        this.path = `/${ADAPTER_NAME}`;

        this.adapter.log.info(
            `Registering puppeteer-enhanced web extension for ${this.instance} on ${this.path}/screenshot`,
        );

        this.app.get(`${this.path}/screenshot`, this.handleScreenshot.bind(this));
        // small info/landing page
        this.app.get(`${this.path}/`, this.handleInfo.bind(this));
        this.app.get(`${this.path}`, this.handleInfo.bind(this));
    }

    /**
     * Builds the screenshot message (options for the puppeteer instance) from the
     * GET query parameters.
     *
     * @param query express request query object
     */
    private buildMessage(query: Record<string, any>): ScreenshotRequest {
        const typeParam = String(query.type || query.format || 'png').toLowerCase();
        const imageType = IMAGE_TYPES[typeParam] || IMAGE_TYPES.png;
        const screenshotType = imageType.mime === 'image/jpeg' ? 'jpeg' : typeParam === 'webp' ? 'webp' : 'png';

        const message: Record<string, any> = {
            url: query.url,
            // We transport the image as base64 over the ioBroker message bus
            encoding: 'base64',
            type: screenshotType,
        };

        const fullPage = parseBoolean(query.fullPage);
        if (fullPage !== undefined) {
            message.fullPage = fullPage;
        }

        const omitBackground = parseBoolean(query.omitBackground);
        if (omitBackground !== undefined) {
            message.omitBackground = omitBackground;
        }

        const quality = parseNumber(query.quality);
        if (quality !== undefined && screenshotType !== 'png') {
            message.quality = quality;
        }

        // Viewport
        const width = parseNumber(query.width);
        const height = parseNumber(query.height);
        if (width !== undefined && height !== undefined) {
            message.viewportOptions = { width, height };
        }

        // Clip region (ignored by puppeteer if fullPage === true)
        const clipX = parseNumber(query.clipX !== undefined ? query.clipX : query.clipLeft);
        const clipY = parseNumber(query.clipY !== undefined ? query.clipY : query.clipTop);
        const clipWidth = parseNumber(query.clipWidth);
        const clipHeight = parseNumber(query.clipHeight);
        if (clipX !== undefined && clipY !== undefined && clipWidth !== undefined && clipHeight !== undefined) {
            message.clip = { x: clipX, y: clipY, width: clipWidth, height: clipHeight };
        }

        // Wait options: a selector has priority over a plain render time
        const selector = query.waitForSelector || query.selector;
        const renderTime = parseNumber(query.renderTime !== undefined ? query.renderTime : query.timeout);
        if (selector) {
            message.waitOption = { waitForSelector: String(selector) };
        } else if (renderTime !== undefined) {
            message.waitOption = { waitForTimeout: renderTime };
        }

        // Optional ioBroker web login credentials
        if (query.username && query.password) {
            message.loginCredentials = { username: String(query.username), password: String(query.password) };
        }

        // Optionally persist to ioBroker storage (0_userdata.0)
        if (query.storagePath) {
            message.ioBrokerOptions = { storagePath: String(query.storagePath) };
        }

        const download = query.filename ? String(query.filename) : undefined;

        return { message, imageType, download };
    }

    /**
     * GET /puppeteer-enhanced/screenshot
     *
     * @param req express request
     * @param res express response
     */
    private handleScreenshot(req: WebRequest, res: WebResponse): void {
        const query = req.query || {};

        if (!query.url) {
            res.status(400).setHeader('Content-Type', 'application/json');
            res.send(JSON.stringify({ error: 'Missing required query parameter "url"' }));
            return;
        }

        const { message, imageType, download } = this.buildMessage(query);
        const requestTimeout = parseNumber(query.requestTimeout) || DEFAULT_REQUEST_TIMEOUT;

        let finished = false;
        const timer = setTimeout(() => {
            if (finished) {
                return;
            }
            finished = true;
            this.adapter.log.warn(`Screenshot request for "${message.url}" timed out after ${requestTimeout} ms`);
            res.status(504).setHeader('Content-Type', 'application/json');
            res.send(JSON.stringify({ error: 'Timeout while creating the screenshot' }));
        }, requestTimeout);

        this.adapter.log.debug(`Forwarding screenshot request to ${this.instance}: ${message.url}`);

        this.adapter.sendTo(this.instance, 'screenshot', message, (result: any) => {
            if (finished) {
                return;
            }
            finished = true;
            clearTimeout(timer);

            if (!result || result.error) {
                const errText =
                    result && result.error ? result.error.message || result.error : 'No response from adapter';
                this.adapter.log.warn(`Screenshot of "${message.url}" failed: ${errText}`);
                res.status(500).setHeader('Content-Type', 'application/json');
                res.send(JSON.stringify({ error: errText }));
                return;
            }

            let buffer: Buffer;
            try {
                buffer = PuppeteerWebExtension.toBuffer(result.result);
            } catch (e: any) {
                this.adapter.log.warn(`Could not decode screenshot of "${message.url}": ${e.message}`);
                res.status(500).setHeader('Content-Type', 'application/json');
                res.send(JSON.stringify({ error: `Could not decode image: ${e.message}` }));
                return;
            }

            res.status(200);
            res.setHeader('Content-Type', imageType.mime);
            res.setHeader('Cache-Control', 'no-store');
            if (download) {
                res.setHeader('Content-Disposition', `attachment; filename="${download}"`);
            }
            res.end(buffer);
        });
    }

    /**
     * GET /puppeteer-enhanced/ - small info page describing the endpoint.
     *
     * @param _req express request
     * @param res express response
     */
    private handleInfo(_req: WebRequest, res: WebResponse): void {
        res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(
            `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>puppeteer-enhanced</title></head>` +
                `<body style="font-family:sans-serif;max-width:720px;margin:2em auto;padding:0 1em">` +
                `<h1>ioBroker.puppeteer-enhanced web extension</h1>` +
                `<p>Take a screenshot with a simple GET request:</p>` +
                `<pre>${this.path}/screenshot?url=https://www.iobroker.net</pre>` +
                `<p>Supported query parameters: <code>url</code> (required), <code>type</code> (png|jpeg|webp), ` +
                `<code>fullPage</code>, <code>width</code>, <code>height</code>, <code>quality</code>, ` +
                `<code>omitBackground</code>, <code>clipX</code>, <code>clipY</code>, <code>clipWidth</code>, ` +
                `<code>clipHeight</code>, <code>waitForSelector</code>, <code>renderTime</code>, ` +
                `<code>username</code>, <code>password</code>, <code>storagePath</code>, <code>filename</code>.</p>` +
                `</body></html>`,
        );
    }

    /**
     * Normalizes the different shapes a screenshot result can have into a Buffer.
     *
     * @param result the `result` field of the screenshot message answer
     */
    private static toBuffer(result: unknown): Buffer {
        if (!result) {
            throw new Error('empty result');
        }
        if (Buffer.isBuffer(result)) {
            return result;
        }
        // base64 string (encoding: 'base64')
        if (typeof result === 'string') {
            return Buffer.from(result, 'base64');
        }
        // serialized Buffer over the message bus: { type: 'Buffer', data: [...] }
        const asRecord = result as { type?: string; data?: unknown };
        if (asRecord.type === 'Buffer' && Array.isArray(asRecord.data)) {
            return Buffer.from(asRecord.data);
        }
        if (Array.isArray(result)) {
            return Buffer.from(result);
        }
        throw new Error('unsupported result format');
    }

    /**
     * Called by the web adapter to check whether the extension is ready.
     * Routes are registered synchronously in the constructor, so we are ready immediately.
     *
     * @param callback to be called once the extension is ready
     */
    public waitForReady(callback: () => void): void {
        callback?.();
    }

    /**
     * Called by the web adapter when the extension is unloaded.
     */
    public unload(): Promise<void> {
        this.adapter.log.debug('Unloading puppeteer-enhanced web extension');
        return Promise.resolve();
    }
}
