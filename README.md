# EduLadder Battle

Game ular tangga edukatif **online multi-komputer**. Satu admin (guru) membuat room dan mengendalikan layar besar (IFP), sementara **2–25 siswa** bergabung dari komputer masing-masing lewat browser di jaringan lokal.

## Menjalankan

Butuh **Node.js 22.5+** (memakai modul `node:sqlite` bawaan).

```powershell
npm install
Copy-Item .env.example .env    # Git Bash: cp .env.example .env
# buka .env dan isi EDULADDER_ADMIN_PASSWORD
npm start
```

Server hanya berjalan bila `EDULADDER_ADMIN_PASSWORD` diset. Password itu dipakai untuk login panel admin. Konfigurasi dibaca dari `.env` (melalui `dotenv`); variabel lingkungan yang sudah ada (CI/PaaS) tidak ditimpa oleh file.

## Konfigurasi (`.env`)

Salin `.env.example` lalu sesuaikan. Nilai tidak valid membuat server berhenti saat start dengan daftar masalah yang jelas.

| Variabel | Default | Keterangan |
|---|---|---|
| `PORT` | `3000` | Port HTTP, 1–65535. |
| `HOST` | `0.0.0.0` | Alamat bind; `0.0.0.0` agar bisa diakses dari LAN. |
| `EDULADDER_ADMIN_PASSWORD` | *(wajib)* | Password login panel admin. |
| `EDULADDER_DB` | `server/data/eduladder.db` | Lokasi file SQLite. |
| `EDULADDER_CORS_ORIGIN` | `*` | `*` atau daftar origin dipisah koma (`https://a.id,https://b.id`). |
| `EDULADDER_SESSION_HOURS` | `12` | Masa berlaku sesi admin (jam, maks 168). |
| `EDULADDER_LOGIN_MAX_ATTEMPTS` | `5` | Percobaan login gagal per IP. |
| `EDULADDER_LOGIN_WINDOW_SECONDS` | `60` | Jendela waktu rate limit login (detik). |
| `EDULADDER_PUBLIC_URL` | *(kosong)* | URL publik untuk QR/link join, mis. `http://192.168.1.10:3000`. Kosong = ikuti alamat browser. |
| `EDULADDER_JSON_LIMIT` | `2mb` | Batas body JSON (simpan bank soal). |
| `EDULADDER_CSV_LIMIT` | `1mb` | Batas unggah CSV bank soal. |
| `EDULADDER_DISCONNECT_GRACE_SECONDS` | `10` | Masa tenggang (detik) pemain yang terputus saat bermain; `0` = langsung istirahat. |

`.env` tidak di-commit; hanya `.env.example` yang ikut repositori. Endpoint publik `GET /api/config` mengirim hanya `publicUrl` (tanpa rahasia) agar klien memakai host yang benar di balik reverse proxy/LAN.

Setelah start, terminal menampilkan:

```
Lokal   : http://localhost:3000/
Jaringan: http://<ip-lan>:3000/
Admin   : http://localhost:3000/admin
```

Pemain membuka alamat **Jaringan** (atau memindai QR di layar lobi), memasukkan kode room dan nama.

## Alur pemakaian

1. **Admin** membuka panel admin, login dengan password, lalu mengelola bank soal.
2. **Bank soal** bisa dibuat lewat editor GUI (tambah/edit/hapus/urutkan soal) atau diimpor massal dari CSV. Setiap soal dan setiap pilihan boleh punya URL gambar. Soal kode multi-baris: Enter dan Tab langsung di editor, atau penanda `\n`/`\t` di CSV (lihat *Baris baru dan tab*).
3. Admin membuat **room** dari sebuah bank soal, mengatur **kuota bantuan** per pemain, **maksimal pemain** (2–25, default 4), dan opsi **izinkan join saat berjalan**, lalu membagikan kode room/QR. Batas pemain dan opsi join hanya bisa diset saat room dibuat.
4. Pemain bergabung dengan kode room + nama, lalu memilih satu dari **10 karakter** di lobi (boleh sama antar pemain; bisa diganti sampai admin menekan Mulai).
5. Setelah minimal 2 pemain bergabung dan bank soal mencukupi, admin menekan **Mulai Permainan**.
6. Hanya pemilik soal aktif (dan layar admin/IFP) yang melihat overlay soal; pemain lain tetap melihat papan dan pil pojok **Giliran <nama>**.
7. Saat pertandingan selesai, hasil otomatis tercatat di tab **Riwayat**.

