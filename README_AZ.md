# ioBroker.puppeteer - Azərbaycan dilində təlimat

## Ümumi məlumat
Bu adapter Chrome əsaslı headless browser istifadə edərək ekran görüntüləri (screenshot) və PDF eksport funksiyalarını təmin edir.

## Yeni funksiyalar (v0.5.0)

### 1. PDF Export 
İndi istənilən web səhifəni PDF formatında eksport edə bilərsiniz. Bütün Puppeteer PDF parametrləri dəstəklənir.

### 2. Avtomatik ioBroker Web Login
Adapter avtomatik olaraq ioBroker web login səhifələrini (məsələn, VIS) aşkar edir və konfiqurasiya edilmiş məlumatlarla login olur.

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

## Problemlərin həlli

### Login işləmir
- Login səhifəsinin strukturunu yoxlayın
- Adapter log-larına baxın (debug mode)
- Məlumatların düzgün olduğundan əmin olun

### PDF boş çıxır
- `waitOption` ilə səhifənin tam yüklənməsini gözləyin
- `printBackground: true` parametrini əlavə edin

### Screenshot/PDF keyfiyyəti aşağıdır
- `scale` parametrini artırın (PDF üçün)
- `viewportOptions` ilə daha yüksək həll təyin edin (screenshot üçün)

## Dəstək

Problemlər və ya suallar üçün GitHub-da issue açın:
https://github.com/foxriver76/ioBroker.puppeteer/issues
