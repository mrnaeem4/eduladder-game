# EduLadder Battle

Game ular tangga edukatif untuk **2–4 pemain**, dioptimalkan untuk **Interactive Flat Panel 75" (4K)**.
Tanpa build tool dan tanpa `node_modules` — semua dependensi dimuat lewat CDN.

**Dikembangkan oleh: Ridwan Na'im, S.Kom.**

## Menjalankan

1. Letakkan folder ini di `htdocs` (mis. `C:\xampp\htdocs\ulartangga`).
2. Nyalakan Apache, lalu buka `http://localhost/ulartangga/`.
3. Bisa juga dibuka langsung sebagai file `index.html`, tetapi browser modern umumnya memblokir file lokal; server lokal lebih aman.
4. Untuk tampilan proyektor, tekan tombol **layar penuh** di kanan atas saat permainan berjalan.

Koneksi internet diperlukan untuk memuat React, Babel, dan Font Awesome dari CDN.

## Struktur file

| File | Isi |
|---|---|
| `index.html` | Kerangka halaman, meta, dan pemuatan CDN |
| `styles.css` | Design system, tata letak responsif, overlay, animasi |
| `app.js` | Logika permainan (React + JSX ditranspilasi Babel di browser) |
| `board3d.js` | Papan 3D prosedural (Three.js UMD), karakter, animasi |

## Papan 3D

Permainan memakai papan 3D penuh layar yang dibangun prosedural dengan **Three.js r149 (UMD, CDN)** — tanpa model atau aset eksternal. Semua mekanik permainan tetap sama.

- **Kamera isometrik tetap** dengan *lean* halus 2–3° saat giliran berganti; papan otomatis pas ±90–96% tinggi layar pada 16:9 (`fitCamera()`).
- **Peta bebas rantai**: 6 tangga `3→18, 7→64, 24→43, 41→62, 59→80, 77→96`, 5 ular `99→68, 90→55, 74→49, 52→30, 28→10`, dan 6 kotak senjata `8, 15, 34, 45, 70, 85`. `validateBoard()` dijalankan sebelum mulai dan memblokir peta yang tidak valid, termasuk kotak senjata yang bertabrakan dengan ujung ular/tangga.
- **Karakter berbeda bentuk dan warna per slot**: P1 robot biru, P2 makhluk merah, P3 roket kuning, P4 bintang hijau. Setiap karakter punya label nama, dianimasikan *hop* per kotak, naik tangga, dan meluncur di ular. Warna/bentuk mengikuti slot sehingga tidak berubah saat pemain lain dihapus (mis. daftar P1, P3, P4).
- **Token bersama**: bila beberapa pemain berada di kotak yang sama, karakter ditata melingkar di papan 3D dan token 2D ditata ulang agar tidak bertumpuk.
- **Overlay soal ber-blur** (`backdrop-filter`) menampilkan soal, timer, 4 jawaban, 6 bantuan dalam 2 tab (Bantuan & Pertahanan), dan skor. Papan di-pause saat overlay terbuka dan lanjut setelahnya.
- **Hitung mundur pembuka**: setelah menekan Mulai Permainan, angka 5–1 tampil dengan animasi selama 5 detik sebelum soal pertama dibuka.
- **Fallback 2D**: bila WebGL tidak tersedia, papan 2D lama ditampilkan dengan pesan singkat.

Persyaratan tambahan: browser harus mendukung **WebGL** untuk mode 3D. Keempat CDN (React, Three.js, Babel, Font Awesome) perlu koneksi internet.

## Format bank soal (CSV)

- Pemakaian satu file CSV berisi seluruh soal.
- Pemisah kolom **titik koma (`;`)**. Baris pertama opsional sebagai judul kolom.
- Urutan kolom:

| # | Kolom | Keterangan |
|---|---|---|
| 1 | Pertanyaan | Teks soal (wajib) |
| 2–5 | Pilihan A–D | Teks pilihan |
| 6 | Jawaban Benar | `A`, `B`, `C`, atau `D` (wajib) |
| 7 | Clue | Petunjuk singkat |
| 8 | Reward | Langkah maju bila benar (1–12, default 5) |
| 9 | Penalty | Langkah mundur bila salah (1–10, default 3) |
| 10 | Durasi | Batas waktu soal dalam detik (5–180, default 15) |

Contoh:

```
Pertanyaan;Pilihan A;Pilihan B;Pilihan C;Pilihan D;Jawaban Benar (A/B/C/D);Clue;Reward (langkah maju);Penalty (langkah mundur);Durasi (detik)
Apa ibu kota Indonesia?;Bandung;Jakarta;Surabaya;Medan;B;Kota terbesar di Indonesia;4;2;10
```

Ketentuan tambahan:

- Minimal **3 soal** agar tombol mulai aktif. Jika pemain lebih dari 3, syarat naik menjadi **sebanyak jumlah pemain** (`max(3, N)`) agar setiap pemain mendapat giliran.
- Baris dengan kunci jawaban tidak valid akan dilewati dan dilaporkan di layar.
- File boleh memakai akhir baris CRLF (Excel) maupun LF.
- Kolom berisi tanda `;` dapat diapit tanda kutip ganda; kutip ganda di dalam teks ditulis `""`.
- Template siap pakai tersedia lewat tombol **Unduh Template** pada layar awal.

## Aturan permainan

