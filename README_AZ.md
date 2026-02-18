# ioBroker.puppeteer - Azərbaycan dilində təlimat

## Ümumi məlumat
Bu adapter Chrome əsaslı headless browser istifadə edərək ekran görüntüləri (screenshot) və PDF eksport funksiyalarını təmin edir.

## Yeni funksiyalar (v0.5.1 - Enhanced)

### 1. PDF Export 
İndi istənilən web səhifəni PDF formatında eksport edə bilərsiniz. Bütün Puppeteer PDF parametrləri dəstəklənir.

### 2. Avtomatik ioBroker Web Login
Adapter avtomatik olaraq ioBroker web login səhifələrini (məsələn, VIS) aşkar edir və konfiqurasiya edilmiş məlumatlarla login olur.

### 3. ✨ Custom Chrome Executable Support
İndi istənilən Chrome versiyasını (Chrome Beta, Canary, Edge, Brave) `executablePath` parametri ilə istifadə edə bilərsiniz.

### 4. ✨ Directory Auto-Creation
Export path-də qovluqlar avtomatik yaradılır (`recursive: true`).

### 5. ✨ Browser Stability Improvements
- Protocol timeout artırıldı (30s → 180s)
- Chrome crash-lərini azaldan arqumentlər əlavə edildi
- Browser reconnect mexanizmi

### 6. ✨ Hash Navigation Fix
Login-dən sonra URL hash-i (məsələn, `#DailyReport`) düzgün təyin olunur.

### 7. ✨ Debugging Mode
Headless mode-u söndürüb Chrome pəncərəsini görə bilərsiniz (development üçün).

## İstifadə nümunələri

### PDF Export nümunələri

#### Sadə PDF export
```javascript
sendTo('puppeteer.0', 'pdf', {
    url: 'https://www.google.com',
    path: '/tmp/google.pdf'
});
```

#### A4 formatında PDF (kənarlarla)
```javascript
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
});
```

#### Landscape (üfüqi) PDF
```javascript
sendTo('puppeteer.0', 'pdf', {
    url: 'https://www.example.com',
    path: '/tmp/landscape.pdf',
    format: 'A4',
    landscape: true,
    printBackground: true
});
```
#### ----------------Main worked-----------------------------------------------------
```javascript
sendTo('puppeteer-enhanced.0', 'pdf', {
    loginaddressurl: "http://127.0.0.1:8082/login/",
    url: 'http://127.0.0.1:8082/webui/runtime.html#screenName=test7',
    path: filename,
    loginCredentials: {
        username: 'oper1',
        password: 'Operator1'
    },
    format: 'A4',
    printBackground: true
}, (result) => {
    // Full debug log
    log('[PDF] Callback received: ' + JSON.stringify(result), 'debug');
    
    // Check if result exists
    if (!result) {
        log('✗ PDF ERROR: No result received', 'error');
        return;
    }
    
    // Check for error
    if (result.error) {
        log('✗ PDF ERROR: ' + result.error, 'error');
        
        if (result.errorType) {
            log('  Error Type: ' + result.errorType, 'error');
        }
        
        if (result.errorDetails && result.errorDetails.message) {
            log('  Details: ' + result.errorDetails.message, 'error');
        }
        
        // Special handling for timeout errors
        if (result.error.includes('timeout') || result.error.includes('Timeout')) {
            log('  → TIMEOUT: Səhifə yüklənməsi çox uzun çəkdi', 'warn');
            log('  → HƏLL: Timeout artırılıb (60s), yenidən cəhd edin', 'warn');
        }
        
        return;
    }
    
    // Check success flag
    if (!result.success) {
        log('✗ PDF FAILED: Success=false', 'error');
        return;
    }
    
    // Success
    log('✓ PDF Uğurla Yaradıldı!', 'info');
    log('  Ölçü: ' + result.size + ' bytes (' + Math.round(result.size/1024) + ' KB)', 'info');
    log('  Fayl: ' + result.path, 'info');
    
    if (result.timestamp) {
        log('  Tarix: ' + result.timestamp, 'info');
    }
});
```
### ioBroker VIS-dən PDF export (login ilə)
```javascript
sendTo('puppeteer.0', 'pdf', {
    url: 'http://192.168.1.100:8082/vis/index.html',
    path: '/tmp/vis-export.pdf',
    loginCredentials: {
        username: 'admin',
        password: 'sifrəniz'
    },
    format: 'A4',
    printBackground: true,
    waitOption: {
        waitForTimeout: 3000  // VIS-in yüklənməsi üçün 3 saniyə gözlə
    }
});
```

