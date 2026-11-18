# EduLadder Battle

Game ular tangga edukatif **online multi-komputer**. Satu admin (guru) membuat room dan mengendalikan layar besar (IFP), sementara **2–25 siswa** bergabung dari komputer masing-masing lewat browser di jaringan lokal.

## Menjalankan

Butuh **Node.js 22.5+** (memakai modul `node:sqlite` bawaan).

```powershell
npm install
$env:EDULADDER_ADMIN_PASSWORD="rahasia-anda"; npm start
```

Server hanya berjalan bila `EDULADDER_ADMIN_PASSWORD` diset. Password itu dipakai untuk login panel admin.

Setelah start, terminal menampilkan:

```
Lokal   : http://localhost:3000/
Jaringan: http://<ip-lan>:3000/
Admin   : http://localhost:3000/admin
```

Pemain membuka alamat **Jaringan** (atau memindai QR di layar lobi), memasukkan kode room dan nama.

Variabel lingkungan: `PORT` (default 3000), `HOST` (default `0.0.0.0`), `EDULADDER_DB` (lokasi file SQLite).

## Alur pemakaian

1. **Admin** membuka panel admin, login dengan password, lalu mengelola bank soal.
2. **Bank soal** bisa dibuat lewat editor GUI (tambah/edit/hapus/urutkan soal) atau diimpor massal dari CSV. Setiap soal dan setiap pilihan boleh punya URL gambar.
3. Admin membuat **room** dari sebuah bank soal, mengatur **kuota bantuan** per pemain dan **maksimal pemain** (2–25, default 4), lalu membagikan kode room/QR. Batas pemain hanya bisa diset saat room dibuat.
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

## Kuota bantuan

Enam bantuan punya kuota angka **per room, per pemain**: Lempar Soal, Clue, Shield, Ganti Soal, Double Move, Penawar. Nilai `0` menonaktifkan bantuan tersebut. Default: `2, 1, 1, 1, 2, 1`. Kuota diatur saat membuat room atau di lobi sebelum permainan dimulai; setelah berjalan tidak bisa diubah.

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
- Pertandingan lama (sebelum fitur ini) hanya menghasilkan file berisi header.
- Menghapus entri riwayat ikut menghapus jawabannya; menghapus room membuang jawaban yang tidak pernah diarsipkan.

## Struktur proyek

```
index.html              # memuat CDN + shared/engine.js + client/*.jsx
shared/engine.js        # aturan permainan murni (dipakai server & browser)
server/
  index.js              # Express + Socket.IO + REST + static
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
test/                   # node:test: engine + persistensi/pemulihan
```

## Keamanan

- Panel admin dilindungi satu password global; sesi 12 jam, percobaan login dibatasi 5/menit per IP.
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
