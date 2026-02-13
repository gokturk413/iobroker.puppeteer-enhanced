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
var utils = __toESM(require("@iobroker/adapter-core"));
var import_puppeteer = __toESM(require("puppeteer"));
var import_tools = require("./lib/tools");
var import_path = require("path");
var import_fs = require("fs");

class PuppeteerAdapter extends utils.Adapter {
  constructor(options = {}) {
    super({ ...options, name: "puppeteer-enhanced" });
    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
    this.on("message", this.onMessage.bind(this));
  }
  /**
   * Is called when databases are connected and adapter received configuration.
   */
  async onReady() {
    let additionalArgs;
    if (this.config.additionalArgs) {
      additionalArgs = this.config.additionalArgs.map((entry) => entry.Argument);
    }
    this.log.debug(`Additional arguments: ${JSON.stringify(additionalArgs)}`);

    const defaultArgs = [
      '--disable-cache',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu'
    ];

    const launchOptions = {
      headless: true,
      defaultViewport: null,
      executablePath: this.config.useExternalBrowser ? this.config.executablePath : void 0,
      args: additionalArgs && additionalArgs.length > 0 ? additionalArgs : defaultArgs,
      ignoreHTTPSErrors: true,
      dumpio: true,  // Show browser console output for debugging
      protocolTimeout: 180000  // 3 minutes protocol timeout
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
      if (this.browser) {
        this.log.info("Closing browser");
        await Promise.race([
          this.browser.close(),
          new Promise((resolve) => setTimeout(resolve, 5000))
        ]);
        this.browser = void 0;
        // Wait for cleanup
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      callback();
    } catch (e) {
      this.log.debug(`Error during unload: ${e.message}`);
      callback();
    }
  }
  /**
   * Is called when message received
   *
   * @param obj the ioBroker message object
   */
  async onMessage(obj) {
    if (!obj)
      return;
    this.log.debug(`Received command: ${obj.command}`);

    // Check if browser is still connected
    if (!this.browser || !this.browser.connected) {
      this.log.warn("Browser not connected, attempting to restart...");
      try {
        if (this.browser) {
          await this.browser.close().catch(() => { });
        }
        await this.onReady();
        this.log.info("Browser restarted successfully");
      } catch (e) {
        this.log.error(`Failed to restart browser: ${e.message}`);
        this.sendTo(obj.from, obj.command, {
          error: { message: "Browser not available", stack: e.stack }
        }, obj.callback);
        return;
      }
    }

    if (obj.command === "screenshot") {
      let url;
      let options;
      if (typeof obj.message === "string") {
        url = obj.message;
      } else if (typeof obj.message === "object") {
        options = {};
      } else {
        url = obj.message.url;
        options = obj.message;
        delete options.url;
      }
      const { waitMethod, waitParameter } = PuppeteerAdapter.extractWaitOptionFromMessage(options);
      const { storagePath } = PuppeteerAdapter.extractIoBrokerOptionsFromMessage(options);
      const { credentials } = PuppeteerAdapter.extractLoginCredentials(options);
      const viewport = PuppeteerAdapter.extractViewportOptionsFromMessage(options);
      let page;
      let customBrowser;
      let tempUserDataDir;  // Declare here to be accessible in finally block
      try {
        if (options.path) {
          this.validatePath(options.path);
        }

        // If custom Chrome executable specified, launch separate browser instance
        if (options.executablePath) {
          this.log.info(`Using custom Chrome: ${options.executablePath}`);

          // Create persistent temp directory to avoid cleanup issues
          const os = require('os');
          const path = require('path');
          tempUserDataDir = path.join(os.tmpdir(), `pup_chrome_${Date.now()}`);

          customBrowser = await import_puppeteer.default.launch({
            headless: false,
            executablePath: options.executablePath,
            defaultViewport: null,
            userDataDir: tempUserDataDir,  // Persistent profile to avoid EBUSY
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-logging'],
            ignoreHTTPSErrors: true,
            dumpio: false,  // Disable to prevent chrome_debug.log locks
            protocolTimeout: 180000
          });
          page = await customBrowser.newPage();
        } else {
          page = await this.browser.newPage();
        }

        if (viewport) {
          await page.setViewport(viewport);
        }

        // Wait for page to be ready
        await page.waitForTimeout(500);

        // Check if loginHtmlPath is provided (2023 approach)
        const loginHtmlPath = options.loginHtmlPath;

        if (loginHtmlPath && credentials && credentials.username && credentials.password) {
          // 2023 approach: Load HTML file, then navigate to VIS
          this.log.info(`Using HTML login file: ${loginHtmlPath}`);

          try {
            const loginHtml = await import_fs.promises.readFile(loginHtmlPath, 'utf8');
            await page.setContent(loginHtml);
            this.log.info('Login HTML loaded');

            // Wait for login form to process (2023 API: 5s → 2s for speed)
            await page.waitForTimeout(2000);

            // Navigate to target URL
            await page.goto(url, {
              waitUntil: "domcontentloaded",
              timeout: 30000
            });
            this.log.info('[Screenshot] Navigation successful after HTML login');

            // Wait for page to load completely (2023 API: 10s → 3s for speed)
            await page.waitForTimeout(3000);

          } catch (htmlError) {
            this.log.warn(`HTML login failed: ${htmlError.message} - trying standard login`);
            // Fallback to standard login approach
            await page.goto(url, {
              waitUntil: "domcontentloaded",
              timeout: 30000
            });
          }
        } else {
          // Standard approach: Navigate to full URL (like 2023)
          try {
            await page.goto(url, {  // Full URL with hash (2023 style)
              waitUntil: "networkidle2",  // Wait for network idle (web components support)
              timeout: 30000
            });
            this.log.info('[Screenshot] Navigation successful');
          } catch (navError) {
            this.log.warn(`Navigation timeout: ${navError.message} - trying with domcontentloaded`);
            await page.goto(url, {
              waitUntil: "domcontentloaded",
              timeout: 30000
            });
            this.log.info('[Screenshot] Navigation successful (fallback)');
          }
        }

        // Check for login and handle if needed (skip if HTML login was used)
        if (!loginHtmlPath && credentials && credentials.username && credentials.password) {
          let needsLogin = false;
          try {
            needsLogin = await page.evaluate(() => {
              return document.querySelector('input[type="password"]') !== null;
            });
          } catch (evalErr) {
            this.log.debug(`Could not check for login: ${evalErr.message}`);
            needsLogin = false;
          }

          if (needsLogin) {
            this.log.info("Login page detected, attempting login...");

            try {
              await this.handleIoBrokerLogin(page, url, credentials);
              this.log.debug('Login function completed');
            } catch (loginErr) {
              this.log.warn(`Login failed: ${loginErr.message} - continuing anyway`);
            }

            // Check if page still alive after login
            if (page.isClosed()) {
              throw new Error('Page closed during login process');
            }

            // Wait for page to stabilize after login (2023 API: 10s → 5s)
            this.log.debug('Waiting 5s for page stabilization...');
            try {
              await page.waitForTimeout(5000);
            } catch (waitErr) {
              this.log.warn(`Wait timeout error: ${waitErr.message}`);
            }

            // Verify page is still alive
            if (page.isClosed()) {
              throw new Error('Page closed during post-login wait');
            }
            this.log.debug('Page still alive after login');
          }
        }

        // Additional wait if specified
        if (waitMethod && waitMethod in page) {
          await page[waitMethod](waitParameter);
        }

        // Wait for web components to render (for ioBroker.webui etc.)
        this.log.debug('Waiting for web components...');
        await page.waitForTimeout(2000);

        // Check if page is still open
        if (page.isClosed()) {
          throw new Error('Page closed before screenshot');
        }

        this.log.info('Taking screenshot...');
        const img = await page.screenshot(options);
        if (storagePath) {
          this.log.debug(`Write file to "${storagePath}"`);
          await this.writeFileAsync("0_userdata.0", storagePath, Buffer.from(img));
        }
        this.sendTo(obj.from, obj.command, { result: img }, obj.callback);
      } catch (e) {
        this.log.error(`Could not take screenshot of "${url}": ${e.message}`);
        this.log.error(`Error stack: ${e.stack}`);
        this.sendTo(obj.from, obj.command, {
          error: {
            message: e.message,
            stack: e.stack,
            name: e.name
          }
        }, obj.callback);
      } finally {
        try {
          if (page && !page.isClosed()) {
            // Close with timeout (5s max)
            await Promise.race([
              page.close(),
              new Promise((resolve) => setTimeout(resolve, 5000))
            ]);
          }
          if (customBrowser) {
            // Close custom browser with timeout
            await Promise.race([
              customBrowser.close(),
              new Promise((resolve) => setTimeout(resolve, 5000))
            ]);
            this.log.info("Custom browser closed");
          }
        } catch (closeError) {
          this.log.debug(`Error closing page/browser: ${closeError.message}`);
          // Ignore close errors - not critical
        }

        // Additional wait after browser close to allow cleanup
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Clean up temp user data dir if it was created
        if (tempUserDataDir) {
          try {
            const fs = require('fs');
            const rimraf = require('rimraf');
            if (fs.existsSync(tempUserDataDir)) {
              this.log.debug(`Cleaning up temp profile: ${tempUserDataDir}`);
              // Async cleanup - don't wait for it
              rimraf(tempUserDataDir, (err) => {
                if (err) {
                  this.log.debug(`Could not clean temp profile: ${err.message}`);
                }
              });
            }
          } catch (cleanupErr) {
            this.log.debug(`Profile cleanup error: ${cleanupErr.message}`);
          }
        }
      }
    }
    else if (obj.command === "pdf") {
      let url;
      let options;
      if (typeof obj.message === "string") {
        url = obj.message;
        options = {};
      } else {
        url = obj.message.url;
        options = obj.message;
        delete options.url;
      }
      const { waitMethod, waitParameter } = PuppeteerAdapter.extractWaitOptionFromMessage(options);
      const { storagePath } = PuppeteerAdapter.extractIoBrokerOptionsFromMessage(options);
      const { credentials } = PuppeteerAdapter.extractLoginCredentials(options);
      let customBrowser;
      let tempUserDataDir;  // Declare here to be accessible in finally block
     
       /* if (options.path) {
          this.validatePath(options.path);
        }*/
      const pdfOptions = {
        ...options,
        timeout: 10000,  // 10s → 30s for web components
        preferCSSPageSize: false,
        printBackground: options.printBackground !== false  // Default true
      };
      const browser = await import_puppeteer.launch();
      const page = await browser.newPage();
      var contentHtml = import_fs.readFileSync('E:\\iob_dubendi_afc\\DubendiAFC\\node_modules\\iobroker.puppeteer-enhanced\\operlogin.html', 'utf8');
      await page.setContent(contentHtml);
      //await page.goto('file://E:\iob_Stansiya479\iobStansiya479\iobroker-data\operlogin.html', {waitUntil: 'networkidle2'});
      await page.waitForTimeout(10000);
      await page.goto(url, { waitUntil: 'networkidle2' });
      await page.waitForTimeout(10000);
      const pdf = await page.pdf(pdfOptions);
      await import_fs.promises.writeFile(options.path, pdf);  // ✅ Absolute path
      this.sendTo(obj.from, obj.command, { result: pdf }, obj.callback);
      //await this.writeFileAsync("0_userdata.0", storagePath, Buffer.from(pdf));
      await browser.close();

    }
    /*else if (obj.command === "pdf") {
      let url;
      let options;
      if (typeof obj.message === "string") {
        url = obj.message;
        options = {};
      } else {
        url = obj.message.url;
        options = obj.message;
        delete options.url;
      }
      const { waitMethod, waitParameter } = PuppeteerAdapter.extractWaitOptionFromMessage(options);
      const { storagePath } = PuppeteerAdapter.extractIoBrokerOptionsFromMessage(options);
      const { credentials } = PuppeteerAdapter.extractLoginCredentials(options);
      let page;
      let customBrowser;
      let tempUserDataDir;  // Declare here to be accessible in finally block
      try {
        if (options.path) {
          this.validatePath(options.path);
        }
        
        // If custom Chrome executable specified, launch separate browser instance
        if (options.executablePath) {
          this.log.info(`Using custom Chrome: ${options.executablePath}`);
          
          // Create persistent temp directory to avoid cleanup issues
          const os = require('os');
          const path = require('path');
          tempUserDataDir = path.join(os.tmpdir(), `pup_chrome_${Date.now()}`);
          
          customBrowser = await import_puppeteer.default.launch({
            headless: false,
            executablePath: options.executablePath,
            defaultViewport: null,
            userDataDir: tempUserDataDir,  // Persistent profile to avoid EBUSY
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-logging'],
            ignoreHTTPSErrors: true,
            dumpio: false,  // Disable to prevent chrome_debug.log locks
            protocolTimeout: 180000
          });
          page = await customBrowser.newPage();
        } else {
          page = await this.browser.newPage();
        }
        
        // Wait for page to be ready
        await page.waitForTimeout(500);
        
        // Check if loginHtmlPath is provided (2023 approach)
        const loginHtmlPath = options.loginHtmlPath;
        
        if (loginHtmlPath && credentials && credentials.username && credentials.password) {
          // 2023 approach: Load HTML file, then navigate to VIS
          this.log.info(`Using HTML login file: ${loginHtmlPath}`);
          
          try {
            const loginHtml = await import_fs.promises.readFile(loginHtmlPath, 'utf8');
            await page.setContent(loginHtml);
            this.log.info('Login HTML loaded');
            
            // Wait for login form to process (2023 API)
            await page.waitForTimeout(5000);
            
            // Navigate to target URL
            await page.goto(url, { 
              waitUntil: "domcontentloaded",
              timeout: 30000 
            });
            this.log.info('[PDF] Navigation successful after HTML login');
            
            // Wait for page to load completely (2023 API)
            await page.waitForTimeout(10000);
            
          } catch (htmlError) {
            this.log.warn(`HTML login failed: ${htmlError.message} - trying standard login`);
            // Fallback to standard login approach
            await page.goto(url, { 
              waitUntil: "domcontentloaded",
              timeout: 30000 
            });
          }
        } else {
          // Standard approach: Navigate to full URL (like 2023)
          try {
            await page.goto(url, {  // Full URL with hash (2023 style)
              waitUntil: "networkidle2",  // Wait for network idle (web components support)
              timeout: 30000
            });
            this.log.info('[PDF] Navigation successful');
          } catch (navError) {
            this.log.warn(`Navigation timeout: ${navError.message} - trying with domcontentloaded`);
            await page.goto(url, { 
              waitUntil: "domcontentloaded",
              timeout: 30000 
            });
            this.log.info('[PDF] Navigation successful (fallback)');
          }
        }
        
        // Check for login and handle if needed (skip if HTML login was used)
        if (!loginHtmlPath && credentials && credentials.username && credentials.password) {
          let needsLogin = false;
          try {
            needsLogin = await page.evaluate(() => {
              return document.querySelector('input[type="password"]') !== null;
            });
          } catch (evalErr) {
            this.log.debug(`Could not check for login: ${evalErr.message}`);
            needsLogin = false;
          }
          
          if (needsLogin) {
            this.log.info("Login page detected, attempting login...");
            
            try {
              await this.handleIoBrokerLogin(page, url, credentials);
              this.log.debug('Login function completed');
            } catch (loginErr) {
              this.log.warn(`Login failed: ${loginErr.message} - continuing anyway`);
            }
            
            // Check if page still alive after login
            if (page.isClosed()) {
              throw new Error('Page closed during login process');
            }
            
            // Wait for page to stabilize after login (2023 API: 10s → 5s)
            this.log.debug('Waiting 5s for page stabilization...');
            try {
              await page.waitForTimeout(5000);
            } catch (waitErr) {
              this.log.warn(`Wait timeout error: ${waitErr.message}`);
            }
            
            // Verify page is still alive
            if (page.isClosed()) {
              throw new Error('Page closed during post-login wait');
            }
            this.log.debug('Page still alive after login');
          }
        }
        
        // Additional wait if specified
        if (waitMethod && waitMethod in page) {
          await page[waitMethod](waitParameter);
        }
        
        // Wait for web components to fully render
        this.log.debug('Waiting for web components to render...');
        try {
          await page.evaluate(() => {
            return new Promise((resolve) => {
              // Wait for custom elements to be ready
              if (window.customElements) {
                Promise.all([
                  customElements.whenDefined('*') // Wait for all custom elements
                ]).catch(() => {}).finally(() => resolve());
              } else {
                resolve();
              }
              // Fallback timeout
              setTimeout(resolve, 3000);
            });
          });
          this.log.debug('Web components ready');
        } catch (e) {
          this.log.debug(`Web component wait skipped: ${e.message}`);
        }
        
        // Additional wait for web component rendering (dynamic content)
        await page.waitForTimeout(3000);
        this.log.debug('Final wait complete');
        
        // Check if page is still open
        if (page.isClosed()) {
          throw new Error('Page closed before PDF generation');
        }
        
        // Add timeout to PDF generation (30s for web components)
        const pdfOptions = {
          ...options,
          timeout: 10000,  // 10s → 30s for web components
          preferCSSPageSize: false,
          printBackground: options.printBackground !== false  // Default true
        };
        
        this.log.info('Starting PDF generation (timeout: 30s)...');
        const pdfStartTime = Date.now();
        const pdf = await page.pdf(pdfOptions);
        const pdfDuration = Date.now() - pdfStartTime;
        this.log.info(`PDF generated successfully in ${pdfDuration}ms`);
        if (storagePath) {
          this.log.debug(`Write PDF file to "${storagePath}"`);
          await this.writeFileAsync("0_userdata.0", storagePath, Buffer.from(pdf));
        }
        this.sendTo(obj.from, obj.command, { result: pdf }, obj.callback);
      } catch (e) {
        this.log.error(`Could not export PDF of "${url}": ${e.message}`);
        this.log.error(`Error stack: ${e.stack}`);
        this.sendTo(obj.from, obj.command, { 
          error: { 
            message: e.message, 
            stack: e.stack,
            name: e.name 
          } 
        }, obj.callback);
      } finally {
        try {
          if (page && !page.isClosed()) {
            // Close with timeout (5s max)
            await Promise.race([
              page.close(),
              new Promise((resolve) => setTimeout(resolve, 5000))
            ]);
          }
          if (customBrowser) {
            // Close custom browser with timeout
            await Promise.race([
              customBrowser.close(),
              new Promise((resolve) => setTimeout(resolve, 5000))
            ]);
            this.log.info("Custom browser closed");
          }
        } catch (closeError) {
          this.log.debug(`Error closing page/browser: ${closeError.message}`);
          // Ignore close errors - not critical
        }
        
        // Additional wait after browser close to allow cleanup
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Clean up temp user data dir if it was created
        if (tempUserDataDir) {
          try {
            const fs = require('fs');
            const rimraf = require('rimraf');
            if (fs.existsSync(tempUserDataDir)) {
              this.log.debug(`Cleaning up temp profile: ${tempUserDataDir}`);
              // Async cleanup - don't wait for it
              rimraf(tempUserDataDir, (err) => {
                if (err) {
                  this.log.debug(`Could not clean temp profile: ${err.message}`);
                }
              });
            }
          } catch (cleanupErr) {
            this.log.debug(`Profile cleanup error: ${cleanupErr.message}`);
          }
        }
      }
    } */else {
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
      try {
        const page = await this.browser.newPage();
        await page.goto(state.val, { waitUntil: "networkidle2" });
        await this.handleIoBrokerLogin(page, state.val, null);
        await this.waitForConditions(page);
        await page.screenshot(options);
        this.log.info("Screenshot sucessfully saved");
        await this.setStateAsync(id, state.val, true);
        await page.close();
      } catch (e) {
        this.log.error(`Could not take screenshot of "${state.val}": ${e.message}`);
      }
    }
  }
  /**
   * Determines the ScreenshotOptions by the current configuration states
   */
  async gatherScreenshotOptions() {
    const options = {};
    const filenameState = await this.getStateAsync("filename");
    if (filenameState && filenameState.val) {
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
      this.log.debug("Ingoring clip options, because full page is desired");
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
        return;
      }
    }
    return options;
  }
  /**
   * Handles ioBroker web login if login page is detected
   *
   * @param page active page object
   * @param url the URL being accessed
   * @param credentials optional credentials object with username and password
   */
  async handleIoBrokerLogin(page, url, credentials) {
    try {
      // Check if we're on an ioBroker page that requires login
      const isLoginPage = await page.evaluate(() => {
        // Check for common ioBroker login elements
        const hasLoginForm = document.querySelector('input[type="password"]') !== null;
        const hasUsernameField = document.querySelector('input[type="text"], input[type="email"], input[name="username"], input[id="username"]') !== null;
        return hasLoginForm && hasUsernameField;
      });

      if (!isLoginPage) {
        this.log.debug("No login form detected");
        return false;
      }

      this.log.info("ioBroker login page detected");

      // Get credentials from config or passed credentials
      let username, password;
      if (credentials && credentials.username && credentials.password) {
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

      // Try to find and fill login form
      // Common ioBroker VIS/Web login selectors
      const usernameSelectors = [
        'input[name="username"]',
        'input[id="username"]',
        'input[type="text"]',
        'input[type="email"]',
        '.login-username',
        '#login_username'
      ];

      const passwordSelectors = [
        'input[name="password"]',
        'input[id="password"]',
        'input[type="password"]',
        '.login-password',
        '#login_password'
      ];

      let usernameField = null;
      let passwordField = null;

      // Find username field
      for (const selector of usernameSelectors) {
        try {
          usernameField = await page.$(selector);
          if (usernameField) {
            this.log.debug(`Found username field with selector: ${selector}`);
            break;
          }
        } catch (e) {
          // Continue to next selector
        }
      }

      // Find password field
      for (const selector of passwordSelectors) {
        try {
          passwordField = await page.$(selector);
          if (passwordField) {
            this.log.debug(`Found password field with selector: ${selector}`);
            break;
          }
        } catch (e) {
          // Continue to next selector
        }
      }

      if (!usernameField || !passwordField) {
        this.log.warn("Could not find login form fields");
        return false;
      }

      // Fill in credentials
      await usernameField.type(username);
      await passwordField.type(password);

      this.log.debug("Credentials entered, submitting form");

      // Try to submit the form
      const submitSelectors = [
        'button[type="submit"]',
        'input[type="submit"]',
        'button.login-button',
        '#login_submit',
        'button:contains("Login")',
        'button:contains("Anmelden")'
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
        } catch (e) {
          // Continue to next selector
        }
      }

      // If no submit button found, try pressing Enter
      if (!submitted) {
        await passwordField.press("Enter");
        this.log.debug("Submitted form with Enter key");
      }

      // Wait for navigation or login to complete
      // Use Promise.race to handle both navigation and timeout scenarios
      await Promise.race([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 5000 }).catch((err) => {
          this.log.debug(`No navigation detected after login: ${err.message}`);
          return Promise.resolve(); // Resolve to avoid error propagation
        }),
        new Promise((resolve) => setTimeout(resolve, 3000))
      ]);

