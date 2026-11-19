# Catatan Backlog Proyek KosKu

Status di bawah menunjukkan implementasi kode dan dokumentasi pada workspace. Integrasi email dan pembayaran sudah disiapkan, tetapi tetap memerlukan kredensial layanan dan konfigurasi deployment sebelum aktif. Migrasi database dan regenerasi Prisma Client di mesin lokal belum dijalankan karena backend yang aktif tidak dihentikan.

## 1. Epic

### EPIC-01 — Autentikasi Pemilik Kos
**Tujuan:** Pemilik dapat mengakses dashboard dan memulihkan akun dengan aman.

- **TASK-01.1 — Registrasi dan login pemilik** — `Selesai`
  - [x] Buat akun pemilik dengan nama, email, dan password tervalidasi.
  - [x] Login dan simpan sesi autentikasi di browser.
  - [x] Tampilkan pesan saat autentikasi berhasil atau gagal.
- **TASK-01.2 — Pemulihan akun** — `Selesai`
  - [x] Sediakan permintaan reset password dengan respons generik anti-enumerasi.
  - [x] Gunakan token acak tersimpan sebagai hash, kedaluwarsa setelah 30 menit, dan hanya bisa dipakai sekali.
  - [x] Kirim tautan reset melalui Resend setelah environment email dikonfigurasi.

### EPIC-02 — Pengelolaan Kamar
**Tujuan:** Pemilik dapat mengelola kamar dan melihat ketersediaannya.

- **TASK-02.1 — Daftar dan tambah kamar** — `Selesai`
  - [x] Tampilkan daftar kamar milik pemilik yang sedang login.
  - [x] Tambahkan kamar dengan nama dan harga bulanan tervalidasi.
  - [x] Tampilkan ringkasan jumlah kamar dan kamar kosong.
- **TASK-02.2 — Hapus kamar kosong** — `Selesai`
  - [x] Izinkan penghapusan kamar kosong.
  - [x] Cegah penghapusan kamar yang sedang terisi.
- **TASK-02.3 — Ubah detail kamar** — `Selesai`
  - [x] Ubah nama dan harga kamar dari dashboard.
  - [x] Validasi perubahan dan perbarui data yang ditampilkan.

### EPIC-03 — Pendaftaran Calon Penghuni
**Tujuan:** Pemilik dapat membagikan link pendaftaran dan mengelola pengajuan.

- **TASK-03.1 — Buat dan bagikan link pendaftaran** — `Selesai`
  - [x] Buat token undangan unik.
  - [x] Tampilkan URL pendaftaran dan tautan untuk membuka formulir.
  - [x] Salin link melalui Clipboard API dengan fallback browser.
- **TASK-03.2 — Formulir pendaftaran publik** — `Selesai`
  - [x] Tampilkan formulir berdasarkan token undangan yang valid.
  - [x] Terima nama lengkap dan WhatsApp sebagai data wajib.
  - [x] Simpan data pekerjaan, tanggal masuk, dan catatan opsional setelah validasi.
- **TASK-03.3 — Tinjau pengajuan** — `Selesai`
  - [x] Tampilkan dan saring daftar pengajuan berdasarkan status.
  - [x] Terima pengajuan dengan memilih kamar kosong, atau tolak/hapus pengajuan.
  - [x] Perbarui status kamar secara transaksional.
- **TASK-03.4 — Kelola link undangan** — `Selesai`
  - [x] Tampilkan link yang pernah dibuat, waktu pembuatan, dan status aktif.
  - [x] Aktifkan atau nonaktifkan link dari dashboard.
- **TASK-03.5 — Notifikasi pengajuan** — `Selesai`
  - [x] Kirim notifikasi email kepada pemilik saat pengajuan baru masuk.
  - [x] Catat kegagalan pengiriman di log server tanpa menggagalkan pengajuan.
  - [x] Gunakan Resend; konfigurasi `RESEND_API_KEY` dan `EMAIL_FROM` diperlukan.

### EPIC-04 — Keamanan dan Keandalan
**Tujuan:** Mengurangi risiko dan mendokumentasikan operasional aplikasi.

- **TASK-04.1 — Validasi input** — `Selesai`
  - [x] Validasi tipe, panjang, format tanggal, email, nomor telepon, dan nominal di backend.
  - [x] Batasi ukuran body JSON dan tolak body dengan bentuk yang tidak valid.
  - [x] Tambahkan batas panjang field di formulir yang relevan.
