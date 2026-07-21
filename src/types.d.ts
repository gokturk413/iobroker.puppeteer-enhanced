interface PuppeteerEnhancedAdapterConfig {
    additionalArgs: { Argument: string }[];
    useExternalBrowser: boolean;
    executablePath: string;
    webUsername: string;
    webPassword: string;
    /** Web adapter instance(s) that serve the screenshot endpoint. "*" = all */
    webInstance: string;
    /**
     * Maximum number of rendering operations (screenshots/PDFs) that may run in parallel.
     * On low-memory devices (e.g. Raspberry Pi) keep this at 1 to avoid running out of RAM.
     */
    maxParallelProcesses: number;
}