## Karakter & pemain banyak

- **10 karakter** = 10 palet warna yang memakai 4 bentuk 3D yang ada (robot, creature, rocket, star). Karakter boleh dipakai beberapa pemain; nomor urut dan warna membedakan token/HUD.
- Urutan giliran mengikuti urutan pemain bergabung, bukan karakter yang dipilih.
- Lebih dari **4 pemain**: HUD menjadi panel samping kanan yang bisa di-scroll (di layar kecil menjadi strip horizontal). Lebih dari **6 pemain**: papan 3D memakai token ringkas (disc berwarna + nomor) alih-alih model penuh.
- Saat reveal jawaban, muncul animasi **+N** hijau (reward, 2× untuk Double Move), **−N** merah (penalty), atau **0** netral bila ditahan Shield/Penawar/terkunci. Bonus tangga/ular dan serangan senjata tidak menampilkan angka ini.

## Bank soal & gambar

Format CSV (pemisah `;`). Sepuluh kolom pertama wajib, lima kolom gambar opsional:

```
Pertanyaan;Pilihan A;Pilihan B;Pilihan C;Pilihan D;Jawaban Benar;Clue;Reward;Penalty;Durasi;Gambar Soal;Gambar A;Gambar B;Gambar C;Gambar D
```

- Gambar berupa **URL** (`http`/`https`), bukan unggahan file. URL tidak valid ditolak dan dilaporkan per baris.
- Server tidak pernah mengambil gambar; browser yang memuatnya (`loading="lazy"`, `referrerpolicy="no-referrer"`), dan gambar gagal dimuat disembunyikan.
- Template CSV bisa diunduh dari panel admin.

### Baris baru dan tab (soal kode)

Soal, pilihan, dan clue boleh memuat beberapa baris dan indentasi tab. Penanda berikut hanya diterjemahkan saat **impor CSV** (termasuk file Excel yang disimpan sebagai CSV), tidak pada URL gambar:

| Penanda | Hasil |
|---|---|
| `\n` atau `\r\n` | Baris baru |
| `\t` | Tab (indentasi) |
| `\\n`, `\\t`, `\\r` | Teks literal `\n`, `\t`, `\r` (dua karakter) |
| `<br>`, `<br/>`, `<br />` | Baris baru (sering ditulis Excel untuk sel "wrap text") |

- Sel ber-quote yang memuat baris baru sungguhan (hasil **Alt+Enter** di Excel) juga terbaca sebagai satu soal, bukan terpotong menjadi beberapa baris rusak.
- Di editor admin, kolom **Pertanyaan** berupa kotak multi-baris: Enter menambah baris dan **Tab** menyisipkan indentasi (Shift+Tab mengurangi). Setiap tab dihitung satu karakter terhadap batas 1000 karakter.
- Soal/opsi/clue yang memuat baris baru atau tab tampil dengan huruf monospace dan spasinya dipertahankan.

Contoh satu baris CSV berisi kode:

```
Apa keluaran kode ini?\nfor i in range(2):\n\tprint(i);0 1;0 0;1 2;1 1;A;Gunakan \\t untuk indentasi;4;2;20
```

## Kuota bantuan

Tujuh bantuan punya kuota angka **per room, per pemain**: Lempar Soal, Clue, Shield, Ganti Soal, Double Move, Penawar, dan **Sisihkan 2**. Nilai `0` menonaktifkan bantuan tersebut. Default: `2, 1, 1, 1, 2, 1, 2`. Kuota diatur saat membuat room atau di lobi sebelum permainan dimulai; setelah berjalan tidak bisa diubah.