### ioBroker storage-ə PDF saxlama
```javascript
sendTo('puppeteer.0', 'pdf', {
    url: 'https://www.example.com',
    ioBrokerOptions: {
        storagePath: 'documents/report.pdf'
    },
    format: 'A4',
    printBackground: true
});
```

### ✨ Custom Chrome istifadə edərək PDF export
```javascript
sendTo('puppeteer-enhanced.0', 'pdf', {
    url: 'http://127.0.0.1:8082/vis/index.html#DailyReport',
    path: 'D:/reports/daily-report.pdf',
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    loginCredentials: {
        username: 'admin',
        password: 'şifrəniz'
    },
    format: 'A4',
    printBackground: true
});
```

### ✨ Avtomatik qovluq yaratma ilə tarix əsaslı PDF
```javascript
const now = new Date();
const year = now.getFullYear();
const month = String(now.getMonth() + 1).padStart(2, '0');
const day = String(now.getDate()).padStart(2, '0');
const hour = String(now.getHours()).padStart(2, '0');
const minute = String(now.getMinutes()).padStart(2, '0');

// Qovluqlar avtomatik yaradılacaq: D:/reports/2026/02/11/
const filename = `D:/reports/${year}/${month}/${day}/report_${hour}-${minute}.pdf`;

sendTo('puppeteer-enhanced.0', 'pdf', {
    url: 'http://127.0.0.1:8082/vis/index.html#DailyReport',
    path: filename,
    loginCredentials: {
        username: 'admin',
        password: 'şifrəniz'
    },
    format: 'A4',
    printBackground: true
});
```

### ✨ Hash-li URL ilə VIS view export (post-login navigation)
```javascript
// Login-dən sonra avtomatik olaraq #DailyReport view-a keçəcək
sendTo('puppeteer-enhanced.0', 'pdf', {
    url: 'http://127.0.0.1:8082/vis/index.html#DailyReport',
    path: 'D:/reports/daily-report.pdf',
    loginCredentials: {
        username: 'admin',
        password: 'şifrəniz'
    },
    format: 'A4',
    printBackground: true
});
```

### ✨ HTML Login File istifadə edərək (2023 approach)
```javascript
// HTML faylından login məlumatlarını yüklə və VIS-ə get
sendTo('puppeteer-enhanced.0', 'pdf', {
    url: 'http://127.0.0.1:8082/vis/index.html#GundelikReport',
    path: 'D:/Report/Gundelik/IL_2026/AY_02/GUN_12/gundelik_12_30.pdf',
    loginHtmlPath: 'E:/iob_Stansiya/iobroker-data/operlogin.html',
    loginCredentials: {
        username: 'admin',
        password: 'şifrəniz'
    },
    format: 'A4',
    printBackground: true
});
```

**Qeyd:** `loginHtmlPath` göstərilərsə, adapter HTML faylını yükləyir (5s), sonra target URL-ə navigate edir (10s), və PDF export edir. Bu yanaşma 2023-dəki Puppeteer API-ya uyğundur.

**2023 koddan miqrasiya:**
```javascript
// 2023 köhnə kod:
const browser = await puppeteer.launch();
const page = await browser.newPage();
var contentHtml = fs.readFileSync('E:/iob/operlogin.html', 'utf8');
await page.setContent(contentHtml);
await page.waitForTimeout(10000);  // Köhnə API
await page.goto('http://127.0.0.1:8082/vis/index.html#GundelikReport', {waitUntil: 'networkidle2'});
await page.waitForTimeout(10000);
await page.pdf({path: 'D:/report.pdf', format: 'A4'});
await browser.close();

// Yeni adapter (eyni funksionallıq):
sendTo('puppeteer-enhanced.0', 'pdf', {
    url: 'http://127.0.0.1:8082/vis/index.html#GundelikReport',
    path: 'D:/reports/daily_report.pdf',  // Absolute path - directory auto-created
    loginHtmlPath: 'E:/iob/operlogin.html',
    loginCredentials: { username: 'admin', password: 'pass' },
    format: 'A4',
    timeout: 30000  // Optional: 30s timeout (default: 30s)
}, (result) => {
    if (result.error || !result.success) {
        log('ERROR: ' + result.error.message, 'error');
    } else {
        log('✓ PDF: ' + result.size + ' bytes → ' + result.path, 'info');
    }
});
```

