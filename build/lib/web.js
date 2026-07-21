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
var web_exports = {};
__export(web_exports, {
  default: () => PuppeteerWebExtension
});
module.exports = __toCommonJS(web_exports);
const ADAPTER_NAME = "puppeteer-enhanced";
const DEFAULT_REQUEST_TIMEOUT = 6e4;
const IMAGE_TYPES = {
  png: { mime: "image/png", ext: "png" },
  jpeg: { mime: "image/jpeg", ext: "jpg" },
  jpg: { mime: "image/jpeg", ext: "jpg" },
  webp: { mime: "image/webp", ext: "webp" }
};
function parseBoolean(value, defaultValue) {
  if (value === void 0 || value === null || value === "") {
    return defaultValue;
  }
  return ["true", "1", "yes", "on"].includes(String(value).toLowerCase());
}
function parseNumber(value) {
  if (value === void 0 || value === null || value === "") {
    return void 0;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : void 0;
}
class PuppeteerWebExtension {
  /**
   * @param _server http(s) server object of the web adapter (unused)
   * @param _webSettings settings of the web adapter (unused)
   * @param adapter the web adapter instance
   * @param instanceSettings the puppeteer-enhanced instance object (common, native, _id)
   * @param app the express application of the web adapter
   */
  constructor(_server, _webSettings, adapter, instanceSettings, app) {
    this.adapter = adapter;
    this.app = app;
    this.config = (instanceSettings == null ? void 0 : instanceSettings.native) || {};
    this.instance = (instanceSettings == null ? void 0 : instanceSettings._id) ? instanceSettings._id.substring("system.adapter.".length) : `${ADAPTER_NAME}.0`;
    this.path = `/${ADAPTER_NAME}`;
    this.adapter.log.info(
      `Registering puppeteer-enhanced web extension for ${this.instance} on ${this.path}/screenshot`
    );
    this.app.get(`${this.path}/screenshot`, this.handleScreenshot.bind(this));
    this.app.get(`${this.path}/`, this.handleInfo.bind(this));
    this.app.get(`${this.path}`, this.handleInfo.bind(this));
  }
  /**
   * Builds the screenshot message (options for the puppeteer instance) from the
   * GET query parameters.
   *
   * @param query express request query object
   */
  buildMessage(query) {
    const typeParam = String(query.type || query.format || "png").toLowerCase();
    const imageType = IMAGE_TYPES[typeParam] || IMAGE_TYPES.png;
    const screenshotType = imageType.mime === "image/jpeg" ? "jpeg" : typeParam === "webp" ? "webp" : "png";
    const message = {
      url: query.url,
      // We transport the image as base64 over the ioBroker message bus
      encoding: "base64",
      type: screenshotType
    };
    const fullPage = parseBoolean(query.fullPage);
    if (fullPage !== void 0) {
      message.fullPage = fullPage;
    }
    const omitBackground = parseBoolean(query.omitBackground);
    if (omitBackground !== void 0) {
      message.omitBackground = omitBackground;
    }
    const quality = parseNumber(query.quality);
    if (quality !== void 0 && screenshotType !== "png") {
      message.quality = quality;
    }
    const width = parseNumber(query.width);
    const height = parseNumber(query.height);
    if (width !== void 0 && height !== void 0) {
      message.viewportOptions = { width, height };
    }
    const clipX = parseNumber(query.clipX !== void 0 ? query.clipX : query.clipLeft);
    const clipY = parseNumber(query.clipY !== void 0 ? query.clipY : query.clipTop);
    const clipWidth = parseNumber(query.clipWidth);
    const clipHeight = parseNumber(query.clipHeight);
    if (clipX !== void 0 && clipY !== void 0 && clipWidth !== void 0 && clipHeight !== void 0) {
      message.clip = { x: clipX, y: clipY, width: clipWidth, height: clipHeight };
    }
    const selector = query.waitForSelector || query.selector;
    const renderTime = parseNumber(query.renderTime !== void 0 ? query.renderTime : query.timeout);
    if (selector) {
      message.waitOption = { waitForSelector: String(selector) };
    } else if (renderTime !== void 0) {
      message.waitOption = { waitForTimeout: renderTime };
    }
    if (query.username && query.password) {
      message.loginCredentials = { username: String(query.username), password: String(query.password) };
    }
    if (query.storagePath) {
      message.ioBrokerOptions = { storagePath: String(query.storagePath) };
    }
    const download = query.filename ? String(query.filename) : void 0;
    return { message, imageType, download };
  }
  /**
   * GET /puppeteer-enhanced/screenshot
   *
   * @param req express request
   * @param res express response
   */
  handleScreenshot(req, res) {
    const query = req.query || {};
    if (!query.url) {
      res.status(400).setHeader("Content-Type", "application/json");
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
      res.status(504).setHeader("Content-Type", "application/json");
      res.send(JSON.stringify({ error: "Timeout while creating the screenshot" }));
    }, requestTimeout);
    this.adapter.log.debug(`Forwarding screenshot request to ${this.instance}: ${message.url}`);
    this.adapter.sendTo(this.instance, "screenshot", message, (result) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      if (!result || result.error) {
        const errText = result && result.error ? result.error.message || result.error : "No response from adapter";
        this.adapter.log.warn(`Screenshot of "${message.url}" failed: ${errText}`);
        res.status(500).setHeader("Content-Type", "application/json");
        res.send(JSON.stringify({ error: errText }));
        return;
      }
      let buffer;
      try {
        buffer = PuppeteerWebExtension.toBuffer(result.result);
      } catch (e) {
        this.adapter.log.warn(`Could not decode screenshot of "${message.url}": ${e.message}`);
        res.status(500).setHeader("Content-Type", "application/json");
        res.send(JSON.stringify({ error: `Could not decode image: ${e.message}` }));
        return;
      }
      res.status(200);
      res.setHeader("Content-Type", imageType.mime);
      res.setHeader("Cache-Control", "no-store");
      if (download) {
        res.setHeader("Content-Disposition", `attachment; filename="${download}"`);
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
  handleInfo(_req, res) {
    res.status(200).setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(
      `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>puppeteer-enhanced</title></head><body style="font-family:sans-serif;max-width:720px;margin:2em auto;padding:0 1em"><h1>ioBroker.puppeteer-enhanced web extension</h1><p>Take a screenshot with a simple GET request:</p><pre>${this.path}/screenshot?url=https://www.iobroker.net</pre><p>Supported query parameters: <code>url</code> (required), <code>type</code> (png|jpeg|webp), <code>fullPage</code>, <code>width</code>, <code>height</code>, <code>quality</code>, <code>omitBackground</code>, <code>clipX</code>, <code>clipY</code>, <code>clipWidth</code>, <code>clipHeight</code>, <code>waitForSelector</code>, <code>renderTime</code>, <code>username</code>, <code>password</code>, <code>storagePath</code>, <code>filename</code>.</p></body></html>`
    );
  }
  /**
   * Normalizes the different shapes a screenshot result can have into a Buffer.
   *
   * @param result the `result` field of the screenshot message answer
   */
  static toBuffer(result) {
    if (!result) {
      throw new Error("empty result");
    }
    if (Buffer.isBuffer(result)) {
      return result;
    }
    if (typeof result === "string") {
      return Buffer.from(result, "base64");
    }
    const asRecord = result;
    if (asRecord.type === "Buffer" && Array.isArray(asRecord.data)) {
      return Buffer.from(asRecord.data);
    }
    if (Array.isArray(result)) {
      return Buffer.from(result);
    }
    throw new Error("unsupported result format");
  }
  /**
   * Called by the web adapter to check whether the extension is ready.
   * Routes are registered synchronously in the constructor, so we are ready immediately.
   *
   * @param callback to be called once the extension is ready
   */
  waitForReady(callback) {
    callback == null ? void 0 : callback();
  }
  /**
   * Called by the web adapter when the extension is unloaded.
   */
  unload() {
    this.adapter.log.debug("Unloading puppeteer-enhanced web extension");
    return Promise.resolve();
  }
}
//# sourceMappingURL=web.js.map