**Sisihkan 2** menutup dua pilihan salah secara acak pada soal yang sedang aktif. Opsi yang disisihkan tidak bisa dipilih dan bertanda "disisihkan"; efeknya direset saat soal berikutnya.

## Putus koneksi & join di tengah permainan

- Pemain yang koneksinya putus saat permainan berjalan mendapat **masa tenggang** (default 10 detik, `EDULADDER_DISCONNECT_GRACE_SECONDS`). Selama itu dia bisa reconnect (token di localStorage) tanpa kehilangan giliran.
- Sesudah masa tenggang pemain berstatus **istirahat**: rotasi giliran melewatinya. Bila soal sedang dipegangnya, soal dialihkan ke pemain aktif berikutnya **tanpa hukuman** dan timer mulai penuh setelah pemain itu menekan "Lanjutkan".
- Pemain istirahat yang kembali bermain otomatis aktif lagi, ikut di giliran berikutnya (bukan memaksa soalnya kembali).
- **Join di tengah permainan**: room punya opsi "Izinkan join saat permainan berjalan" (default aktif, hanya diset saat room dibuat). Bila aktif, pemain baru masuk sebagai pemain mulai kotak 1 dan mendapat giliran setelah pemain terakhir pada putaran berikutnya; bila nonaktif atau room penuh, tamu menjadi penonton.

## Panel aksi & efek senjata

- Semua bantuan dan dua slot senjata tampil dalam **satu panel "Aksi"** tanpa tab; masing-masing menampilkan ikon, label, dan sisa kuota.
- Saat senjata dilepas, soal **dijeda**: overlay soal disembunyikan sementara, pengumuman serangan tampil di tengah layar, deadline digeser sebesar durasi efek (`FX_PAUSE_MS`) sehingga timer lanjut dari sisa waktu. Jawaban/bantuan ditolak server selama efek berlangsung.

## Countdown

- Batas waktu soal berasal dari jam **server**. Klien menghitung selisih jam (median 5 sampel `serverNow`) sehingga jam perangkat yang meleset tidak membuat countdown ratusan detik.
- Angka selalu di-clamp ke `0..durasi soal`; bila selisih jam ekstrem (> 5 menit) offset diabaikan.

## Reaksi lobi

Pemain bisa mengirim reaksi (👍 👏 🎉 😮 🔥 ❤️) di lobi. Reaksi tampil sebagai callout di kartu karakter pengirim selama ~3 detik. Throttle server 1 reaksi / 2 detik / pemain, TTL 4 detik, dan tidak disimpan ke database.

## Podium

Saat permainan selesai, layar penuh **podium 3D** (hutan, podium emas/perak/perunggu) menggantikan papan: kamera menyapu hutan, juara 3→2→1 "jatuh" ke podium, lalu pemain lain muncul berjajar. Tombol **Lihat papan** mengembalikan papan, **Lihat hasil** membuka modal peringkat. Bila WebGL tidak tersedia, podium 2D sederhana ditampilkan. Podium memakai model karakter yang sama dengan papan (`assets/js/podium3d.js`).

## Room persistent & riwayat

- Room, konfigurasi, daftar pemain, dan **state permainan** disimpan ke SQLite pada setiap fase, sehingga permainan **berlanjut setelah server restart**.
- Sebelum menjalankan aksi pemain, server menyimpan **checkpoint**. Bila server mati di tengah animasi, permainan dipulihkan ke checkpoint dan aksi terakhir dijalankan ulang — efek (gerak, serangan, pemakaian bantuan) tidak terjadi dua kali.
- Room dan riwayat **disimpan selamanya**; admin menghapusnya manual dari panel. Menghapus bank soal tidak memengaruhi room lama karena soal disalin (snapshot) ke room saat dibuat.
- Riwayat pertandingan menyimpan kode room, bank, daftar pemain, peringkat akhir, pemenang, durasi, dan waktu selesai.

## Unduh jawaban pemain