**Path İstifadəsi:**
- **Absolute path** (D:, E: etc.) - birbaşa file system-ə yazılır ✅
- **ioBroker storage** - relative path `ioBrokerOptions.storagePath` ilə

```javascript
// Absolute path (tövsiyə olunur)
sendTo('puppeteer-enhanced.0', 'pdf', {
    url: 'http://127.0.0.1:8082/webui/runtime.html',
    path: 'D:/reports/2026/02/daily.pdf',  // Auto-creates directory
    format: 'A4'
}, (result) => {
    if (result.success) {
        log(`✓ PDF saved: ${result.size} bytes`, 'info');
    }
});

// ioBroker storage (relative)
sendTo('puppeteer-enhanced.0', 'pdf', {
    url: 'http://127.0.0.1:8082/vis/index.html',
    format: 'A4',
    ioBrokerOptions: {
        storagePath: 'reports/daily.pdf'  // Stored in 0_userdata.0
    }
}, (result) => {
    if (result.success) {
        log(`✓ PDF: ${result.size} bytes → 0_userdata.0/${result.path}`, 'info');
    } else {
        log(`✗ Error: ${result.error.message}`, 'error');
    }
});
```

## Callback Response Strukturu

**Success:**
```javascript
{
    success: true,
    result: <Buffer>,  // PDF buffer (faylda saxlanılıb)
    size: 45678,       // PDF ölçüsü (bytes)
    path: 'D:/reports/daily.pdf'  // Fayl path-i
}
```

**Error:**
```javascript
{
    success: false,
    error: {
        message: 'Error message',
        stack: '...'
    }
}
```

**Script callback nümunəsi:**
```javascript
sendTo('puppeteer-enhanced.0', 'pdf', {
    url: 'http://127.0.0.1:8082/webui/runtime.html#screenName=test7',
    path: 'D:/reports/daily.pdf',
    loginCredentials: { username: 'oper1', password: 'Operator1' },
    format: 'A4'
}, (result) => {
    if (result.error || !result.success) {
        log('✗ PDF ERROR: ' + result.error.message, 'error');
    } else {
        log(`✓ PDF OK: ${result.size} bytes → ${result.path}`, 'info');
    }
});
```

## PDF Rendering Təkmilləşdirmələri və Stability

Adapter avtomatik olaraq PDF generation üçün:
- ✅ Page stability checks (page.isClosed())
- ✅ **Web Components dəstəyi** (ioBroker.webui, custom elements)
- ✅ networkidle2 navigation (dynamic content üçün)
- ✅ Custom elements wait (web component rendering)
- ✅ **60s navigation timeout** (web components üçün)
- ✅ **30s PDF generation timeout**
- ✅ preferCSSPageSize optimization
- ✅ Post-login wait optimization (5s)
- ✅ **Callback response** (success/error status)
- ✅ **Browser cleanup** (memory leak prevention)
- ✅ **EventEmitter optimization** (max listeners: 30)

**Memory & Performance:**
- Browser instance-lar avtomatik close olunur (həm success, həm error halında)
- Page və Browser düzgün cleanup edilir (memory leak yoxdur)
- **Browser cleanup**: `browser.close()` istifadəsi (process-i kill edir)
- **Pipe mode**: `pipe: true` - WebSocket əvəzinə pipe istifadəsi (az socket connection)
- **Global EventEmitter.defaultMaxListeners**: 50 (bütün EventEmitter-lər üçün)
- **Process event listeners**: 50 (SIGINT, SIGTERM, exit üçün kifayətdir)
- **Browser process listeners**: 50
- **Browser connection listeners**: 50 (WebSocket, pipe streams)
- **Page connection listeners**: 50 (WebSocket, pipe streams)
- **Active browser tracking**: Bütün açıq browser instance-ları track edilir
- **Shutdown cleanup**: Adapter bağlananda (restart/suspend) bütün browser-lər avtomatik bağlanır
- **Graceful shutdown**: 10s timeout ilə bütün browser-lər düzgün close olunur

⚠️ **Signal Listener Warning:**
Hər PDF request yeni browser launch edir və Node.js process signal listeners (SIGINT, SIGTERM) əlavə olur. 50+ paralel request olduqda warning görsənə bilər. Bu normal haldır və təhlükəli deyil. Production-da adətən 5-10 paralel request olur.

**Web Component Support:**
Adapter indi bu texnologiyalardan istifadə edən səhifələri dəstəkləyir:
- ioBroker.webui (`http://127.0.0.1:8082/webui/runtime.html`)
- Custom elements / Shadow DOM
- Dynamic JavaScript rendered content
- Lazy-loaded components