- **TASK-04.2 — Perlindungan endpoint** — `Selesai`
  - [x] Terapkan rate limit untuk login, registrasi, reset password, dan endpoint publik.
  - [x] Validasi versi token; reset password mencabut sesi lama.
  - [x] Tolak koneksi HTTP di production dan batasi CORS ke origin yang dikonfigurasi.
- **TASK-04.3 — Operasional dan audit** — `Selesai`
  - [x] Dokumentasikan backup, pemulihan database, migrasi deployment, dan batas rate limit.
  - [x] Catat aksi penting pemilik dan sediakan endpoint serta halaman riwayat aktivitas.
  - [x] Sediakan health check backend dan respons error API yang konsisten.
- **TASK-04.4 — Pengujian otomatis** — `Selesai`
  - [x] Uji validasi, autentikasi, pembatasan kepemilikan link, dan reset password.
  - [x] Uji signature webhook Midtrans dan pencatatan pembayaran.
  - [x] Sediakan perintah test backend dan build frontend.

### EPIC-05 — Pembayaran dan Penghuni
**Tujuan:** Mencatat pembayaran dan mendukung checkout resmi.

- **TASK-05.1 — Pencatatan pembayaran manual** — `Selesai`
  - [x] Catat nominal, penghuni, bulan tagihan, metode, dan catatan.
  - [x] Tampilkan riwayat pembayaran dan status di dashboard.
  - [x] Verifikasi atau ubah status pembayaran secara manual.
- **TASK-05.2 — Integrasi pembayaran otomatis** — `Selesai`
  - [x] Integrasikan Midtrans Snap dengan Server Key yang hanya berada di backend.
  - [x] Validasi signature dan nominal webhook sebelum memperbarui status.
  - [x] Dokumentasikan konfigurasi Sandbox/production dan URL notifikasi.

## 2. Sprint

Semua sprint berikut selesai pada tingkat implementasi kode. Aktivasi layanan eksternal tetap menunggu konfigurasi environment dan akun merchant.

### Sprint 1 — Fondasi MVP — `Selesai`
- [x] Registrasi/login, pengelolaan kamar, pembuatan link, formulir, dan tinjau pengajuan.

### Sprint 2 — Penyempurnaan Pengalaman — `Selesai`
- [x] Ubah kamar, kelola link undangan, notifikasi pengajuan, dan pengujian alur MVP.

### Sprint 3 — Kesiapan Produksi — `Selesai`
- [x] Validasi, rate limit, HTTPS/CORS, audit log, health check, dan panduan backup/deployment.

### Sprint 4 — Pembayaran — `Selesai`
- [x] Pencatatan pembayaran manual.
- [x] Checkout Midtrans Snap dan pemrosesan webhook terverifikasi.

## 3. Label

Gunakan label berikut untuk mengelompokkan task di issue tracker atau papan kerja.

| Label | Arti |
|---|---|
| `epic` | Item tingkat besar yang mengelompokkan beberapa task. |
| `frontend` | Perubahan antarmuka atau perilaku di aplikasi React. |
| `backend` | Perubahan endpoint, logika server, atau integrasi API. |
| `database` | Perubahan skema Prisma, migrasi, atau data. |
| `security` | Autentikasi, validasi, privasi, atau perlindungan penyalahgunaan. |
| `testing` | Pengujian otomatis atau validasi alur. |
| `ux` | Kemudahan penggunaan, aksesibilitas, atau pesan kepada pengguna. |
| `operations` | Deployment, konfigurasi, monitoring, backup, atau pemulihan. |
| `payments` | Pencatatan atau integrasi pembayaran. |
| `notifications` | Pemberitahuan melalui email atau kanal lain. |
| `mvp` | Fitur inti untuk versi MVP. |
| `done` | Task telah selesai dan tersedia di implementasi. |

## 4. Catatan aktivasi

- Sebelum memakai endpoint baru, hentikan backend lokal lalu jalankan `npx prisma migrate dev` dan `npx prisma generate` dari folder `backend`.
- Isi `RESEND_API_KEY`, `EMAIL_FROM`, dan `MIDTRANS_SERVER_KEY` di environment server untuk mengaktifkan integrasi eksternal.
- `npm audit --omit=dev` melaporkan tiga kerentanan high pada dependency Prisma/deepmerge; perbaikan yang ditawarkan npm memerlukan upgrade major Prisma. Tinjau dan uji upgrade tersebut sebelum deployment produksi.
