**🇹🇷 [Türkçe](#yeni-bir-kamera-eklemek)** &nbsp;·&nbsp; **🇬🇧 English**

# Adding a new camera

Trip Viewer recognizes a dashcam by two things: the **names of its video files**
(e.g. `NO20260522-125624-000184F.MP4`) and the **folder layout** of its SD card
(e.g. `Normal/ Event/ Parking/ Lapse/`). To add support for a camera we don't yet
recognize, we need to see both — exactly as they appear on your card.

The fastest, most reliable way to send that is two plain-text listings of the
card: a `dir.txt` (full recursive listing) and a `tree.txt` (the folder tree).
Generating them takes about a minute and doesn't change any of your footage.

> **Why both files matter.** `dir.txt` shows the exact filenames, sizes, and
> dates — that's what the filename parser keys off. `tree.txt` shows the folder
> hierarchy — that's what the SD-card auto-detection keys off. With only one of
> them we usually can't add the camera; with both, it's a small, low-risk change.

## 1. Plug the card in and capture the listings

Replace the drive letter / volume name below with your card's. **Don't reformat
or "prepare" the card** — we need it exactly as the dashcam left it.

### Windows

Open **Command Prompt** (press `Win`, type `cmd`, Enter) and run:

```bat
D:
cd \
dir /s > dir.txt
tree /F /A > tree.txt
```

- The first two lines switch into the SD card. **If your card is not `D:`**, use
  its letter instead (check "This PC" in File Explorer) — e.g. `E:` then `cd \`.
- `dir /s > dir.txt` writes a full recursive listing to `dir.txt` on the card.
- `tree /F /A > tree.txt` writes the folder tree (with files) to `tree.txt`.

Both files land in the card's root (e.g. `D:\dir.txt`, `D:\tree.txt`). Copy them
off the card to attach them.

### macOS

Open **Terminal** and run (replace `MYCARD` with your card's name as shown in
Finder / under `/Volumes`):

```bash
cd /Volumes/MYCARD
ls -R > ~/Desktop/dir.txt
find . -print > ~/Desktop/tree.txt
```

- `ls -R` is the recursive listing; `find .` is the folder/file tree.
- For a nicer tree (optional), install the `tree` tool with
  `brew install tree`, then use `tree -a > ~/Desktop/tree.txt` instead of `find`.

Both files land on your **Desktop**.

### Linux

Open a terminal and run (replace the mount path and `MYCARD` with yours — most
file managers mount under `/run/media/<you>/<label>` or `/media/<you>/<label>`):

```bash
cd /run/media/$USER/MYCARD
ls -R > ~/dir.txt
tree -a > ~/tree.txt
```

- If `tree` isn't installed: `sudo apt install tree` (Debian/Ubuntu), or just use
  `find . > ~/tree.txt` instead.
- Both files land in your **home folder** (`~`).

## 2. Grab one or two sample files (optional but very helpful)

If you can, also attach:

- **One short video clip** from the card (the smallest one is fine) so we can
  verify the container and, where the camera embeds GPS, decode it.
- **Any sidecar/log file** the camera writes — especially small text files like
  `GPSData*.txt`. If it's large, the **first ~30 lines** are enough; paste them
  into the issue.

## 3. Open an issue and attach both files

Open an issue here: **https://github.com/snipeTR/trip-viewer/issues**

Please include:

1. **`dir.txt`** and **`tree.txt`** (attach both — this is the important part).
2. Your dashcam **make and model**.
3. How many cameras it has (front only, front+rear, etc.) and, if you know it,
   which filename letter/part means which camera.
4. The sample file(s) from step 2, if you were able to grab them.

That's everything needed to add a parser. The parser architecture is modular, so
new-format support is a small, contained change once we can see your card's shape.

---

**🇬🇧 [English](#adding-a-new-camera)** &nbsp;·&nbsp; **🇹🇷 Türkçe**

# Yeni bir kamera eklemek

Trip Viewer bir dashcam'i iki şeyden tanır: **video dosyalarının adları**
(örn. `NO20260522-125624-000184F.MP4`) ve SD kartın **klasör yapısı**
(örn. `Normal/ Event/ Parking/ Lapse/`). Henüz tanımadığımız bir kameraya destek
ekleyebilmemiz için bu ikisini de — kartınızda göründüğü haliyle — görmemiz
gerekir.

Bunu göndermenin en hızlı ve güvenilir yolu, kartın iki düz metin listesidir:
bir `dir.txt` (tam, iç içe liste) ve bir `tree.txt` (klasör ağacı). Bunları
oluşturmak yaklaşık bir dakika sürer ve kayıtlarınıza hiçbir şey yapmaz.

> **Neden iki dosya da önemli?** `dir.txt` tam dosya adlarını, boyutları ve
> tarihleri gösterir — dosya adı çözücüsü buna bakar. `tree.txt` klasör
> hiyerarşisini gösterir — SD kart otomatik algılaması buna bakar. Yalnızca biri
> olursa kamerayı çoğu zaman ekleyemeyiz; ikisi birden olunca bu küçük, düşük
> riskli bir değişiklik olur.

## 1. Kartı takın ve listeleri oluşturun

Aşağıdaki sürücü harfini / birim adını kendi kartınızınkiyle değiştirin. **Kartı
biçimlendirmeyin veya "hazırlamayın"** — dashcam'in bıraktığı haliyle gerekiyor.

### Windows

**Komut İstemi**'ni açın (`Win`'e basın, `cmd` yazıp Enter) ve şunu çalıştırın:

```bat
D:
cd \
dir /s > dir.txt
tree /F /A > tree.txt
```

- İlk iki satır SD kartın içine girer. **Kartınız `D:` değilse**, kendi harfini
  kullanın (Dosya Gezgini'nde "Bu Bilgisayar"a bakın) — örn. `E:` sonra `cd \`.
- `dir /s > dir.txt` tam iç içe listeyi kartta `dir.txt`'e yazar.
- `tree /F /A > tree.txt` klasör ağacını (dosyalarla) `tree.txt`'e yazar.

İki dosya da kartın kökünde oluşur (örn. `D:\dir.txt`, `D:\tree.txt`). Eklemek
için bunları karttan kopyalayın.

### macOS

**Terminal**'i açın ve şunu çalıştırın (`MYCARD` yerine kartınızın Finder'da /
`/Volumes` altında görünen adını yazın):

```bash
cd /Volumes/MYCARD
ls -R > ~/Desktop/dir.txt
find . -print > ~/Desktop/tree.txt
```

- `ls -R` iç içe listedir; `find .` klasör/dosya ağacıdır.
- Daha güzel bir ağaç için (isteğe bağlı) `brew install tree` ile `tree` aracını
  kurup `find` yerine `tree -a > ~/Desktop/tree.txt` kullanabilirsiniz.

İki dosya da **Masaüstü**'nüze düşer.

### Linux

Bir terminal açın ve şunu çalıştırın (bağlama yolunu ve `MYCARD`'ı kendinizinkiyle
değiştirin — çoğu dosya yöneticisi `/run/media/<kullanıcı>/<etiket>` veya
`/media/<kullanıcı>/<etiket>` altına bağlar):

```bash
cd /run/media/$USER/MYCARD
ls -R > ~/dir.txt
tree -a > ~/tree.txt
```

- `tree` kurulu değilse: `sudo apt install tree` (Debian/Ubuntu), ya da yerine
  `find . > ~/tree.txt` kullanın.
- İki dosya da **ev klasörünüze** (`~`) düşer.

## 2. Bir-iki örnek dosya alın (isteğe bağlı ama çok yardımcı)

Mümkünse şunları da ekleyin:

- Karttan **kısa bir video klip** (en küçüğü yeterli) — böylece konteyneri
  doğrulayabilir ve kamera GPS gömüyorsa çözebiliriz.
- Kameranın yazdığı herhangi bir **yan/günlük dosyası** — özellikle
  `GPSData*.txt` gibi küçük metin dosyaları. Büyükse, **ilk ~30 satırı** yeterli;
  issue'ya yapıştırın.

## 3. Issue açın ve iki dosyayı da ekleyin

Buradan issue açın: **https://github.com/snipeTR/trip-viewer/issues**

Lütfen şunları ekleyin:

1. **`dir.txt`** ve **`tree.txt`** (ikisini de ekleyin — önemli kısım bu).
2. Dashcam'inizin **markası ve modeli**.
3. Kaç kamerası olduğu (yalnız ön, ön+arka, vb.) ve biliyorsanız dosya
   adındaki hangi harfin/parçanın hangi kamerayı belirttiği.
4. Alabildiyseniz 2. adımdaki örnek dosya(lar).

Bir parser eklemek için gereken her şey bu kadar. Parser mimarisi modüler
olduğundan, kartınızın yapısını gördüğümüzde yeni format desteği küçük ve sınırlı
bir değişikliktir.