## Troubleshooting - Memory Leak Warnings

**Problem:**
```
MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 31 SIGINT listeners added to [process]
MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 31 SIGTERM listeners added to [process]
```

**Səbəb:**
Hər PDF request-də yeni browser launch olunur və browser process signal handlers (SIGINT, SIGTERM, exit, SIGHUP) əlavə olunur. Browser close() ediləndə bu listeners Node.js process-də qalır.

**Həll:**
✅ `browser.close()` istifadəsi (`disconnect()` əvəzinə) - process-i tamamilə öldürür
✅ Global `EventEmitter.defaultMaxListeners = 50` - çoxlu paralel request üçün
✅ Process max listeners: 50
✅ Browser pipe mode: `pipe: true` (WebSocket-dən az connection)
✅ Proper browser cleanup (həm success, həm error)

**İdeal Həll (gələcək versiyalarda):**
Shared browser instance istifadə etmək (screenshot kimi). Hər request üçün yalnız yeni page açmaq, browser-i reuse etmək.

**Debug Modunda:**
VS Code, Windsurf və ya development environment-də debug mode daha çox signal listener yaradır. Production-da az problem olur.

**Əgər hələ də warnings gəlirsə:**
1. Adapter restart: `iobroker restart puppeteer-enhanced.0`
2. Paralel PDF request sayını azaldın (max 5-10 eyni anda)
3. PDF request-lər arasında 1-2s interval verin

---

**Performance Timeline (Web Components):**
```
Navigation (networkidle2): ~3-5s
Login (if needed):         ~2s
Post-login wait:           5s
Web component render:      3s
Custom elements ready:     ~1-3s
PDF generation:            max 30s
────────────────────────────────────
Total:                     ~14-48s
```

**Performance Timeline (Static Pages):**
```
Navigation (networkidle2): ~1-2s
Login (if needed):         ~2s
Post-login wait:           5s
PDF generation:            max 30s
────────────────────────────────────
Total:                     ~8-39s
```

**Error Prevention:**
- Page crash detection hər addımda
- Graceful error handling
- Web component wait with fallback
- networkidle2 with domcontentloaded fallback

**Əgər PDF generation yavaş olarsa:**
```javascript
sendTo('puppeteer-enhanced.0', 'pdf', {
    url: 'http://127.0.0.1:8082/webui/runtime.html',
    path: 'D:/report.pdf',
    format: 'A4',
    timeout: 60000,  // 60s (çox mürəkkəb səhifələr üçün)
    preferCSSPageSize: false
});
```

### Screenshot nümunələri (login ilə)

#### VIS-dən screenshot (avtomatik login)
```javascript
sendTo('puppeteer.0', 'screenshot', {
    url: 'http://192.168.1.100:8082/vis/index.html',
    path: '/tmp/vis-screenshot.png',
    loginCredentials: {
        username: 'admin',
        password: 'sifrəniz'
    },
    fullPage: true
});
```

#### ioBroker storage-ə screenshot saxlama
```javascript
sendTo('puppeteer.0', 'screenshot', {
    url: 'http://192.168.1.100:8082/vis/index.html',
    ioBrokerOptions: {
        storagePath: 'screenshots/vis.png'
    },
    loginCredentials: {
        username: 'admin',
        password: 'sifrəniz'
    }
});
```

## Adapter konfiqurasiyası

Adapter parametrlərində aşağıdakıları konfiqurasiya edə bilərsiniz:

### ioBroker Web Login məlumatları
1. **Web Username**: ioBroker web interfeysi üçün istifadəçi adı
2. **Web Password**: ioBroker web interfeysi üçün şifrə

Bu məlumatlar konfiqurasiya edilərsə, adapter avtomatik olaraq login səhifələrini aşkar edib daxil olacaq.

### Digər parametrlər
- **Use External Browser**: Xarici Chrome/Chromium istifadə etmək üçün
- **Executable Path**: Xarici browser-in yolu
- **Additional Arguments**: Puppeteer üçün əlavə arqumentlər

## ✨ Custom Chrome Executable (Yeni!)

### Dəstəklənən browser-lər
Aşağıdakı Chrome əsaslı browser-ləri istifadə edə bilərsiniz:

