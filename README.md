# Kasirapi

Aplikasi pencatatan pemasukan dan pengeluaran berbasis Node.js, Express, EJS, dan MySQL. Docker Compose menjalankan aplikasi dan database dalam satu perintah.

## Menjalankan dengan Docker

1. Salin `.env.example` menjadi `.env`, lalu ganti `SESSION_SECRET`, `DB_PASSWORD`, `DB_ROOT_PASSWORD`, `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, dan `EVOLUTION_INSTANCE` sesuai konfigurasi Evolution API Anda. Atur juga `EVOLUTION_WEBHOOK_SECRET` dengan nilai acak yang kuat.
2. Jalankan `docker compose up --build -d`.
3. Buka `http://localhost:3000` (atau port yang diatur dengan `APP_PORT`).

Skema database dibuat otomatis saat aplikasi mulai. Data MySQL tersimpan pada Docker volume `mysql_data`. Untuk melihat log, jalankan `docker compose logs -f app`.

`COOKIE_SECURE=false` mendukung pengembangan lokal melalui HTTP. Set nilainya menjadi `true` saat situs diakses melalui HTTPS.

## Fitur

- Registrasi dan login dengan hash kata sandi, sesi tersimpan di MySQL, dan perlindungan CSRF untuk formulir.
- Aktivasi pendaftar dan reset kata sandi melalui OTP WhatsApp 6 digit (berlaku 5 menit, maksimal 5 percobaan, jeda 60 detik untuk kirim ulang).
- Dashboard bulanan, transaksi pemasukan/pengeluaran, filter riwayat, hapus transaksi, dan laporan periode/kategori.
- Webhook Evolution API di `POST /api/webhook/evolution`. Pesan seperti `masuk 50000 Gaji` dan `keluar 25000 Makan siang` akan dicatat untuk akun yang nomor WhatsApp-nya cocok.
- Pengguna juga dapat mengirim `saldo` atau `laporan` melalui WhatsApp untuk menerima ringkasan bulan berjalan, `dashboard` untuk tautan dashboard web, atau `bantuan` untuk melihat format perintah.
- Webhook memerlukan header `x-webhook-secret` atau parameter URL `?secret=...` yang nilainya sama dengan `EVOLUTION_WEBHOOK_SECRET`. Konfigurasikan event pesan masuk pada Evolution API dan arahkan ke endpoint tersebut.

Webhook mengenali format payload pesan Evolution API `data.key.remoteJid` dan `data.message`. Pastikan instance Evolution dapat menjangkau host aplikasi; untuk deployment publik gunakan URL HTTPS.

Untuk mengirim OTP dan balasan WhatsApp, aplikasi memanggil endpoint Evolution API `POST /message/sendText/{instance}` dengan header `apikey`. Isi `EVOLUTION_API_URL` dengan URL dasar API yang dapat dijangkau dari container aplikasi, dan pastikan koneksi WhatsApp instance Evolution berstatus aktif. Konfigurasikan event `MESSAGES_UPSERT` menuju `https://alamat-aplikasi/api/webhook/evolution?secret=NILAI_EVOLUTION_WEBHOOK_SECRET`. Matikan `webhook_by_events` atau `webhookByEvents`, karena endpoint utama sudah menerima event `MESSAGES_UPSERT`. `PUBLIC_URL` dapat diisi URL publik aplikasi agar ditampilkan pada pesan ringkasan WhatsApp.

Evolution API mengirim pesan baru melalui event `MESSAGES_UPSERT` dan endpoint kirim teks menggunakan `POST /message/sendText/{instance}` dengan header API key. Lihat [dokumentasi webhook Evolution](https://github.com/evolution-foundation/evolution-docs/blob/main/docs/02-Configuration/Webhooks.md) dan [referensi endpoint kirim teks](https://skmtc.dev/evolution-foundation/apis/evolution-api-3/docs/message/sendText/:instance/post) untuk konfigurasi sesuai versi Evolution yang Anda jalankan.