1. Semua pemain mulai dari kotak 1. Giliran berjalan sesuai urutan daftar pemain; pemain pertama bergerak lebih dulu.
2. Jawaban benar: token maju sesuai `Reward`. Jawaban salah atau waktu habis: token mundur sesuai `Penalty`.
3. Berhenti di kaki tangga memunculkan **soal bonus**; benar berarti naik, salah berarti tetap.
4. Berhenti di kepala ular memunculkan **soal penyelamat**; benar berarti bertahan, salah berarti turun.
5. Kotak 100 adalah garis finis. Permainan juga berakhir bila bank soal habis; peringkat lengkap diurutkan dari posisi tertinggi, lalu sisa total bantuan. Seri hanya terjadi bila dua pemain teratas sama pada posisi **dan** sisa bantuan.
6. Bila soal cadangan habis saat tangga/ular muncul, permainan melanjutkan tanpa uji tambahan.
7. Daftar pemain dikunci saat permainan berjalan; ubah pemain hanya dari layar awal.
8. **Shield** dan **Penawar** dapat aktif bersamaan. Shield aktif sejak dipakai sampai awal giliran pemiliknya berikutnya (atau sampai menyerap satu serangan/hukuman), dan menyerap satu serangan senjata dari lawan. Penawar hanya menahan hukuman mundur dari jawaban salah pada giliran itu.
9. Mendarat di **kotak senjata** memberi satu kartu senjata ke baki. Senjata dilepas sebelum menjawab soal, maksimal satu serangan per giliran.

## Bantuan (per pemain)

Panel bantuan dibagi menjadi dua tab: **Bantuan** (Lempar Soal, Clue, Ganti Soal, Double Move) dan **Pertahanan** (Shield, Penawar).

| Bantuan | Kuota | Efek |
|---|---|---|
| Lempar Soal | 2 | Soal aktif dikerjakan pemain berikutnya |
| Clue | 1 | Menampilkan petunjuk soal aktif |
| Shield | 1 | Menyerap satu serangan senjata lawan (atau satu hukuman); bertahan sampai awal giliranmu berikutnya |
| Penawar | 1 | Jawaban salah atau waktu habis tidak mengurangi langkah pada giliran ini |
| Ganti Soal | 1 | Menukar soal aktif dengan soal berikutnya |
| Double Move | 2 | Langkah maju menjadi dua kali lipat bila benar |

## Senjata papan

Kotak senjata: **8, 15, 34, 45, 70, 85**. Jenis senjata diacak sekali per sesi, sehingga kotak yang sama selalu memberi senjata yang sama sepanjang permainan. Baki menampung **2 kartu**; bila penuh, pilih slot yang diganti atau lepaskan senjata baru. Senjata hanya diberikan saat pemain **maju** ke kotak tersebut, bukan saat mundur.

| Senjata | Efek |
|---|---|
| Bom | Lawan mundur 6, 8, atau 10 kotak (acak) dan tidak bisa maju pada gilirannya |
| Magnet | Lawan mundur 3 kotak dan tidak bisa maju pada gilirannya |
| Portal | Bertukar posisi dengan lawan di **depan** penyerang; tidak memberi efek kunci |
| Perangkap | Lawan kehilangan 1 bantuan acak dan tidak bisa maju pada gilirannya |

Ketentuan tambahan:

- **Satu serangan per giliran**, dilepas sebelum menjawab soal. Timer soal berhenti selama modal pilih lawan terbuka.
- **Target bebas** tanpa batas jarak. Portal hanya sah bila lawan berada di depan penyerang.
- Efek kunci hanya memblokir **langkah maju dari jawaban benar**; soal bonus tangga dan uji ular tidak terpengaruh. Efek kunci habis di akhir giliran lawan yang terkena.
- **Shield** lawan menyerap serangan: shield hangus, serangan batal (termasuk efek kunci/Perangkap), dan senjata penyerang tetap terpakai. **Penawar** tidak menyerap serangan.
- Serangan (Bom/Magnet) tidak memicu soal penyelamat ular; gigitan ular hanya terjadi saat pemain bergerak dengan langkahnya sendiri.

## Kontrol

- **Sentuh/klik**: semua tombol berukuran besar (minimal ±100 px pada layar 4K).
- **Keyboard**: `1`–`4` atau `A`–`D` untuk menjawab. `Esc` menutup dialog hasil/hapus data, modal senjata, tetapi **tidak** menutup soal aktif (harus dijawab hingga waktu habis).
- Nama 2–4 pemain dapat diubah pada layar awal, dan urutan soal dapat diacak.
- Tombol **mute** di HUD mematikan efek suara serangan; preferensi disimpan pada `sessionStorage` key `eduladder_sound`.

## Penyimpanan

Bank soal, daftar pemain, dan preferensi pengacakan disimpan pada `sessionStorage` browser, sehingga tetap ada saat halaman dimuat ulang pada tab yang sama dan hilang saat tab ditutup. Daftar pemain memakai key `eduladder_players`; sesi lama dengan key `eduladder_teams` (`{A,B}`) otomatis dimigrasikan menjadi dua pemain. Tombol **Hapus Data** mengosongkan semuanya dan mengembalikan dua pemain default. Baki senjata dan efek kunci tidak disimpan: keduanya hidup selama satu sesi permainan.

## Catatan teknis

- Ukuran dasar antarmuka mengikuti `clamp()` agar tetap proporsional dari 1080p hingga 4K.
- Animasi dinonaktifkan otomatis bila sistem meminta `prefers-reduced-motion`.

## Lisensi

MIT License

Copyright (c) 2026 Ridwan Na'im, S.Kom.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.