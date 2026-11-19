# KosKu — Starter Project

Starter aplikasi manajemen kos: React + Vite (frontend), Express (backend), Prisma + PostgreSQL (database).

## Persyaratan
- Node.js LTS (disarankan Node 22)
- npm
- Akun PostgreSQL, misalnya Neon
- VS Code (opsional)

## 1. Siapkan database
Buat project PostgreSQL di Neon, lalu salin:
- pooled connection string untuk `DATABASE_URL`
- direct connection string untuk `DIRECT_URL`

## 2. Siapkan backend
Buka terminal di folder proyek:
```bash
cd backend
cp .env.example .env
```
Buka `backend/.env`, lalu isi `DATABASE_URL`, `DIRECT_URL`, dan `JWT_SECRET`.
Buat JWT secret:
```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```
Lalu jalankan:
```bash
npm install
npx prisma generate
npx prisma migrate dev
npm run dev
```
Backend aktif di `http://localhost:3000`.
Setiap kali skema database berubah, hentikan backend lokal terlebih dahulu sebelum menjalankan `npx prisma migrate dev` dan `npx prisma generate`; di Windows, proses Node yang sedang berjalan dapat mengunci file Prisma Client.

Tes:
- `http://localhost:3000/`
- `http://localhost:3000/api/health`

## 3. Siapkan frontend
Buka terminal kedua dari folder utama:
```bash
cd frontend
npm install
npm run dev
```
Buka alamat Vite yang tampil, biasanya `http://localhost:5173`.
Saat development, request `/api` diteruskan Vite ke backend di `http://localhost:3000`.
Jika frontend dan backend dipasang di host berbeda, atur `VITE_API_URL` ke alamat API backend
(contoh: `https://api.example.com/api`) sebelum menjalankan build frontend. Sesuaikan juga
`FRONTEND_URL` pada konfigurasi/environment backend dengan origin frontend yang tepat (contoh:
`https://kosku.example`). Untuk lebih dari satu origin, pisahkan dengan koma tanpa wildcard
(contoh: `https://kosku.example,https://admin.kosku.example`). Origin akan dinormalisasi otomatis,
tetapi sebaiknya isi hanya origin, bukan path. Di production, backend tidak berjalan jika
`FRONTEND_URL` belum ditentukan. Setelah mengubah environment variable di penyedia hosting,
restart/redeploy backend agar konfigurasi baru digunakan.

### Integrasi email dan pembayaran
- Reset password dan notifikasi pengajuan memakai Resend. Buat API key, verifikasi domain pengirim, lalu isi `RESEND_API_KEY` dan `EMAIL_FROM` di `backend/.env`. Tanpa konfigurasi tersebut, permintaan reset tetap menampilkan respons generik dan notifikasi tidak dikirim.
- Pembayaran dapat dicatat dan diverifikasi manual tanpa layanan pihak ketiga. Untuk checkout otomatis, isi `MIDTRANS_SERVER_KEY` dari dashboard Midtrans; mulai dengan `MIDTRANS_IS_PRODUCTION="false"` untuk Sandbox.
- Daftarkan URL notifikasi Midtrans sebagai `https://alamat-api-anda/api/payments/midtrans/webhook`. Backend memverifikasi signature notifikasi dan nominal transaksi sebelum mengubah status.
- Jangan menaruh API key Resend atau Server Key Midtrans di frontend, commit, atau pesan. Simpan hanya sebagai environment variable server. Aktifkan `MIDTRANS_IS_PRODUCTION="true"` hanya setelah akun produksi dan konfigurasi webhook siap.
- Untuk deployment di belakang satu reverse proxy tepercaya yang mengakhiri TLS, atur `TRUST_PROXY="1"`. Backend menolak request HTTP saat `NODE_ENV=production`; jangan mempercayai jumlah proxy yang tidak sesuai infrastruktur.

## 4. Pengujian
Jalankan pengujian backend tanpa koneksi database:
```bash
cd backend
npm test
```
Build frontend:
```bash
cd frontend
npm run build
```

## 5. Backup dan pemulihan database
- Aktifkan backup/point-in-time recovery pada penyedia PostgreSQL produksi dan batasi akses dashboard database.
- Simpan backup berkala terenkripsi di lokasi terpisah dari database; jangan simpan file backup atau connection string di repository.
- Sebelum pemulihan, buat database/branch terpisah dan uji proses restore di sana. Verifikasi jumlah pemilik, kamar, pengajuan, dan pembayaran sebelum mengalihkan aplikasi produksi.
- Gunakan `npx prisma migrate deploy` untuk menerapkan migrasi yang sudah ada saat deployment; jangan menjalankan `migrate dev` pada database produksi.
- Rate limit bawaan disimpan di memori proses. Untuk deployment multi-instance, gunakan store bersama (misalnya Redis) agar batas permintaan berlaku konsisten.

## 6. Alur fitur saat ini
- Pemilik kos dapat daftar dan login.
- Pemilik dapat membuat, mengubah, dan menghapus kamar kosong, serta mengelola status link pendaftaran.
- Calon penghuni membuka `/daftar/TOKEN` dan mengirim pengajuan.
- Pemilik melihat pengajuan di dashboard dan dapat menyetujui/menolak.
- Pemilik dapat meminta reset password melalui email dan menerima notifikasi pengajuan baru jika Resend dikonfigurasi; status pengiriman terlihat di daftar pengajuan.
- Pembayaran dapat dicatat secara manual; integrasi Midtrans Snap tersedia setelah Server Key dan webhook dikonfigurasi.
- Aktivitas penting tersedia di menu Aktivitas dashboard.

## Catatan keamanan dan status
Starter ini tetap memerlukan pengaturan deployment, kredensial layanan, backup, dan pengujian pemulihan sebelum dipakai publik. Tinjau kebijakan privasi dan retensi data calon penghuni untuk kebutuhan operasional Anda. Jangan pernah membagikan file `.env`.