```javascript
// Google Chrome
executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe'

// Google Chrome Beta
executablePath: 'C:/Program Files/Google/Chrome Beta/Application/chrome.exe'

// Google Chrome Canary
executablePath: 'C:/Users/YourName/AppData/Local/Google/Chrome SxS/Application/chrome.exe'

// Microsoft Edge
executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'

// Brave Browser
executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe'

// Chromium
executablePath: 'C:/Program Files/Chromium/Application/chrome.exe'
```

### İstifadə halları
- Müxtəlif Chrome versiyaları ilə test
- Spesifik extension-larla Chrome istifadə
- Corporate proxy ilə Chrome
- Debug Chrome instance

## PDF parametrləri

### Format parametrləri
- `format`: 'A4', 'A3', 'A5', 'Letter', 'Legal', 'Tabloid' və s.
- `landscape`: true/false (üfüqi/şaquli)
- `scale`: 0.1 - 2 arası (render miqyası)

### Kənar (Margin) parametrləri
```javascript
margin: {
    top: '20mm',
    right: '15mm',
    bottom: '20mm',
    left: '15mm'
}
```

### Başlıq və altlıq (Header/Footer)
```javascript
displayHeaderFooter: true,
headerTemplate: '<div style="font-size: 10px; text-align: center; width: 100%;">Başlıq</div>',
footerTemplate: '<div style="font-size: 10px; text-align: center; width: 100%;"><span class="pageNumber"></span>/<span class="totalPages"></span></div>'
```

### Digər PDF parametrləri
- `printBackground`: true - arxa fonları çap et
- `pageRanges`: '1-5, 8' - müəyyən səhifələri eksport et
- `width` və `height`: fərdi səhifə ölçüsü
- `preferCSSPageSize`: CSS @page parametrlərini istifadə et

## Login funksiyası necə işləyir?

1. Adapter səhifəni açır
2. Avtomatik olaraq login formasını axtarır (username və password sahələri)
3. Əgər tapılarsa və məlumatlar mövcuddursa, avtomatik login olur
4. Login məlumatları iki yolla təqdim oluna bilər:
   - Adapter konfiqurasiyasında (bütün sorğular üçün)
   - Hər sorğuda `loginCredentials` parametri ilə (fərdi)

## Gözləmə (Wait) parametrləri

### Selector üçün gözləmə
```javascript
waitOption: {
    waitForSelector: '#element-id'
}
```

### Zaman üçün gözləmə
```javascript
waitOption: {
    waitForTimeout: 5000  // 5 saniyə
}
```

## Qeydlər

1. **Təhlükəsizlik**: Şifrələri adapter konfiqurasiyasında saxlamaq təhlükəsiz deyil. Mümkünsə environment variables və ya ioBroker-in şifrələnmiş state-lərini istifadə edin.

2. **Performance**: PDF eksport screenshot-dan daha yavaş ola bilər, xüsusilə böyük səhifələr üçün.

3. **Viewport**: PDF eksport üçün viewport ölçüsü avtomatik olaraq təyin olunur, lakin screenshot üçün manual olaraq təyin edə bilərsiniz:
```javascript
viewportOptions: {
    width: 1920,
    height: 1080
}
```

4. **Yaddaş**: Böyük səhifələr üçün adapter daha çox RAM istifadə edə bilər.

## ✨ Enhanced Features & Improvements

### 1. Browser Stability
```javascript
// Chrome crash problemlərini həll edən arqumentlər:
--disable-dev-shm-usage    // Shared memory problemini həll edir
--no-sandbox               // Sandbox məhdudiyyətlərini aradan qaldırır
--disable-setuid-sandbox   // Permission problemlərini həll edir

// Protocol timeout artırıldı
protocolTimeout: 180000  // 30s → 180s (3 dəqiqə)
```

### 2. Automatic Directory Creation
```javascript
// Əvvəl: Qovluq mövcud olmalıdır
path: 'D:/reports/2026/02/11/report.pdf'  // ERROR if D:/reports/2026/02/11/ yoxdur

// İndi: Qovluqlar avtomatik yaradılır
path: 'D:/reports/2026/02/11/report.pdf'  // ✓ D:/reports/2026/02/11/ yaradılacaq
```

### 3. Hash Navigation Fix
```javascript
// Problem: Login-dən sonra hash itirilir
URL: http://127.0.0.1:8082/vis/index.html#DailyReport
→ Login → http://127.0.0.1:8082/vis/index.html (hash yox!)

// Həll: Avtomatik hash restoration
→ Login → window.location.hash = 'DailyReport' → Düzgün view!
```

