import { Adapter, type AdapterOptions, getAbsoluteDefaultDataDir } from '@iobroker/adapter-core';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { dirname, normalize, resolve, sep, join } from 'node:path';
import { existsSync, mkdirSync, promises as fsPromises } from 'node:fs';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { RenderLimiter } from './lib/renderLimiter';

// Set global EventEmitter max listeners to avoid warnings
EventEmitter.defaultMaxListeners = 30;
process.setMaxListeners?.(30);

interface LoginCredentials {
    username: string;
    password: string;
}

class PuppeteerAdapter extends Adapter {
    declare config: PuppeteerEnhancedAdapterConfig;
    private browser: Browser | undefined;
    /** Track active PDF browser instances so they can be closed on unload */
    private readonly activePdfBrowsers = new Set<Browser>();
    /** Limits how many render operations (screenshots/PDFs) may run in parallel */
    private readonly renderLimiter = new RenderLimiter(1);

    public constructor(options: Partial<AdapterOptions> = {}) {
        super({ ...options, name: 'puppeteer-enhanced' });
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));
        this.on('message', this.onMessage.bind(this));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    private async onReady(): Promise<void> {
        this.renderLimiter.setMax(Number(this.config.maxParallelProcesses ?? 10));
        this.log.info(`Maximum parallel rendering processes: ${this.renderLimiter.maxParallel}`);

        let additionalArgs: string[] | undefined;
        if (this.config.additionalArgs) {
            additionalArgs = this.config.additionalArgs.map(entry => entry.Argument);
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
            '--disable-gpu',
        ];

        const launchOptions: Record<string, unknown> = {
            headless: true,
            defaultViewport: null,
            executablePath: this.config.useExternalBrowser ? this.config.executablePath : undefined,
            args: additionalArgs && additionalArgs.length > 0 ? additionalArgs : defaultArgs,
            ignoreHTTPSErrors: true,
            dumpio: true, // Show browser console output for debugging
            protocolTimeout: 180000, // 3 minutes protocol timeout
        };

        this.log.info(`Launching browser with options: ${JSON.stringify(launchOptions)}`);

        try {
            this.browser = await puppeteer.launch(launchOptions);
            this.log.info('Browser launched successfully');
        } catch (launchError: any) {
            this.log.error(`Failed to launch browser: ${launchError.message}`);
            this.log.error(`Error stack: ${launchError.stack}`);
            throw launchError;
        }

        this.subscribeStates('url');
        this.log.info('Ready to take screenshots and export PDFs');
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     *
     * @param callback callback which needs to be called
     */
    private async onUnload(callback: () => void): Promise<void> {
        try {
            // Close all active PDF browsers first
            if (this.activePdfBrowsers.size > 0) {
                this.log.warn(`Closing ${this.activePdfBrowsers.size} active PDF browser(s)...`);

                const closePromises: Promise<void>[] = [];
                for (const browser of this.activePdfBrowsers) {
                    closePromises.push(
                        (async (): Promise<void> => {
                            try {
                                await browser.close();
                                this.log.debug('PDF browser closed during shutdown');
                            } catch (err: any) {
                                this.log.debug(`PDF browser close error: ${err.message}`);
                            }
                        })(),
                    );
                }

                // Wait for all browsers to close (max 10s)
                await Promise.race([
                    Promise.all(closePromises),
                    new Promise<void>(resolve => setTimeout(resolve, 10000)),
                ]);

                this.activePdfBrowsers.clear();
                this.log.info('All PDF browsers closed');
            }

            // Close main screenshot browser
            if (this.browser) {
                this.log.info('Closing main browser');
                await Promise.race([this.browser.close(), new Promise<void>(resolve => setTimeout(resolve, 5000))]);
                this.browser = undefined;
                // Wait for cleanup
                await new Promise<void>(resolve => setTimeout(resolve, 2000));
            }

            this.log.info('Adapter unloaded successfully');
            callback();
        } catch (e: any) {
            this.log.debug(`Error during unload: ${e.message}`);
            callback();
        }
    }

    /**
     * Restarts the main browser if it is not connected anymore
     */
    private async ensureBrowser(): Promise<void> {
        if (!this.browser || !this.browser.connected) {
            this.log.warn('Browser not connected, attempting to restart...');
            if (this.browser) {
                await this.browser.close().catch(() => {});
            }
            await this.onReady();
            this.log.info('Browser restarted successfully');
        }
    }

    /**
     * Acquires a render slot, waiting in a FIFO queue if the configured maximum number
     * of parallel rendering processes is already reached.
     */
    private acquireRenderSlot(): Promise<void> {
        if (this.renderLimiter.runningCount >= this.renderLimiter.maxParallel) {
            this.log.debug(
                `Rendering limit reached (${this.renderLimiter.maxParallel}), queuing request (${this.renderLimiter.queueLength + 1} waiting)`,
            );
        }
        return this.renderLimiter.acquire();
    }

    /**
     * Releases a previously acquired render slot and lets the next queued request proceed.
     */
    private releaseRenderSlot(): void {
        this.renderLimiter.release();
    }

    /**
     * Is called when a message is received
     *
     * @param obj the ioBroker message object
     */
    private async onMessage(obj: ioBroker.Message): Promise<void> {
        if (!obj) {
            return;
        }
        this.log.debug(`Received command: ${obj.command}`);

        // Check if browser is still connected
        try {
            await this.ensureBrowser();
        } catch (e) {
            this.log.error(`Failed to restart browser: ${(e as Error).message}`);
            this.sendTo(
                obj.from,
                obj.command,
                { error: { message: 'Browser not available', stack: (e as Error).stack } },
                obj.callback,
            );
            return;
        }

        if (obj.command === 'screenshot') {
            await this.handleScreenshotMessage(obj);
        } else if (obj.command === 'pdf') {
            await this.handlePdfMessage(obj);
        } else {
            this.log.error(`Unsupported message command: ${obj.command}`);
            this.sendTo(
                obj.from,
                obj.command,
                { error: new Error(`Unsupported message command: ${obj.command}`) },
                obj.callback,
            );
        }
    }

    /**
     * Handles the "screenshot" message command
     *
     * @param obj the ioBroker message object
     */
    private async handleScreenshotMessage(obj: ioBroker.Message): Promise<void> {
        let url: string | undefined;
        let options: Record<string, any>;
        if (typeof obj.message === 'string') {
            url = obj.message;
            options = {};
        } else if (obj.message && typeof obj.message === 'object') {
            url = (obj.message as Record<string, any>).url;
            options = { ...(obj.message as Record<string, any>) };
            delete options.url;
        } else {
            options = {};
        }

        const { waitMethod, waitParameter } = PuppeteerAdapter.extractWaitOptionFromMessage(options);
        const { storagePath } = PuppeteerAdapter.extractIoBrokerOptionsFromMessage(options);
        const { credentials } = PuppeteerAdapter.extractLoginCredentials(options);
        const viewport = PuppeteerAdapter.extractViewportOptionsFromMessage(options);
        let page: Page | undefined;
        let customBrowser: Browser | undefined;
        let tempUserDataDir: string | undefined; // Declare here to be accessible in finally block

        // Respect the configured maximum number of parallel rendering processes
        await this.acquireRenderSlot();
        try {
            if (options.path) {
                this.validatePath(options.path);
            }

            // If custom Chrome executable specified, launch separate browser instance
            if (options.executablePath) {
                this.log.info(`Using custom Chrome: ${options.executablePath}`);

                tempUserDataDir = join(tmpdir(), `pup_chrome_${Date.now()}`);

                customBrowser = await puppeteer.launch({
                    headless: false,
                    executablePath: options.executablePath,
                    defaultViewport: null,
                    userDataDir: tempUserDataDir, // Persistent profile to avoid EBUSY
                    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-logging'],
                    ignoreHTTPSErrors: true,
                    dumpio: false, // Disable to prevent chrome_debug.log locks
                    protocolTimeout: 180000,
                } as Parameters<typeof puppeteer.launch>[0]);
                page = await customBrowser.newPage();
            } else {
                page = await this.browser!.newPage();
            }

            if (viewport) {
                await page.setViewport(viewport);
            }

            // Wait for page to be ready
            await new Promise<void>(resolve => setTimeout(resolve, 500));

            // Check if loginHtmlPath is provided (2023 approach)
            const loginHtmlPath: string | undefined = options.loginHtmlPath;

            if (loginHtmlPath && credentials?.username && credentials.password) {
                // 2023 approach: Load HTML file, then navigate to VIS
                this.log.info(`Using HTML login file: ${loginHtmlPath}`);

                try {
                    const loginHtml = await fsPromises.readFile(loginHtmlPath, 'utf8');
                    await page.setContent(loginHtml);
                    this.log.info('Login HTML loaded');

                    // Wait for login form to process
                    await new Promise<void>(resolve => setTimeout(resolve, 2000));

                    // Navigate to target URL
                    await page.goto(url!, { waitUntil: 'domcontentloaded', timeout: 30000 });
                    this.log.info('[Screenshot] Navigation successful after HTML login');

                    // Wait for page to load completely
                    await new Promise<void>(resolve => setTimeout(resolve, 3000));
                } catch (htmlError: any) {
                    this.log.warn(`HTML login failed: ${htmlError.message} - trying standard login`);
                    // Fallback to standard login approach
                    await page.goto(url!, { waitUntil: 'domcontentloaded', timeout: 30000 });
                }
            } else {
                // Standard approach: Navigate to full URL
                try {
                    await page.goto(url!, { waitUntil: 'networkidle2', timeout: 30000 });
                    this.log.info('[Screenshot] Navigation successful');
                } catch (navError: any) {
                    this.log.warn(`Navigation timeout: ${navError.message} - trying with domcontentloaded`);
                    await page.goto(url!, { waitUntil: 'domcontentloaded', timeout: 30000 });
                    this.log.info('[Screenshot] Navigation successful (fallback)');
                }
            }

            // Check for login and handle if needed (skip if HTML login was used)
            if (!loginHtmlPath && credentials?.username && credentials.password) {
                let needsLogin = false;
                try {
                    needsLogin = await page.evaluate(() => document.querySelector('input[type="password"]') !== null);
                } catch (evalErr: any) {
                    this.log.debug(`Could not check for login: ${evalErr.message}`);
                    needsLogin = false;
                }

                if (needsLogin) {
                    this.log.info('Login page detected, attempting login...');
                    try {
                        await this.handleIoBrokerLogin(page, url!, credentials);
                        this.log.debug('Login function completed');
                    } catch (loginErr: any) {
                        this.log.warn(`Login failed: ${loginErr.message} - continuing anyway`);
                    }

                    if (page.isClosed()) {
                        throw new Error('Page closed during login process');
                    }

                    this.log.debug('Waiting 5s for page stabilization...');
                    try {
                        await new Promise<void>(resolve => setTimeout(resolve, 5000));
                    } catch (waitErr: any) {
                        this.log.warn(`Wait timeout error: ${waitErr.message}`);
                    }

                    if (page.isClosed()) {
                        throw new Error('Page closed during post-login wait');
                    }
                    this.log.debug('Page still alive after login');
                }
            }

            // Additional wait if specified
            if (waitMethod) {
                if (waitMethod in page && typeof (page as any)[waitMethod] === 'function') {
                    await (page as any)[waitMethod](waitParameter);
                } else if (waitMethod === 'waitForTimeout' || waitMethod === 'delay') {
                    await new Promise<void>(resolve => setTimeout(resolve, waitParameter as number));
                }
            }

            // Wait for web components to render (for ioBroker.webui etc.)
            this.log.debug('Waiting for web components...');
            await new Promise<void>(resolve => setTimeout(resolve, 2000));

            if (page.isClosed()) {
                throw new Error('Page closed before screenshot');
            }

            this.log.info('Taking screenshot...');
            const img = await page.screenshot(options);
            if (storagePath) {
                this.log.debug(`Write file to "${storagePath}"`);
                await this.writeFileAsync('0_userdata.0', storagePath, Buffer.from(img));
            }
            this.sendTo(obj.from, obj.command, { result: img }, obj.callback);
        } catch (e: any) {
            this.log.error(`Could not take screenshot of "${url}": ${e.message}`);
            this.log.error(`Error stack: ${e.stack}`);
            this.sendTo(
                obj.from,
                obj.command,
                { error: { message: e.message, stack: e.stack, name: e.name } },
                obj.callback,
            );
        } finally {
            try {
                if (page && !page.isClosed()) {
                    await Promise.race([page.close(), new Promise<void>(resolve => setTimeout(resolve, 5000))]);
                }
                if (customBrowser) {
                    await Promise.race([
                        customBrowser.close(),
                        new Promise<void>(resolve => setTimeout(resolve, 5000)),
                    ]);
                    this.log.info('Custom browser closed');
                }
            } catch (closeError: any) {
                this.log.debug(`Error closing page/browser: ${closeError.message}`);
            }

            // Additional wait after browser close to allow cleanup
            await new Promise<void>(resolve => setTimeout(resolve, 2000));

            // Clean up temp user data dir if it was created
            if (tempUserDataDir) {
                try {
                    if (existsSync(tempUserDataDir)) {
                        this.log.debug(`Cleaning up temp profile: ${tempUserDataDir}`);
                        fsPromises
                            .rm(tempUserDataDir, { recursive: true, force: true })
                            .catch(err => this.log.debug(`Could not clean temp profile: ${(err as Error).message}`));
                    }
                } catch (cleanupErr) {
                    this.log.debug(`Profile cleanup error: ${(cleanupErr as Error).message}`);
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
    private async handlePdfMessage(obj: ioBroker.Message): Promise<void> {
        this.log.info(`[PDF] Command received from ${obj.from}`);
        this.log.debug(`[PDF] Has callback: ${!!obj.callback}`);

        let url: string | undefined;
        let options: Record<string, any>;
        let loginaddressUrl: string | undefined;
        if (typeof obj.message === 'string') {
            url = obj.message;
            options = {};
        } else {
            const message = obj.message as Record<string, any>;
            loginaddressUrl = message.loginaddressurl;
            url = message.url;
            options = { ...message };
            delete options.url;
        }

        const { waitMethod, waitParameter } = PuppeteerAdapter.extractWaitOptionFromMessage(options);
        const { storagePath } = PuppeteerAdapter.extractIoBrokerOptionsFromMessage(options);
        const { credentials } = PuppeteerAdapter.extractLoginCredentials(options);
        // waitMethod/waitParameter are kept for API compatibility with the screenshot command
        void waitMethod;
        void waitParameter;
        let browser: Browser | undefined;
        let page: Page | undefined;

        // Respect the configured maximum number of parallel rendering processes
        await this.acquireRenderSlot();
        try {
            // Create directory if path specified
            if (options.path) {
                const directory = dirname(options.path);
                if (!existsSync(directory)) {
                    this.log.info(`[PDF] Creating directory: ${directory}`);
                    mkdirSync(directory, { recursive: true });
                    this.log.debug('[PDF] Directory created successfully');
                }
            }

            const pdfOptions: Record<string, any> = {
                ...options,
                timeout: 30000, // 30s for web components
                preferCSSPageSize: false,
                printBackground: options.printBackground !== false, // Default true
            };

            // Remove path from pdfOptions - we'll write manually
            delete pdfOptions.path;

            const loginHtmlPath: string | undefined = options.loginHtmlPath;

            this.log.info('[PDF] Launching browser...');
            browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
                // Use pipe instead of WebSocket to reduce socket connections
                pipe: true,
                ignoreHTTPSErrors: true,
            } as Parameters<typeof puppeteer.launch>[0]);

            // Track this browser instance
            this.activePdfBrowsers.add(browser);
            this.log.debug(`[PDF] Browser tracked (total active: ${this.activePdfBrowsers.size})`);

            // Set max listeners to avoid warnings
            const browserProcess = browser.process();
            if (browserProcess) {
                browserProcess.setMaxListeners(30);
                this.log.debug('[PDF] Browser process max listeners set to 30');
            }

            this.log.debug('[PDF] Browser launched, creating new page...');
            page = await browser.newPage();

            if (loginHtmlPath && credentials?.username && credentials.password) {
                // 2023 approach: Load HTML file, then navigate to VIS
                this.log.info(`Using HTML login file: ${loginHtmlPath}`);
                try {
                    const loginHtml = await fsPromises.readFile(loginHtmlPath, 'utf8');
                    await page.setContent(loginHtml);
                    this.log.info('Login HTML loaded');
                    await new Promise<void>(resolve => setTimeout(resolve, 5000));
                } catch (htmlError: any) {
                    this.log.warn(`HTML login failed: ${htmlError.message} - trying standard login`);
                }
            }

            // Check for login and handle if needed (skip if HTML login was used)
            if (!loginHtmlPath && credentials?.username && credentials.password) {
                this.log.info('Login page detected, attempting login...');
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
                    this.log.debug('Login function completed');
                } catch (loginErr: any) {
                    this.log.warn(`Login failed: ${loginErr.message} - continuing anyway`);
                }
            }

            await new Promise<void>(resolve => setTimeout(resolve, 10000));
            await page.goto(url!, { waitUntil: 'networkidle2' });
            await new Promise<void>(resolve => setTimeout(resolve, 10000));
            const pdf = await page.pdf(pdfOptions);

            // Write PDF to file
            if (options.path) {
                this.log.info(`[PDF] Writing to file system: "${options.path}"`);
                await fsPromises.writeFile(options.path, pdf);
            } else if (storagePath) {
                this.log.info(`[PDF] Writing to ioBroker storage: "${storagePath}"`);
                await this.writeFileAsync('0_userdata.0', storagePath, Buffer.from(pdf));
            }

            // Close page first
            if (page && !page.isClosed()) {
                this.log.debug('[PDF] Closing page...');
                try {
                    await page.close();
                    this.log.debug('[PDF] Page closed');
                } catch (pageErr: any) {
                    this.log.debug(`[PDF] Page close error (ignored): ${pageErr.message}`);
                }
            }

            // Then close browser and cleanup connections
            if (browser) {
                this.log.debug('[PDF] Closing browser...');
                try {
                    await browser.close();
                    this.activePdfBrowsers.delete(browser);
                    this.log.debug(`[PDF] Browser removed from tracking (remaining: ${this.activePdfBrowsers.size})`);
                    this.log.debug('[PDF] Browser closed successfully');
                } catch (browserErr: any) {
                    this.log.debug(`[PDF] Browser close error (ignored): ${browserErr.message}`);
                }
            }

            this.log.info(`[PDF] Export completed successfully! PDF size: ${pdf.length} bytes`);

            const response = {
                success: true,
                result: pdf,
                size: pdf.length,
                path: options.path || storagePath,
                timestamp: new Date().toISOString(),
            };

            this.sendTo(obj.from, obj.command, response, obj.callback);
        } catch (e: any) {
            this.log.error(`[PDF] Export failed: ${e.message}`);
            this.log.error(`[PDF] Error type: ${e.name}`);
            this.log.error(`[PDF] Error stack: ${e.stack}`);

            // Cleanup after error
            try {
                if (page && !page.isClosed()) {
                    await page.close();
                }
            } catch (pageCloseErr: any) {
                this.log.debug(`[PDF] Page close error (ignored): ${pageCloseErr.message}`);
            }

            try {
                if (browser) {
                    await browser.close();
                    this.activePdfBrowsers.delete(browser);
                }
            } catch (browserCloseErr: any) {
                this.log.debug(`[PDF] Browser close error (ignored): ${browserCloseErr.message}`);
            }

            const errorResponse = {
                success: false,
                error: e.message || e.toString() || 'Unknown error',
                errorType: e.name || 'Error',
                errorDetails: { message: e.message, stack: e.stack, name: e.name, toString: e.toString() },
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
    private async onStateChange(id: string, state: ioBroker.State | null | undefined): Promise<void> {
        if (!this.browser) {
            return;
        }
        if (state && state.val && !state.ack) {
            const options = await this.gatherScreenshotOptions();
            if (!options.path) {
                this.log.error('Please specify a filename before taking a screenshot');
                return;
            }
            try {
                this.validatePath(options.path);
            } catch (e: any) {
                this.log.error(`Cannot take screenshot: ${e.message}`);
                return;
            }
            this.log.debug(`Screenshot options: ${JSON.stringify(options)}`);
            this.log.info(`Taking screenshot of "${state.val}"`);

            // Respect the configured maximum number of parallel rendering processes
            await this.acquireRenderSlot();
            try {
                const page = await this.browser.newPage();
                await page.goto(state.val as string, { waitUntil: 'networkidle2' });
                await this.handleIoBrokerLogin(page, state.val as string, null);
                await this.waitForConditions(page);
                await page.screenshot(options);
                this.log.info('Screenshot successfully saved');
                await this.setStateAsync(id, state.val, true);
                await page.close();
            } catch (e: any) {
                this.log.error(`Could not take screenshot of "${state.val}": ${e.message}`);
            } finally {
                this.releaseRenderSlot();
            }
        }
    }

    /**
     * Determines the ScreenshotOptions by the current configuration states
     */
    private async gatherScreenshotOptions(): Promise<Record<string, any>> {
        const options: Record<string, any> = {};
        const filenameState = await this.getStateAsync('filename');
        if (filenameState?.val) {
            options.path = filenameState.val;
        }
        const fullPageState = await this.getStateAsync('fullPage');
        if (fullPageState) {
            options.fullPage = !!fullPageState.val;
        }
        if (!options.fullPage) {
            const clipOptions = await this.gatherScreenshotClipOptions();
            if (clipOptions) {
                options.clip = clipOptions;
            }
        } else {
            this.log.debug('Ignoring clip options, because full page is desired');
        }
        return options;
    }

    /**
     * Determines the ScreenshotClipOptions by the current configuration states
     */
    private async gatherScreenshotClipOptions(): Promise<Record<string, number> | undefined> {
        const options: Record<string, number> = {};
        const clipAttributes: Record<string, string> = {
            clipLeft: 'x',
            clipTop: 'y',
            clipHeight: 'height',
            clipWidth: 'width',
        };
        for (const [id, attributeName] of Object.entries(clipAttributes)) {
            const clipAttributeState = await this.getStateAsync(id);
            if (clipAttributeState && typeof clipAttributeState.val === 'number') {
                options[attributeName] = clipAttributeState.val;
            } else {
                this.log.debug(`Ignoring clip, because "${id}" is not configured`);
                return undefined;
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
    private async handleIoBrokerLogin(page: Page, url: string, credentials: LoginCredentials | null): Promise<boolean> {
        try {
            const isLoginPage = await page.evaluate(() => {
                const hasLoginForm = document.querySelector('input[type="password"]') !== null;
                const hasUsernameField =
                    document.querySelector(
                        'input[type="text"], input[type="email"], input[name="username"], input[id="username"]',
                    ) !== null;
                return hasLoginForm && hasUsernameField;
            });

            if (!isLoginPage) {
                this.log.debug('No login form detected');
                return false;
            }

            this.log.info('ioBroker login page detected');

            let username: string;
            let password: string;
            if (credentials?.username && credentials.password) {
                username = credentials.username;
                password = credentials.password;
            } else if (this.config.webUsername && this.config.webPassword) {
                username = this.config.webUsername;
                password = this.config.webPassword;
            } else {
                this.log.warn('No credentials configured for ioBroker web login');
                return false;
            }

            this.log.debug('Attempting to login to ioBroker web interface');

            const usernameSelectors = [
                'input[name="username"]',
                'input[id="username"]',
                'input[type="text"]',
                'input[type="email"]',
                '.login-username',
                '#login_username',
            ];

            const passwordSelectors = [
                'input[name="password"]',
                'input[id="password"]',
                'input[type="password"]',
                '.login-password',
                '#login_password',
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
                    // Continue to next selector
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
                    // Continue to next selector
                }
            }

            if (!usernameField || !passwordField) {
                this.log.warn('Could not find login form fields');
                return false;
            }

            await usernameField.type(username);
            await passwordField.type(password);

            this.log.debug('Credentials entered, submitting form');

            const submitSelectors = [
                'button[type="submit"]',
                'input[type="submit"]',
                'button.login-button',
                '#login_submit',
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
                    // Continue to next selector
                }
            }

            if (!submitted) {
                await passwordField.press('Enter');
                this.log.debug('Submitted form with Enter key');
            }

            // Wait for navigation or login to complete
            await Promise.race([
                page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch((err: any) => {
                    this.log.debug(`No navigation detected after login: ${err.message}`);
                }),
                new Promise<void>(resolve => setTimeout(resolve, 3000)),
            ]);

            await new Promise<void>(resolve => setTimeout(resolve, 2000));

            this.log.info('Login completed successfully');
            return true;
        } catch (e: any) {
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
    private validatePath(path: string): void {
        path = resolve(normalize(path));
        this.log.debug(`Checking path "${path}"`);
        if (path.startsWith(getAbsoluteDefaultDataDir())) {
            throw new Error('Screenshots cannot be stored inside the ioBroker storage');
        }
        if (path.includes(`${sep}node_modules${sep}`)) {
            throw new Error('Screenshots cannot be stored inside a node_modules folder');
        }

        const directory = dirname(path);
        if (!existsSync(directory)) {
            this.log.info(`Creating directory: ${directory}`);
            try {
                mkdirSync(directory, { recursive: true });
                this.log.debug(`Directory created successfully: ${directory}`);
            } catch (err: any) {
                throw new Error(`Could not create directory "${directory}": ${err.message}`);
            }
        }
    }

    /**
     * Waits until the user configured conditions are fulfilled
     *
     * @param page active page object
     */
    private async waitForConditions(page: Page): Promise<void> {
        const selector = (await this.getStateAsync('waitForSelector'))?.val;
        if (selector && typeof selector === 'string') {
            this.log.debug(`Waiting for selector "${selector}"`);
            await page.waitForSelector(selector);
            return;
        }
        const renderTimeMs = (await this.getStateAsync('renderTime'))?.val;
        if (renderTimeMs && typeof renderTimeMs === 'number') {
            this.log.debug(`Waiting for timeout "${renderTimeMs}" ms`);
            await this.delay(renderTimeMs);
        }
    }

    /**
     * Extracts the ioBroker specific options from the message
     *
     * @param options obj.message part of a message passed by user
     */
    private static extractIoBrokerOptionsFromMessage(options: Record<string, any>): { storagePath?: string } {
        let storagePath: string | undefined;
        if (typeof options.ioBrokerOptions?.storagePath === 'string') {
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
    private static extractViewportOptionsFromMessage(
        options: Record<string, any>,
    ): { width: number; height: number } | undefined {
        let viewportOptions: { width: number; height: number } | undefined;
        if (
            typeof options.viewportOptions === 'object' &&
            options.viewportOptions !== null &&
            typeof options.viewportOptions.width === 'number' &&
            typeof options.viewportOptions.height === 'number'
        ) {
            viewportOptions = options.viewportOptions as { width: number; height: number };
        }
        delete options.viewportOptions;
        return viewportOptions;
    }

    /**
     * Extracts the waitOption from a message
     *
     * @param options obj.message part of a message passed by user
     */
    private static extractWaitOptionFromMessage(options: Record<string, any>): {
        waitMethod?: string;
        waitParameter?: unknown;
    } {
        let waitMethod: string | undefined;
        let waitParameter: unknown;
        if ('waitOption' in options) {
            if (options.waitOption && typeof options.waitOption === 'object') {
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
    private static extractLoginCredentials(options: Record<string, any>): { credentials?: LoginCredentials } {
        let credentials: LoginCredentials | undefined;
        if (options.loginCredentials?.username && options.loginCredentials?.password) {
            credentials = {
                username: options.loginCredentials.username,
                password: options.loginCredentials.password,
            };
        }
        delete options.loginCredentials;
        return { credentials };
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<AdapterOptions> | undefined) => new PuppeteerAdapter(options);
} else {
    // otherwise start the instance directly
    (() => new PuppeteerAdapter())();
}