Setiap jawaban dicatat ke tabel `player_answers` saat diterima server: soal utama, soal bonus tangga/ular, jawaban salah, timeout, dan jawaban akibat pemain dikeluarkan. Di panel admin → tab **Riwayat**, tombol **Unduh jawaban** menghasilkan CSV per pertandingan (satu baris per jawaban, pemisah `;`, BOM UTF-8 agar rapi di Excel).

Kolom: `Room;Waktu;Jenis;Pertanyaan;Pemain;Slot;Karakter;Jawaban;Teks Jawaban;Kunci;Benar;Timeout;Delta Langkah`.

- `Jenis` = `Soal utama`, `Bonus tangga`, atau `Bonus ular`. Bonus selalu `Delta Langkah = 0` (animasi +N/−N tidak berlaku untuk bonus).
- `Jawaban` kosong saat timeout; `Teks Jawaban` berisi teks pilihan yang dipilih.
- Soal/opsi yang memuat baris baru atau tab ditulis sebagai sel ber-quote (RFC 4180), sehingga tetap valid saat dibuka di Excel.
- Pertandingan lama (sebelum fitur ini) hanya menghasilkan file berisi header.
- Menghapus entri riwayat ikut menghapus jawabannya; menghapus room membuang jawaban yang tidak pernah diarsipkan.

## Struktur proyek

```
index.html              # memuat CDN + shared/engine.js + client/*.jsx
.env.example            # contoh konfigurasi; salin menjadi .env
shared/engine.js        # aturan permainan murni (dipakai server & browser)
server/
  index.js              # Express + Socket.IO + REST + static
  config.js             # baca & validasi konfigurasi .env (gagal cepat)
  rooms.js              # kelas Room & RoomManager (memori + persistensi)
  room-store.js         # tulis/baca room, checkpoint, riwayat ke SQLite
  db.js                 # skema & CRUD bank soal (node:sqlite)
  game-loop.js          # eksekutor langkah fase + broadcast
  security.js           # token, sesi admin, rate limit login
  scripts/simulate.js   # simulasi headless satu pertandingan
  data/eduladder.db     # database runtime (tidak di-commit)
client/
  app.jsx               # routing layar + koneksi socket
  screens.jsx           # beranda pemain & login admin
  admin.jsx             # dashboard: room, editor bank soal, riwayat
  lobby.jsx             # lobi Tailwind: QR, kode room, pemilih karakter
  game.jsx              # tampilan permainan
  components.jsx        # komponen UI (papan, overlay soal, bantuan)
  net.js                # Socket.IO + REST + localStorage
  audio.js              # BGM & efek suara
assets/js/board3d.js    # papan 3D (Three.js)
assets/js/podium3d.js   # podium pemenang 3D (Three.js)
test/                   # node:test: engine + persistensi/pemulihan
```

## Keamanan

- Panel admin dilindungi satu password global; masa sesi dan batas percobaan login dapat diatur lewat `.env` (`EDULADDER_SESSION_HOURS`, `EDULADDER_LOGIN_MAX_ATTEMPTS`, `EDULADDER_LOGIN_WINDOW_SECONDS`).
- Semua aksi admin lewat REST/socket diverifikasi terhadap sesi.
- Kunci jawaban tidak pernah dikirim ke klien sebelum soal dijawab.
- Server memvalidasi setiap aksi: fase, pemilik giliran, kuota, target senjata.
- Nama pemain disanitasi; URL gambar hanya `http`/`https`.

## Pengujian

```powershell
npm test                        # unit engine + persistensi/pemulihan
node server/scripts/simulate.js 3 40   # simulasi 3 pemain, 40 soal
```

## Catatan

- Papan 3D memakai Three.js dari CDN; tanpa WebGL, papan 2D dipakai sebagai fallback dan tetap menampilkan semua token (dikelompokkan per kotak) beserta animasi angka.
- Audio memakai `assets/sound/` (BGM + efek) dengan sintesis Web Audio sebagai cadangan.
- Room 25 pemain memang lebih lama per giliran dan papan lebih padat; ini bukan bug. Token ringkas + HUD scroll menjaga keterbacaan.
- `server/` dan `shared/engine.js` di-`require` saat boot, jadi **restart server** diperlukan setelah mengubah keduanya.
