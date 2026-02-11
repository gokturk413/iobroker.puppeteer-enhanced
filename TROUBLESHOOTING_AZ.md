# Problemlərin Həlli - ioBroker.puppeteer-enhanced

## "ERROR: Process exited with code 25" xətası

Bu xəta ioBroker-in adapterdə problem tapdığını göstərir. Aşağıdakı həll yollarını sınayın:

### Həll 1: Manual quraşdırma (TÖVSİYƏ EDİLİR)

```bash
# Windows üçün (PowerShell və ya CMD)
cd C:\iobroker\node_modules
# və ya ioBroker quraşdırma qovluğunuz

# Linux üçün
cd /opt/iobroker/node_modules

# Repository-ni klonlayın
git clone https://github.com/gokturk413/iobroker.puppeteer-enhanced.git iobroker.puppeteer

# Qovluğa daxil olun
cd iobroker.puppeteer

# Dependencies quraşdırın (production mode)
npm install --production --no-optional

# İoBroker qovluğuna qayıdın
cd ../..

# Adapterdə update edin
iobroker upload puppeteer

# Instance yaradın (əgər yoxdursa)
iobroker add puppeteer

# Adapter instance-i başladın
iobroker start puppeteer.0
```

### Həll 2: NPM cache təmizləmə

```bash
# NPM cache təmizləyin
npm cache clean --force

# ioBroker temporary faylları silin
iobroker del puppeteer  # əgər quraşdırılıbsa
rm -rf node_modules/iobroker.puppeteer  # və ya Windows: rmdir /s /q node_modules\iobroker.puppeteer

# Yenidən cəhd edin
iobroker url https://github.com/gokturk413/iobroker.puppeteer-enhanced
```

### Həll 3: Dependency problemlərinin həlli

```bash
cd /opt/iobroker  # və ya C:\iobroker
npm install @iobroker/adapter-core puppeteer --save
```

### Həll 4: İoBroker yenidən başlatma

```bash
iobroker stop
iobroker start

# və ya
iobroker restart
```

## Quraşdırmanı yoxlama

### 1. Adapter quraşdırılıbmı?

```bash
iobroker list instances
```

Siyahıda `system.adapter.puppeteer.0` görməlisiniz.

### 2. Adapter işləyirmi?

```bash
iobroker status puppeteer.0
```

Status "alive" və ya "running" olmalıdır.

### 3. Adapter logları yoxlayın

```bash
# Real-time log
iobroker logs --watch

# Son 50 sətir
iobroker logs --lines 50
```

### 4. Adapter state-lərini yoxlayın

```bash
iobroker state get puppeteer.0.info.connection
```

## Linux üçün xüsusi həll yolları

### Chrome/Chromium tələbləri

```bash
# Debian/Ubuntu
sudo apt-get update
sudo apt-get install -y \
  gconf-service \
  libasound2 \
  libatk1.0-0 \
  libc6 \
  libcairo2 \
  libcups2 \
  libdbus-1-3 \
  libexpat1 \
  libfontconfig1 \
  libgcc1 \
  libgconf-2-4 \
  libgdk-pixbuf2.0-0 \
  libglib2.0-0 \
  libgtk-3-0 \
  libnspr4 \
  libpango-1.0-0 \
  libpangocairo-1.0-0 \
  libstdc++6 \
  libx11-6 \
  libx11-xcb1 \
  libxcb1 \
  libxcomposite1 \
  libxcursor1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxi6 \
  libxrandr2 \
  libxrender1 \
  libxss1 \
  libxtst6 \
  ca-certificates \
  fonts-liberation \
  libappindicator1 \
  libnss3 \
  lsb-release \
  xdg-utils \
  wget
```

### Puppeteer manual quraşdırma

```bash
cd /opt/iobroker/node_modules/iobroker.puppeteer
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false npm install puppeteer
```

## Windows üçün xüsusi həll yolları

### Administrator hüquqları

PowerShell-i Administrator olaraq açın:

```powershell
# İoBroker servisini dayandırın
Stop-Service iobroker
# və ya
iobroker stop

# Quraşdırmanı təkrar edin
cd C:\iobroker\node_modules
git clone https://github.com/gokturk413/iobroker.puppeteer-enhanced.git iobroker.puppeteer
cd iobroker.puppeteer
npm install --production

# Servisi yenidən başladın
Start-Service iobroker
# və ya
iobroker start
```

### Visual C++ Redistributable

Windows-da C++ compiler problemləri olarsa:

1. [Visual C++ Redistributable](https://aka.ms/vs/17/release/vc_redist.x64.exe) yükləyin
2. Yükləmədən sonra yenidən cəhd edin

## Adapter işləməsini test edin

### JavaScript Adapter ilə test

Admin paneldə "Scripts" bölməsinə gedin və test skripti yazın:

```javascript
// Screenshot test
sendTo('puppeteer.0', 'screenshot', {
    url: 'https://www.google.com',
    path: '/tmp/test.png'
}, function(result) {
    if (result.error) {
        log('ERROR: ' + result.error.message, 'error');
    } else {
        log('Screenshot uğurlu: ' + result.result.length + ' bytes');
    }
});
```

### PDF test

```javascript
sendTo('puppeteer.0', 'pdf', {
    url: 'https://www.google.com',
    path: '/tmp/test.pdf',
    format: 'A4'
}, function(result) {
    if (result.error) {
        log('ERROR: ' + result.error.message, 'error');
    } else {
        log('PDF uğurlu: ' + result.result.length + ' bytes');
    }
});
```

## Tam təmizləmə və yenidən quraşdırma

Əgər heç nə işləməzsə:

```bash
# 1. Adapterdə silin
iobroker del puppeteer

# 2. Node_modules-dan silin
rm -rf node_modules/iobroker.puppeteer  # Linux
# və ya
rmdir /s /q node_modules\iobroker.puppeteer  # Windows

# 3. NPM cache təmizləyin
npm cache clean --force

# 4. Yenidən quraşdırın
cd node_modules
git clone https://github.com/gokturk413/iobroker.puppeteer-enhanced.git iobroker.puppeteer
cd iobroker.puppeteer
npm install --production

# 5. Upload və add
cd ../..
iobroker upload puppeteer
iobroker add puppeteer
iobroker start puppeteer.0
```

## Puppeteer Chromium path problemi

Əgər Puppeteer Chrome tapa bilmirsə:

```javascript
// Admin paneldə adapter konfiqurasiyasında:
// Use External Browser: true
// Executable Path: 
//   Linux: /usr/bin/chromium-browser
//   Windows: C:\Program Files\Google\Chrome\Application\chrome.exe
//   Mac: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
```

## Loglardan səbəbi tapmaq

```bash
# Detal loglar
iobroker logs --watch --level debug

# Spesifik adapter log
tail -f /opt/iobroker/log/iobroker.*.log | grep puppeteer

# NPM verbose log
cd node_modules/iobroker.puppeteer
npm install --verbose 2>&1 | tee npm-install.log
```

## Yardım alın

Problemin həll olunmadığı halda:

1. **Log fayllarını toplayın**:
```bash
iobroker logs > iobroker-logs.txt
npm --version > system-info.txt
node --version >> system-info.txt
```

2. **GitHub issue açın**: https://github.com/gokturk413/iobroker.puppeteer-enhanced/issues

Aşağıdakı məlumatları daxil edin:
- ioBroker versiyası
- Node.js versiyası
- OS (Operating System)
- Xətanın tam mətni
- Log faylları

## Faydalı komandalar

```bash
# ioBroker versiyası
iobroker -v

# Node.js versiyası
node -v

# NPM versiyası
npm -v

# Bütün adapterlərin siyahısı
iobroker list adapters

# Bütün instance-lərin siyahısı
iobroker list instances

# Adapter statusu
iobroker status puppeteer.0

# Adapter başlat/dayandır
iobroker start puppeteer.0
iobroker stop puppeteer.0
iobroker restart puppeteer.0
```