      // Additional wait for any post-login scripts
      await new Promise((resolve) => setTimeout(resolve, 2000));

      this.log.info("Login completed successfully");
      return true;
    } catch (e) {
      this.log.warn(`Error during ioBroker login: ${e.message}`);
      return false;
    }
  }
  /**
   * Validates that the given path is valid to save a screenshot too, prevents node_modules and dataDir
   * Also creates the directory if it doesn't exist
   *
   * @param path path to check
   */
  validatePath(path) {
    path = (0, import_path.resolve)((0, import_path.normalize)(path));
    this.log.debug(`Checking path "${path}"`);
    if (path.startsWith(utils.getAbsoluteDefaultDataDir())) {
      throw new Error("Screenshots cannot be stored inside the ioBroker storage");
    }
    if (path.includes(`${import_path.sep}node_modules${import_path.sep}`)) {
      throw new Error("Screenshots cannot be stored inside a node_modules folder");
    }

    // Create directory if it doesn't exist
    const directory = (0, import_path.dirname)(path);
    if (!import_fs.existsSync(directory)) {
      this.log.info(`Creating directory: ${directory}`);
      try {
        import_fs.mkdirSync(directory, { recursive: true });
        this.log.debug(`Directory created successfully: ${directory}`);
      } catch (err) {
        throw new Error(`Could not create directory "${directory}": ${err.message}`);
      }
    }
  }
  /**
   * Waits until the user configured conditions are fullfilled
   *
   * @param page active page object
   */
  async waitForConditions(page) {
    var _a, _b;
    const selector = (_a = await this.getStateAsync("waitForSelector")) == null ? void 0 : _a.val;
    if (selector && typeof selector === "string") {
      this.log.debug(`Waiting for selector "${selector}"`);
      await page.waitForSelector(selector);
      return;
    }
    const renderTimeMs = (_b = await this.getStateAsync("renderTime")) == null ? void 0 : _b.val;
    if (renderTimeMs && typeof renderTimeMs === "number") {
      this.log.debug(`Waiting for timeout "${renderTimeMs}" ms`);
      await this.delay(renderTimeMs);
      return;
    }
  }
  /**
   * Extracts the ioBroker specific options from the message
   *
   * @param options obj.message part of a message passed by user
   */
  static extractIoBrokerOptionsFromMessage(options) {
    var _a;
    let storagePath;
    if (typeof ((_a = options.ioBrokerOptions) == null ? void 0 : _a.storagePath) === "string") {
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
    if ((0, import_tools.isObject)(options.viewportOptions) && typeof options.viewportOptions.width === "number" && typeof options.viewportOptions.height === "number") {
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
      if ((0, import_tools.isObject)(options.waitOption)) {
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
    var _a, _b;
    let credentials;
    if (((_a = options.loginCredentials) == null ? void 0 : _a.username) && ((_b = options.loginCredentials) == null ? void 0 : _b.password)) {
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