### 4. Browser Reconnect
```javascript
// Əgər browser crash edərsə:
if (!this.browser || !this.browser.connected) {
  await this.onReady();  // Yenidən başlat
}
```

### 5. Debugging Mode
```javascript
// main.js-də headless: false təyin edin
headless: false  // Chrome pəncərəsini görəcəksiniz

// Production-da:
headless: true   // Gizli işləyir
```

## Problemlərin həlli

### ✨ "Protocol error: Connection closed"
**Səbəb:** Browser crash edir  
**Həll:** 
- Protocol timeout artırıldı (180s)
- `--disable-dev-shm-usage` əlavə edildi
- Browser reconnect mexanizmi

### ✨ "Navigation timeout exceeded"
**Səbəb:** Hash ilə yenidən navigate timeout edir  
**Həll:** 
- `window.location.hash` ilə instant hash set
- Full navigation əvəzinə JavaScript istifadə

### ✨ "Requesting main frame too early"
**Səbəb:** Page hələ ready deyil  
**Həll:** 
- `newPage()` və `goto()` arasında 500ms wait
- Frame hazır olana qədər gözləyir

### Login işləmir
- Login səhifəsinin strukturunu yoxlayın
- Adapter log-larına baxın (debug mode)
- Məlumatların düzgün olduğundan əmin olun

### PDF boş çıxır
- `waitOption` ilə səhifənin tam yüklənməsini gözləyin
- `printBackground: true` parametrini əlavə edin
- Login-dən sonra 5s wait avtomatik əlavə edilir

### Screenshot/PDF keyfiyyəti aşağıdır
- `scale` parametrini artırın (PDF üçün)
- `viewportOptions` ilə daha yüksək həll təyin edin (screenshot üçün)

### Directory yoxdur xətası
**Həll yoxdur!** - Qovluqlar avtomatik yaradılır (`recursive: true`)

## 📋 Changelog

### v0.5.1-enhanced (2026-02-11)
**🎯 Əsas məqsəd:** Browser stability və ioBroker VIS uyğunluğunu artırmaq

#### ✨ Yeni funksiyalar:
- **Custom Chrome Executable:** `executablePath` parametri ilə istənilən Chrome istifadə
- **Directory Auto-Creation:** Export path-də qovluqlar avtomatik yaradılır
- **Hash Navigation Fix:** Login-dən sonra URL hash-i düzgün bərpa olunur
- **Browser Reconnect:** Crash halında avtomatik yenidən başlatma
- **Debugging Mode:** Headless mode deaktiv edilə bilər

#### 🔧 Təkmilləşdirmələr:
- Protocol timeout: 30s → 180s
- Chrome arguments: `--disable-dev-shm-usage`, `--no-sandbox`, etc.
- Post-login navigation wait əlavə edildi
- Frame ready check: `newPage()` və `goto()` arasında 500ms wait
- Network idle wait: `networkidle2` istifadə edilir

#### 🐛 Düzəlişlər:
- ✅ "Protocol error: Connection closed" - həll edildi
- ✅ "Navigation timeout exceeded" - hash instant set edilir
- ✅ "Requesting main frame too early" - frame ready wait
- ✅ "Execution context is not available" - post-login navigation
- ✅ Blank PDF exports - 5s automatic wait
- ✅ Directory not found - auto-creation

#### 🚀 Performance:
- waitForVISReady silinib (sadələşdirildi)
- Total wait time: ~30-80s → ~10-15s
- Browser launch stability artırıldı

---

## Dəstək

Problemlər və ya suallar üçün GitHub-da issue açın:
https://github.com/foxriver76/ioBroker.puppeteer/issues

---

## ⚠️ Production Qeydləri

1. **Debugging mode-u söndürün:**
   ```javascript
   headless: false → headless: true  // main.js-də
   ```

2. **Custom Chrome istifadə edərkən:**
   - Chrome path-inin düzgün olduğundan əmin olun
   - Browser window açıq qalır (custom browser instance)

3. **Şifrələr:**
   - Adapter config-də şifrə saxlamaq təhlükəsizdir (encrypted)
   - Environment variables daha təhlükəsizdir

4. **Performance:**
   - PDF export ~10-15s (login varsa ~20s)
   - Çox tez-tez export throttle yarada bilər
   - Schedule ilə istifadə tövsiyə olunur

---

**Müəllif:** Enhanced by debugging session  
**Tarix:** 2026-02-11  
**Versiya:** v0.5.1-enhanced
