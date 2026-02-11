# İoBroker.puppeteer-enhanced Quraşdırma Təlimatı

## GitHub-dan quraşdırma

### 1. Metod: ioBroker CLI ilə

```bash
# Ən son versiya
iobroker url https://github.com/gokturk413/iobroker.puppeteer-enhanced

# Müəyyən host üçün
iobroker url https://github.com/gokturk413/iobroker.puppeteer-enhanced --host YourHostName

# Debug mode ilə
iobroker url https://github.com/gokturk413/iobroker.puppeteer-enhanced --debug
```

### 2. Metod: NPM ilə birbaşa

```bash
cd /opt/iobroker  # və ya ioBroker quraşdırma qovluğunuz
npm install gokturk413/iobroker.puppeteer-enhanced
iobroker upload puppeteer
```

### 3. Metod: Admin interfeysdən

1. Admin paneldə "Adapters" bölməsinə gedin
2. GitHub icon-a klikləyin (sağ yuxarı künc)
3. Repository URL daxil edin: `https://github.com/gokturk413/iobroker.puppeteer-enhanced`
4. "Install" düyməsinə basın

## Yoxlama

Quraşdırmadan sonra yoxlayın:

```bash
iobroker list instances
```

Siyahıda `system.adapter.puppeteer.0` görməlisiniz.

## Problemlərin həlli

### Xəta: "Cannot install" / "Process exited with code 25"

Bu xəta adətən aşağıdakı səbəblərdən olur:

1. **NPM paketləri yüklənməyib**:
```bash
cd /opt/iobroker/node_modules/iobroker.puppeteer
npm install
```

2. **Build faylları yoxdur**:
Repository-də `build/` qovluğu olmalıdır (artıq var).

3. **io-package.json strukturu səhvdir**:
io-package.json faylı ioBroker standartlarına uyğun olmalıdır (düzəldildi).

4. **Permissions problemi**:
```bash
cd /opt/iobroker
sudo chown -R iobroker:iobroker node_modules/iobroker.puppeteer
```

5. **ioBroker yenidən başlatma**:
```bash
iobroker restart
```

### Manual quraşdırma (əgər avtomatik işləməzsə)

```bash
# 1. Repository-ni klonlayın
cd /opt/iobroker/node_modules
git clone https://github.com/gokturk413/iobroker.puppeteer-enhanced.git iobroker.puppeteer

# 2. Dependencies quraşdırın
cd iobroker.puppeteer
npm install --production

# 3. ioBroker-ə upload edin
cd /opt/iobroker
iobroker upload puppeteer

# 4. Instance yaradın
iobroker add puppeteer

# 5. Başladın
iobroker start puppeteer
```

### Logları yoxlayın

```bash
# ioBroker logs
iobroker logs --watch

# Spesifik adapter log
tail -f /opt/iobroker/log/iobroker.*.log | grep puppeteer

# NPM install log
npm install --verbose
```

### Chrome/Chromium tələbləri (Linux)

Linux-da Puppeteer üçün əlavə paketlər lazımdır:

```bash
# Debian/Ubuntu
sudo apt-get install -y \
  ca-certificates \
  fonts-liberation \
  libappindicator3-1 \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libc6 \
  libcairo2 \
  libcups2 \
  libdbus-1-3 \
  libexpat1 \
  libfontconfig1 \
  libgbm1 \
  libgcc1 \
  libglib2.0-0 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
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
  lsb-release \
  wget \
  xdg-utils
```

## Konfiqurasiya

Adapter instance yaradıldıqdan sonra:

1. Admin paneldə adapter instance-ə gedin
2. Konfiqurasiya parametrlərini təyin edin:
   - **Web Username**: ioBroker web login üçün (məsələn: admin)
   - **Web Password**: ioBroker web şifrə
   - **Use External Browser**: (opsional) Xarici Chrome istifadə etmək üçün
   - **Executable Path**: (opsional) Xarici browser yolu

## İstifadə nümunələri

Adapter işləyəndən sonra:

```javascript
// Screenshot
sendTo('puppeteer.0', 'screenshot', {
    url: 'http://192.168.1.100:8082/vis/index.html',
    path: '/tmp/vis.png',
    loginCredentials: {
        username: 'admin',
        password: 'yourpassword'
    },
    fullPage: true
});

// PDF Export
sendTo('puppeteer.0', 'pdf', {
    url: 'http://192.168.1.100:8082/vis/index.html',
    path: '/tmp/vis.pdf',
    format: 'A4',
    loginCredentials: {
        username: 'admin',
        password: 'yourpassword'
    }
});
```

## Dəstək

- GitHub Issues: https://github.com/gokturk413/iobroker.puppeteer-enhanced/issues
- ioBroker Forum: https://forum.iobroker.net

## Versiya

Cari versiya: **0.5.0**

Yeni funksiyalar:
- ✓ PDF export
- ✓ Avtomatik web login
- ✓ Enhanced screenshot options
