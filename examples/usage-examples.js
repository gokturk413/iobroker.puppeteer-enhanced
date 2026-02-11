/**
 * Usage examples for iobroker.puppeteer adapter
 * These examples demonstrate the new features:
 * - Screenshot functionality
 * - PDF export functionality
 * - Automatic ioBroker web login
 */

// ============================================
// SCREENSHOT EXAMPLES
// ============================================

// Example 1: Simple screenshot
sendTo('puppeteer.0', 'screenshot', 'https://www.google.com', (result) => {
    if (result.error) {
        console.log('Error: ' + result.error.message);
    } else {
        console.log('Screenshot taken successfully');
    }
});

// Example 2: Screenshot with file path
sendTo('puppeteer.0', 'screenshot', {
    url: 'https://www.google.com',
    path: '/tmp/screenshot.png',
    fullPage: true
}, (result) => {
    console.log('Screenshot saved to /tmp/screenshot.png');
});

// Example 3: Screenshot with ioBroker storage
sendTo('puppeteer.0', 'screenshot', {
    url: 'https://www.google.com',
    ioBrokerOptions: {
        storagePath: 'screenshots/google.png'
    }
}, (result) => {
    console.log('Screenshot saved to ioBroker storage');
});

// Example 4: Screenshot with login credentials
sendTo('puppeteer.0', 'screenshot', {
    url: 'http://192.168.1.100:8082/vis/index.html',
    path: '/tmp/vis-screenshot.png',
    loginCredentials: {
        username: 'admin',
        password: 'mypassword'
    },
    fullPage: true
}, (result) => {
    console.log('VIS screenshot with login taken');
});

// Example 5: Screenshot with wait and viewport options
sendTo('puppeteer.0', 'screenshot', {
    url: 'https://www.example.com',
    path: '/tmp/example.png',
    waitOption: {
        waitForSelector: '#main-content'
    },
    viewportOptions: {
        width: 1920,
        height: 1080
    }
});

// ============================================
// PDF EXPORT EXAMPLES
// ============================================

// Example 6: Simple PDF export
sendTo('puppeteer.0', 'pdf', {
    url: 'https://www.google.com',
    path: '/tmp/google.pdf'
}, (result) => {
    if (result.error) {
        console.log('Error: ' + result.error.message);
    } else {
        console.log('PDF exported successfully');
    }
});

// Example 7: PDF with A4 format and margins
sendTo('puppeteer.0', 'pdf', {
    url: 'https://www.example.com',
    path: '/tmp/document.pdf',
    format: 'A4',
    printBackground: true,
    margin: {
        top: '20mm',
        right: '20mm',
        bottom: '20mm',
        left: '20mm'
    }
}, (result) => {
    console.log('A4 PDF with margins created');
});

// Example 8: Landscape PDF with header and footer
sendTo('puppeteer.0', 'pdf', {
    url: 'https://www.example.com',
    path: '/tmp/landscape.pdf',
    format: 'A4',
    landscape: true,
    displayHeaderFooter: true,
    headerTemplate: '<div style="font-size: 10px; text-align: center; width: 100%;">Header</div>',
    footerTemplate: '<div style="font-size: 10px; text-align: center; width: 100%;"><span class="pageNumber"></span>/<span class="totalPages"></span></div>',
    printBackground: true
});

// Example 9: PDF from ioBroker VIS with login
sendTo('puppeteer.0', 'pdf', {
    url: 'http://192.168.1.100:8082/vis/index.html',
    path: '/tmp/vis-export.pdf',
    loginCredentials: {
        username: 'admin',
        password: 'mypassword'
    },
    format: 'A4',
    printBackground: true,
    waitOption: {
        waitForTimeout: 3000  // Wait 3 seconds for VIS to load
    }
}, (result) => {
    console.log('VIS exported to PDF with authentication');
});

// Example 10: PDF saved to ioBroker storage
sendTo('puppeteer.0', 'pdf', {
    url: 'https://www.example.com',
    ioBrokerOptions: {
        storagePath: 'documents/report.pdf'
    },
    format: 'A4',
    printBackground: true,
    margin: {
        top: '10mm',
        bottom: '10mm'
    }
});

// Example 11: Custom page size PDF
sendTo('puppeteer.0', 'pdf', {
    url: 'https://www.example.com',
    path: '/tmp/custom.pdf',
    width: '210mm',
    height: '297mm',  // A4 dimensions
    printBackground: true,
    scale: 0.8
});

// Example 12: PDF with specific page ranges
sendTo('puppeteer.0', 'pdf', {
    url: 'https://www.example.com',
    path: '/tmp/pages.pdf',
    pageRanges: '1-3, 5',  // Export pages 1, 2, 3, and 5
    format: 'A4'
});

// ============================================
// CONFIGURATION EXAMPLES
// ============================================

/**
 * Adapter Configuration Settings:
 * 
 * In the adapter instance settings, you can configure:
 * 
 * 1. Web Username: The username for ioBroker web interface login
 * 2. Web Password: The password for ioBroker web interface login
 * 3. Use External Browser: Enable to use an external Chrome/Chromium installation
 * 4. Executable Path: Path to external browser (if enabled)
 * 5. Additional Arguments: Extra launch arguments for Puppeteer/Chrome
 * 
 * Login credentials configured in adapter settings will be used automatically
 * when a login page is detected. You can override them per-message using
 * the loginCredentials option.
 */

// ============================================
// STATE-BASED SCREENSHOT (Original Method)
// ============================================

// Example 13: Using states to take screenshot
setState('puppeteer.0.filename', '/tmp/state-screenshot.png', false);
setState('puppeteer.0.fullPage', true, false);
setState('puppeteer.0.url', 'https://www.google.com', false);  // This triggers the screenshot

// Example 14: Screenshot with crop options via states
setState('puppeteer.0.filename', '/tmp/cropped.png', false);
setState('puppeteer.0.fullPage', false, false);
setState('puppeteer.0.clipLeft', 0, false);
setState('puppeteer.0.clipTop', 0, false);
setState('puppeteer.0.clipWidth', 800, false);
setState('puppeteer.0.clipHeight', 600, false);
setState('puppeteer.0.url', 'https://www.google.com', false);

// Example 15: Screenshot with wait for selector via states
setState('puppeteer.0.filename', '/tmp/waited.png', false);
setState('puppeteer.0.waitForSelector', '#main-content', false);
setState('puppeteer.0.url', 'https://www.example.com', false);
