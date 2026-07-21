"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var import_adapter_core = require("@iobroker/adapter-core");
var import_puppeteer = __toESM(require("puppeteer"));
var import_node_path = require("node:path");
var import_node_fs = require("node:fs");
var import_node_os = require("node:os");
var import_node_events = require("node:events");
var import_renderLimiter = require("./lib/renderLimiter");
var _a;
import_node_events.EventEmitter.defaultMaxListeners = 30;
(_a = process.setMaxListeners) == null ? void 0 : _a.call(process, 30);
class PuppeteerAdapter extends import_adapter_core.Adapter {
  constructor(options = {}) {
    super({ ...options, name: "puppeteer-enhanced" });
    /** Track active PDF browser instances so they can be closed on unload */
    this.activePdfBrowsers = /* @__PURE__ */ new Set();
    /** Limits how many render operations (screenshots/PDFs) may run in parallel */
    this.renderLimiter = new import_renderLimiter.RenderLimiter(1);
    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
    this.on("message", this.onMessage.bind(this));
  }
  /**
   * Is called when databases are connected and adapter received configuration.
   */
  async onReady() {
    var _a2;
    this.renderLimiter.setMax(Number((_a2 = this.config.maxParallelProcesses) != null ? _a2 : 10));
    this.log.info(`Maximum parallel rendering processes: ${this.renderLimiter.maxParallel}`);
    let additionalArgs;
    if (this.config.additionalArgs) {
      additionalArgs = this.config.additionalArgs.map((entry) => entry.Argument);
    }
    this.log.debug(`Additional arguments: ${JSON.stringify(additionalArgs)}`);
    const defaultArgs = [
      "--disable-cache",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu"
    ];
    const launchOptions = {
      headless: true,
      defaultViewport: null,
      executablePath: this.config.useExternalBrowser ? this.config.executablePath : void 0,
      args: additionalArgs && additionalArgs.length > 0 ? additionalArgs : defaultArgs,
      ignoreHTTPSErrors: true,
      dumpio: true,
      // Show browser console output for debugging
      protocolTimeout: 18e4
      // 3 minutes protocol timeout
    };
    this.log.info(`Launching browser with options: ${JSON.stringify(launchOptions)}`);
    try {
      this.browser = await import_puppeteer.default.launch(launchOptions);
      this.log.info("Browser launched successfully");
    } catch (launchError) {
      this.log.error(`Failed to launch browser: ${launchError.message}`);
      this.log.error(`Error stack: ${launchError.stack}`);
      throw launchError;
    }
    this.subscribeStates("url");
    this.log.info("Ready to take screenshots and export PDFs");
  }
  /**
   * Is called when adapter shuts down - callback has to be called under any circumstances!
   *
   * @param callback callback which needs to be called
   */
  async onUnload(callback) {
    try {
      if (this.activePdfBrowsers.size > 0) {
        this.log.warn(`Closing ${this.activePdfBrowsers.size} active PDF browser(s)...`);
        const closePromises = [];
        for (const browser of this.activePdfBrowsers) {
          closePromises.push(
            (async () => {
              try {
                await browser.close();
                this.log.debug("PDF browser closed during shutdown");
              } catch (err) {
                this.log.debug(`PDF browser close error: ${err.message}`);
              }
            })()
          );
        }
        await Promise.race([
          Promise.all(closePromises),
          new Promise((resolve2) => setTimeout(resolve2, 1e4))
        ]);
        this.activePdfBrowsers.clear();
        this.log.info("All PDF browsers closed");
      }
      if (this.browser) {
        this.log.info("Closing main browser");
        await Promise.race([this.browser.close(), new Promise((resolve2) => setTimeout(resolve2, 5e3))]);
        this.browser = void 0;
        await new Promise((resolve2) => setTimeout(resolve2, 2e3));
      }
      this.log.info("Adapter unloaded successfully");
      callback();
    } catch (e) {
      this.log.debug(`Error during unload: ${e.message}`);
      callback();
    }
  }
  /**
   * Restarts the main browser if it is not connected anymore
   */
  async ensureBrowser() {
    if (!this.browser || !this.browser.connected) {
      this.log.warn("Browser not connected, attempting to restart...");
      if (this.browser) {
        await this.browser.close().catch(() => {
        });
      }
      await this.onReady();
      this.log.info("Browser restarted successfully");
    }
  }
  /**
   * Acquires a render slot, waiting in a FIFO queue if the configured maximum number
   * of parallel rendering processes is already reached.
   */
  acquireRenderSlot() {
    if (this.renderLimiter.runningCount >= this.renderLimiter.maxParallel) {
      this.log.debug(
        `Rendering limit reached (${this.renderLimiter.maxParallel}), queuing request (${this.renderLimiter.queueLength + 1} waiting)`
      );
    }
    return this.renderLimiter.acquire();
  }
  /**
   * Releases a previously acquired render slot and lets the next queued request proceed.
   */
  releaseRenderSlot() {
    this.renderLimiter.release();
  }
  /**
   * Is called when a message is received
   *
   * @param obj the ioBroker message object
   */
  async onMessage(obj) {
    if (!obj) {
      return;
    }
    this.log.debug(`Received command: ${obj.command}`);
    try {
      await this.ensureBrowser();
    } catch (e) {
      this.log.error(`Failed to restart browser: ${e.message}`);
      this.sendTo(
        obj.from,
        obj.command,
        { error: { message: "Browser not available", stack: e.stack } },
        obj.callback
      );
      return;
    }
    if (obj.command === "screenshot") {
      await this.handleScreenshotMessage(obj);
    } else if (obj.command === "pdf") {
      await this.handlePdfMessage(obj);
    } else {
      this.log.error(`Unsupported message command: ${obj.command}`);
      this.sendTo(
        obj.from,
        obj.command,
        { error: new Error(`Unsupported message command: ${obj.command}`) },
        obj.callback
      );
    }
  }
  /**
   * Handles the "screenshot" message command
   *
   * @param obj the ioBroker message object
   */
  async handleScreenshotMessage(obj) {
    let url;
    let options;
    if (typeof obj.message === "string") {
      url = obj.message;
      options = {};
    } else if (obj.message && typeof obj.message === "object") {
      url = obj.message.url;
      options = { ...obj.message };
      delete options.url;
    } else {
      options = {};
    }
    const { waitMethod, waitParameter } = PuppeteerAdapter.extractWaitOptionFromMessage(options);
    const { storagePath } = PuppeteerAdapter.extractIoBrokerOptionsFromMessage(options);
    const { credentials } = PuppeteerAdapter.extractLoginCredentials(options);
    const viewport = PuppeteerAdapter.extractViewportOptionsFromMessage(options);
    let page;
    let customBrowser;
    let tempUserDataDir;
    await this.acquireRenderSlot();
    try {
      if (options.path) {
        this.validatePath(options.path);
      }
      if (options.executablePath) {
        this.log.info(`Using custom Chrome: ${options.executablePath}`);
        tempUserDataDir = (0, import_node_path.join)((0, import_node_os.tmpdir)(), `pup_chrome_${Date.now()}`);
        customBrowser = await import_puppeteer.default.launch({
          headless: false,
          executablePath: options.executablePath,
          defaultViewport: null,
          userDataDir: tempUserDataDir,
          // Persistent profile to avoid EBUSY
          args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-logging"],
          ignoreHTTPSErrors: true,
          dumpio: false,
          // Disable to prevent chrome_debug.log locks
          protocolTimeout: 18e4
        });
        page = await customBrowser.newPage();
      } else {
        page = await this.browser.newPage();
      }
      if (viewport) {
        await page.setViewport(viewport);
      }
      await new Promise((resolve2) => setTimeout(resolve2, 500));
      const loginHtmlPath = options.loginHtmlPath;
      if (loginHtmlPath && (credentials == null ? void 0 : credentials.username) && credentials.password) {
        this.log.info(`Using HTML login file: ${loginHtmlPath}`);
        try {
          const loginHtml = await import_node_fs.promises.readFile(loginHtmlPath, "utf8");
          await page.setContent(loginHtml);
          this.log.info("Login HTML loaded");
          await new Promise((resolve2) => setTimeout(resolve2, 2e3));
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 3e4 });
          this.log.info("[Screenshot] Navigation successful after HTML login");
          await new Promise((resolve2) => setTimeout(resolve2, 3e3));
        } catch (htmlError) {
          this.log.warn(`HTML login failed: ${htmlError.message} - trying standard login`);
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 3e4 });
        }
      } else {
        try {
          await page.goto(url, { waitUntil: "networkidle2", timeout: 3e4 });
          this.log.info("[Screenshot] Navigation successful");
        } catch (navError) {
          this.log.warn(`Navigation timeout: ${navError.message} - trying with domcontentloaded`);
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 3e4 });
          this.log.info("[Screenshot] Navigation successful (fallback)");
        }
      }
      if (!loginHtmlPath && (credentials == null ? void 0 : credentials.username) && credentials.password) {
        let needsLogin = false;
        try {
          needsLogin = await page.evaluate(() => document.querySelector('input[type="password"]') !== null);
        } catch (evalErr) {
          this.log.debug(`Could not check for login: ${evalErr.message}`);
          needsLogin = false;
        }
        if (needsLogin) {
          this.log.info("Login page detected, attempting login...");
          try {
            await this.handleIoBrokerLogin(page, url, credentials);
            this.log.debug("Login function completed");
          } catch (loginErr) {
            this.log.warn(`Login failed: ${loginErr.message} - continuing anyway`);
          }
          if (page.isClosed()) {
            throw new Error("Page closed during login process");
          }
          this.log.debug("Waiting 5s for page stabilization...");
          try {
            await new Promise((resolve2) => setTimeout(resolve2, 5e3));
          } catch (waitErr) {
            this.log.warn(`Wait timeout error: ${waitErr.message}`);
          }
          if (page.isClosed()) {
            throw new Error("Page closed during post-login wait");
          }
          this.log.debug("Page still alive after login");
        }
      }
      if (waitMethod) {
        if (waitMethod in page && typeof page[waitMethod] === "function") {
          await page[waitMethod](waitParameter);
        } else if (waitMethod === "waitForTimeout" || waitMethod === "delay") {
          await new Promise((resolve2) => setTimeout(resolve2, waitParameter));
        }
      }
      this.log.debug("Waiting for web components...");
      await new Promise((resolve2) => setTimeout(resolve2, 2e3));
      if (page.isClosed()) {
        throw new Error("Page closed before screenshot");
      }
      this.log.info("Taking screenshot...");
      const img = await page.screenshot(options);
      if (storagePath) {
        this.log.debug(`Write file to "${storagePath}"`);
        await this.writeFileAsync("0_userdata.0", storagePath, Buffer.from(img));
      }
      this.sendTo(obj.from, obj.command, { result: img }, obj.callback);
    } catch (e) {
      this.log.error(`Could not take screenshot of "${url}": ${e.message}`);
      this.log.error(`Error stack: ${e.stack}`);
      this.sendTo(
        obj.from,
        obj.command,
        { error: { message: e.message, stack: e.stack, name: e.name } },
        obj.callback
      );
    } finally {
      try {
        if (page && !page.isClosed()) {
          await Promise.race([page.close(), new Promise((resolve2) => setTimeout(resolve2, 5e3))]);
        }
        if (customBrowser) {
          await Promise.race([
            customBrowser.close(),
            new Promise((resolve2) => setTimeout(resolve2, 5e3))
          ]);
          this.log.info("Custom browser closed");
        }
      } catch (closeError) {
        this.log.debug(`Error closing page/browser: ${closeError.message}`);
      }
      await new Promise((resolve2) => setTimeout(resolve2, 2e3));
      if (tempUserDataDir) {
        try {
          if ((0, import_node_fs.existsSync)(tempUserDataDir)) {
            this.log.debug(`Cleaning up temp profile: ${tempUserDataDir}`);
            import_node_fs.promises.rm(tempUserDataDir, { recursive: true, force: true }).catch((err) => this.log.debug(`Could not clean temp profile: ${err.message}`));
          }
        } catch (cleanupErr) {
          this.log.debug(`Profile cleanup error: ${cleanupErr.message}`);
        }
      }
      this.releaseRenderSlot();
    }
  }
  /**
   * Handles the "pdf" message command
   *
   * @param obj the ioBroker message object
   */
  async handlePdfMessage(obj) {
    this.log.info(`[PDF] Command received from ${obj.from}`);
    this.log.debug(`[PDF] Has callback: ${!!obj.callback}`);
    let url;
    let options;
    let loginaddressUrl;
    if (typeof obj.message === "string") {
      url = obj.message;
      options = {};
    } else {
      const message = obj.message;
      loginaddressUrl = message.loginaddressurl;
      url = message.url;
      options = { ...message };
      delete options.url;
    }
    const { waitMethod, waitParameter } = PuppeteerAdapter.extractWaitOptionFromMessage(options);
    const { storagePath } = PuppeteerAdapter.extractIoBrokerOptionsFromMessage(options);
    const { credentials } = PuppeteerAdapter.extractLoginCredentials(options);
    void waitMethod;
    void waitParameter;
    let browser;
    let page;
    await this.acquireRenderSlot();
    try {
      if (options.path) {
        const directory = (0, import_node_path.dirname)(options.path);
        if (!(0, import_node_fs.existsSync)(directory)) {
          this.log.info(`[PDF] Creating directory: ${directory}`);
          (0, import_node_fs.mkdirSync)(directory, { recursive: true });
          this.log.debug("[PDF] Directory created successfully");
        }
      }
      const pdfOptions = {
        ...options,
        timeout: 3e4,
        // 30s for web components
        preferCSSPageSize: false,
        printBackground: options.printBackground !== false
        // Default true
      };
      delete pdfOptions.path;
      const loginHtmlPath = options.loginHtmlPath;
      this.log.info("[PDF] Launching browser...");
      browser = await import_puppeteer.default.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
        // Use pipe instead of WebSocket to reduce socket connections
        pipe: true,
        ignoreHTTPSErrors: true
      });
      this.activePdfBrowsers.add(browser);
      this.log.debug(`[PDF] Browser tracked (total active: ${this.activePdfBrowsers.size})`);
      const browserProcess = browser.process();
      if (browserProcess) {
        browserProcess.setMaxListeners(30);
        this.log.debug("[PDF] Browser process max listeners set to 30");
      }
      this.log.debug("[PDF] Browser launched, creating new page...");
      page = await browser.newPage();
      if (loginHtmlPath && (credentials == null ? void 0 : credentials.username) && credentials.password) {
        this.log.info(`Using HTML login file: ${loginHtmlPath}`);
        try {
          const loginHtml = await import_node_fs.promises.readFile(loginHtmlPath, "utf8");
          await page.setContent(loginHtml);
          this.log.info("Login HTML loaded");
          await new Promise((resolve2) => setTimeout(resolve2, 5e3));
        } catch (htmlError) {
          this.log.warn(`HTML login failed: ${htmlError.message} - trying standard login`);
        }
      }
      if (!loginHtmlPath && (credentials == null ? void 0 : credentials.username) && credentials.password) {
        this.log.info("Login page detected, attempting login...");
        try {
          const params = { username: credentials.username, password: credentials.password };
          const contentHtml = `<!DOCTYPE html>
<html>
<head>
<title>Login</title>
</head>
<body>
<script>
const mapForm = document.createElement("form");
mapForm.target = "_self";
mapForm.method = "POST";
mapForm.action = "${loginaddressUrl}";
const params = ${JSON.stringify(params)};
for (const key in params) {
    const mapInput = document.createElement("input");
    mapInput.setAttribute("type", "hidden");
    mapInput.setAttribute("name", key);
    mapInput.setAttribute("value", params[key]);
    mapForm.appendChild(mapInput);
}
document.body.appendChild(mapForm);
mapForm.submit();
</script>
</body>
</html>`;
          await page.setContent(contentHtml);
          this.log.debug("Login function completed");
        } catch (loginErr) {
          this.log.warn(`Login failed: ${loginErr.message} - continuing anyway`);
        }
      }
      await new Promise((resolve2) => setTimeout(resolve2, 1e4));
      await page.goto(url, { waitUntil: "networkidle2" });
      await new Promise((resolve2) => setTimeout(resolve2, 1e4));
      const pdf = await page.pdf(pdfOptions);
      if (options.path) {
        this.log.info(`[PDF] Writing to file system: "${options.path}"`);
        await import_node_fs.promises.writeFile(options.path, pdf);
      } else if (storagePath) {
        this.log.info(`[PDF] Writing to ioBroker storage: "${storagePath}"`);
        await this.writeFileAsync("0_userdata.0", storagePath, Buffer.from(pdf));
      }
      if (page && !page.isClosed()) {
        this.log.debug("[PDF] Closing page...");
        try {
          await page.close();
          this.log.debug("[PDF] Page closed");
        } catch (pageErr) {
          this.log.debug(`[PDF] Page close error (ignored): ${pageErr.message}`);
        }
      }
      if (browser) {
        this.log.debug("[PDF] Closing browser...");
        try {
          await browser.close();
          this.activePdfBrowsers.delete(browser);
          this.log.debug(`[PDF] Browser removed from tracking (remaining: ${this.activePdfBrowsers.size})`);
          this.log.debug("[PDF] Browser closed successfully");
        } catch (browserErr) {
          this.log.debug(`[PDF] Browser close error (ignored): ${browserErr.message}`);
        }
      }
      this.log.info(`[PDF] Export completed successfully! PDF size: ${pdf.length} bytes`);
      const response = {
        success: true,
        result: pdf,
        size: pdf.length,
        path: options.path || storagePath,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      };
      this.sendTo(obj.from, obj.command, response, obj.callback);
    } catch (e) {
      this.log.error(`[PDF] Export failed: ${e.message}`);
      this.log.error(`[PDF] Error type: ${e.name}`);
      this.log.error(`[PDF] Error stack: ${e.stack}`);
      try {
        if (page && !page.isClosed()) {
          await page.close();
        }
      } catch (pageCloseErr) {
        this.log.debug(`[PDF] Page close error (ignored): ${pageCloseErr.message}`);
      }
      try {
        if (browser) {
          await browser.close();
          this.activePdfBrowsers.delete(browser);
        }
      } catch (browserCloseErr) {
        this.log.debug(`[PDF] Browser close error (ignored): ${browserCloseErr.message}`);
      }
      const errorResponse = {
        success: false,
        error: e.message || e.toString() || "Unknown error",
        errorType: e.name || "Error",
        errorDetails: { message: e.message, stack: e.stack, name: e.name, toString: e.toString() }
      };
      this.sendTo(obj.from, obj.command, errorResponse, obj.callback);
    } finally {
      this.releaseRenderSlot();
    }
  }
  /**
   * Is called if a subscribed state changes
   *
   * @param id id of the changed state
   * @param state the state object
   */
  async onStateChange(id, state) {
    if (!this.browser) {
      return;
    }
    if (state && state.val && !state.ack) {
      const options = await this.gatherScreenshotOptions();
      if (!options.path) {
        this.log.error("Please specify a filename before taking a screenshot");
        return;
      }
      try {
        this.validatePath(options.path);
      } catch (e) {
        this.log.error(`Cannot take screenshot: ${e.message}`);
        return;
      }
      this.log.debug(`Screenshot options: ${JSON.stringify(options)}`);
      this.log.info(`Taking screenshot of "${state.val}"`);
      await this.acquireRenderSlot();
      try {
        const page = await this.browser.newPage();
        await page.goto(state.val, { waitUntil: "networkidle2" });
        await this.handleIoBrokerLogin(page, state.val, null);
        await this.waitForConditions(page);
        await page.screenshot(options);
        this.log.info("Screenshot successfully saved");
        await this.setStateAsync(id, state.val, true);
        await page.close();
      } catch (e) {
        this.log.error(`Could not take screenshot of "${state.val}": ${e.message}`);
      } finally {
        this.releaseRenderSlot();
      }
    }
  }
  /**
   * Determines the ScreenshotOptions by the current configuration states
   */
  async gatherScreenshotOptions() {
    const options = {};
    const filenameState = await this.getStateAsync("filename");
    if (filenameState == null ? void 0 : filenameState.val) {
      options.path = filenameState.val;
    }
    const fullPageState = await this.getStateAsync("fullPage");
    if (fullPageState) {
      options.fullPage = !!fullPageState.val;
    }
    if (!options.fullPage) {
      const clipOptions = await this.gatherScreenshotClipOptions();
      if (clipOptions) {
        options.clip = clipOptions;
      }
    } else {
      this.log.debug("Ignoring clip options, because full page is desired");
    }
    return options;
  }
  /**
   * Determines the ScreenshotClipOptions by the current configuration states
   */
  async gatherScreenshotClipOptions() {
    const options = {};
    const clipAttributes = {
      clipLeft: "x",
      clipTop: "y",
      clipHeight: "height",
      clipWidth: "width"
    };
    for (const [id, attributeName] of Object.entries(clipAttributes)) {
      const clipAttributeState = await this.getStateAsync(id);
      if (clipAttributeState && typeof clipAttributeState.val === "number") {
        options[attributeName] = clipAttributeState.val;
      } else {
        this.log.debug(`Ignoring clip, because "${id}" is not configured`);
        return void 0;
      }
    }
    return options;
  }
  /**
   * Handles ioBroker web login if a login page is detected
   *
   * @param page active page object
   * @param url the URL being accessed
   * @param credentials optional credentials object with username and password
   */
  async handleIoBrokerLogin(page, url, credentials) {
    try {
      const isLoginPage = await page.evaluate(() => {
        const hasLoginForm = document.querySelector('input[type="password"]') !== null;
        const hasUsernameField = document.querySelector(
          'input[type="text"], input[type="email"], input[name="username"], input[id="username"]'
        ) !== null;
        return hasLoginForm && hasUsernameField;
      });
      if (!isLoginPage) {
        this.log.debug("No login form detected");
        return false;
      }
      this.log.info("ioBroker login page detected");
      let username;
      let password;
      if ((credentials == null ? void 0 : credentials.username) && credentials.password) {
        username = credentials.username;
        password = credentials.password;
      } else if (this.config.webUsername && this.config.webPassword) {
        username = this.config.webUsername;
        password = this.config.webPassword;
      } else {
        this.log.warn("No credentials configured for ioBroker web login");
        return false;
      }
      this.log.debug("Attempting to login to ioBroker web interface");
      const usernameSelectors = [
        'input[name="username"]',
        'input[id="username"]',
        'input[type="text"]',
        'input[type="email"]',
        ".login-username",
        "#login_username"
      ];
      const passwordSelectors = [
        'input[name="password"]',
        'input[id="password"]',
        'input[type="password"]',
        ".login-password",
        "#login_password"
      ];
      let usernameField = null;
      let passwordField = null;
      for (const selector of usernameSelectors) {
        try {
          usernameField = await page.$(selector);
          if (usernameField) {
            this.log.debug(`Found username field with selector: ${selector}`);
            break;
          }
        } catch {
        }
      }
      for (const selector of passwordSelectors) {
        try {
          passwordField = await page.$(selector);
          if (passwordField) {
            this.log.debug(`Found password field with selector: ${selector}`);
            break;
          }
        } catch {
        }
      }
      if (!usernameField || !passwordField) {
        this.log.warn("Could not find login form fields");
        return false;
      }
      await usernameField.type(username);
      await passwordField.type(password);
      this.log.debug("Credentials entered, submitting form");
      const submitSelectors = [
        'button[type="submit"]',
        'input[type="submit"]',
        "button.login-button",
        "#login_submit"
      ];
      let submitted = false;
      for (const selector of submitSelectors) {
        try {
          const submitButton = await page.$(selector);
          if (submitButton) {
            await submitButton.click();
            submitted = true;
            this.log.debug(`Clicked submit button: ${selector}`);
            break;
          }
        } catch {
        }
      }
      if (!submitted) {
        await passwordField.press("Enter");
        this.log.debug("Submitted form with Enter key");
      }
      await Promise.race([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 5e3 }).catch((err) => {
          this.log.debug(`No navigation detected after login: ${err.message}`);
        }),
        new Promise((resolve2) => setTimeout(resolve2, 3e3))
      ]);
      await new Promise((resolve2) => setTimeout(resolve2, 2e3));
      this.log.info("Login completed successfully");
      return true;
    } catch (e) {
      this.log.warn(`Error during ioBroker login: ${e.message}`);
      return false;
    }
  }
  /**
   * Validates that the given path is valid to save a screenshot to, prevents node_modules and dataDir.
   * Also creates the directory if it doesn't exist.
   *
   * @param path path to check
   */
  validatePath(path) {
    path = (0, import_node_path.resolve)((0, import_node_path.normalize)(path));
    this.log.debug(`Checking path "${path}"`);
    if (path.startsWith((0, import_adapter_core.getAbsoluteDefaultDataDir)())) {
      throw new Error("Screenshots cannot be stored inside the ioBroker storage");
    }
    if (path.includes(`${import_node_path.sep}node_modules${import_node_path.sep}`)) {
      throw new Error("Screenshots cannot be stored inside a node_modules folder");
    }
    const directory = (0, import_node_path.dirname)(path);
    if (!(0, import_node_fs.existsSync)(directory)) {
      this.log.info(`Creating directory: ${directory}`);
      try {
        (0, import_node_fs.mkdirSync)(directory, { recursive: true });
        this.log.debug(`Directory created successfully: ${directory}`);
      } catch (err) {
        throw new Error(`Could not create directory "${directory}": ${err.message}`);
      }
    }
  }
  /**
   * Waits until the user configured conditions are fulfilled
   *
   * @param page active page object
   */
  async waitForConditions(page) {
    var _a2, _b;
    const selector = (_a2 = await this.getStateAsync("waitForSelector")) == null ? void 0 : _a2.val;
    if (selector && typeof selector === "string") {
      this.log.debug(`Waiting for selector "${selector}"`);
      await page.waitForSelector(selector);
      return;
    }
    const renderTimeMs = (_b = await this.getStateAsync("renderTime")) == null ? void 0 : _b.val;
    if (renderTimeMs && typeof renderTimeMs === "number") {
      this.log.debug(`Waiting for timeout "${renderTimeMs}" ms`);
      await this.delay(renderTimeMs);
    }
  }
  /**
   * Extracts the ioBroker specific options from the message
   *
   * @param options obj.message part of a message passed by user
   */
  static extractIoBrokerOptionsFromMessage(options) {
    var _a2;
    let storagePath;
    if (typeof ((_a2 = options.ioBrokerOptions) == null ? void 0 : _a2.storagePath) === "string") {
      storagePath = options.ioBrokerOptions.storagePath;
    }
    delete options.ioBrokerOptions;
    return { storagePath };
  }
  /**
   * Extracts the viewport specific options from the message
   *
   * @param options obj.message part of a message passed by user
   */
  static extractViewportOptionsFromMessage(options) {
    let viewportOptions;
    if (typeof options.viewportOptions === "object" && options.viewportOptions !== null && typeof options.viewportOptions.width === "number" && typeof options.viewportOptions.height === "number") {
      viewportOptions = options.viewportOptions;
    }
    delete options.viewportOptions;
    return viewportOptions;
  }
  /**
   * Extracts the waitOption from a message
   *
   * @param options obj.message part of a message passed by user
   */
  static extractWaitOptionFromMessage(options) {
    let waitMethod;
    let waitParameter;
    if ("waitOption" in options) {
      if (options.waitOption && typeof options.waitOption === "object") {
        waitMethod = Object.keys(options.waitOption)[0];
        waitParameter = Object.values(options.waitOption)[0];
      }
      delete options.waitOption;
    }
    return { waitMethod, waitParameter };
  }
  /**
   * Extracts login credentials from the message
   *
   * @param options obj.message part of a message passed by user
   */
  static extractLoginCredentials(options) {
    var _a2, _b;
    let credentials;
    if (((_a2 = options.loginCredentials) == null ? void 0 : _a2.username) && ((_b = options.loginCredentials) == null ? void 0 : _b.password)) {
      credentials = {
        username: options.loginCredentials.username,
        password: options.loginCredentials.password
      };
    }
    delete options.loginCredentials;
    return { credentials };
  }
}
if (require.main !== module) {
  module.exports = (options) => new PuppeteerAdapter(options);
} else {
  (() => new PuppeteerAdapter())();
}
//# sourceMappingURL=main.js.map
