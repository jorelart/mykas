# Kasirapi

Aplikasi pencatatan pemasukan dan pengeluaran berbasis Node.js, Express, EJS, dan MySQL. Docker Compose menjalankan aplikasi dan database dalam satu perintah.

## Menjalankan dengan Docker

1. Salin `.env.example` menjadi `.env`, lalu ganti `SESSION_SECRET`, `DB_PASSWORD`, `DB_ROOT_PASSWORD`, dan `EVOLUTION_WEBHOOK_SECRET` dengan nilai acak yang kuat.
2. Jalankan `docker compose up --build -d`.
3. Buka `http://localhost:3000` (atau port yang diatur dengan `APP_PORT`).

Skema database dibuat otomatis saat aplikasi mulai. Data MySQL tersimpan pada Docker volume `mysql_data`. Untuk melihat log, jalankan `docker compose logs -f app`.

`COOKIE_SECURE=false` mendukung pengembangan lokal melalui HTTP. Set nilainya menjadi `true` saat situs diakses melalui HTTPS.

## Fitur

- Registrasi dan login dengan hash kata sandi, sesi tersimpan di MySQL, dan perlindungan CSRF untuk formulir.
- Dashboard bulanan, transaksi pemasukan/pengeluaran, filter riwayat, hapus transaksi, dan laporan periode/kategori.
- Webhook Evolution API di `POST /api/webhook/evolution`. Pesan seperti `masuk 50000 Gaji` dan `keluar 25000 Makan siang` akan dicatat untuk akun yang nomor WhatsApp-nya cocok.
- Webhook memerlukan header `x-webhook-secret` atau parameter URL `?secret=...` yang nilainya sama dengan `EVOLUTION_WEBHOOK_SECRET`. Konfigurasikan event pesan masuk pada Evolution API dan arahkan ke endpoint tersebut.

Webhook mengenali format payload pesan Evolution API `data.key.remoteJid` dan `data.message`. Pastikan instance Evolution dapat menjangkau host aplikasi; untuk deployment publik gunakan URL HTTPS.
