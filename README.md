# MyKas

Aplikasi pencatatan pemasukan dan pengeluaran berbasis Node.js, Express, EJS, dan MySQL. Docker Compose menjalankan aplikasi dan database dalam satu perintah.

## Struktur aplikasi

```text
src/
  app.js                    konfigurasi Express dan pemasangan route
  server.js                 bootstrap server dan inisialisasi database
  config/database.js        koneksi pool dan skema MySQL
  routes/                   pemetaan URL ke controller
  controllers/              alur autentikasi, transaksi, laporan, dan webhook
  models/                   operasi data MySQL
  middleware/               autentikasi, CSRF, async handler, dan access log
  utils/                    integrasi Evolution API dan parser pesan WhatsApp
views/                      template EJS
static/                     CSS dan aset frontend
```

## Menjalankan dengan Docker

1. Salin `.env.example` menjadi `.env`, lalu ganti `SESSION_SECRET`, `DB_PASSWORD`, `DB_ROOT_PASSWORD`, `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, dan `EVOLUTION_INSTANCE` sesuai konfigurasi Evolution API Anda. Atur juga `EVOLUTION_WEBHOOK_SECRET` dengan nilai acak yang kuat.
2. Jalankan `docker compose up --build -d`.
3. Buka `http://localhost:3000` (atau port yang diatur dengan `APP_PORT`).

Skema database dibuat otomatis saat aplikasi mulai. Data MySQL tersimpan pada Docker volume `mysql_data`. Untuk melihat log, jalankan `docker compose logs -f app`.

Untuk mengaktifkan panel admin, isi `ADMIN_EMAIL` di `.env` dengan email admin. Daftarkan dan verifikasi akun tersebut melalui OTP; setelah login akun itu akan melihat menu **Admin** di dashboard. Panel admin berisi ringkasan akun, transaksi terbaru seluruh pengguna, serta status aktivasi.

`COOKIE_SECURE=false` mendukung pengembangan lokal melalui HTTP. Set nilainya menjadi `true` saat situs diakses melalui HTTPS.

## Fitur

- Registrasi dan login dengan hash kata sandi, sesi tersimpan di MySQL, dan perlindungan CSRF untuk formulir.
- Aktivasi pendaftar dan reset kata sandi melalui OTP WhatsApp 6 digit (berlaku 5 menit, maksimal 5 percobaan, jeda 60 detik untuk kirim ulang).
- Setelah aktivasi, pengguna menerima pesan WhatsApp selamat datang yang berisi daftar command bot.
- Dashboard bulanan, transaksi pemasukan/pengeluaran, filter riwayat, soft delete transaksi, dan laporan periode/kategori.
- Detail transaksi dengan tanggal, sumber, catatan, serta ID nomor urut seperti `MK-000123`.
- Setelah OTP benar, dashboard menampilkan ucapan bahwa pendaftaran berhasil dan akun telah aktif.
- Bot WhatsApp menerima `!help`, `!masuk 5.000.000 Gaji`, `!keluar 25.000 Makan siang`, `!hapus MK-000123` (diikuti `!konfirmasi hapus` atau `!batal hapus` dalam 5 menit), `!saldo`, `!laporan mingguan`, `!laporan bulanan`, dan `!dashboard`. Balasan transaksi mengonfirmasi kategori dan nominal; laporan menyertakan total serta kategori teratas.
- Webhook memerlukan header `x-webhook-secret` atau parameter URL `?secret=...` yang nilainya sama dengan `EVOLUTION_WEBHOOK_SECRET`. Konfigurasikan event pesan masuk pada Evolution API dan arahkan ke endpoint tersebut.

Webhook mengenali format payload pesan Evolution API `data.key.remoteJid` dan `data.message`. Nominal titik atau koma diperlakukan sebagai pemisah ribuan. Pastikan instance Evolution dapat menjangkau host aplikasi; untuk deployment publik gunakan URL HTTPS.

Untuk mengirim OTP dan balasan WhatsApp, aplikasi memanggil endpoint Evolution API `POST /message/sendText/{instance}` dengan header `apikey`. Isi `EVOLUTION_API_URL` dengan URL dasar API yang dapat dijangkau dari container aplikasi, dan pastikan koneksi WhatsApp instance Evolution berstatus aktif. Konfigurasikan event `MESSAGES_UPSERT` menuju `https://alamat-aplikasi/api/webhook/evolution?secret=NILAI_EVOLUTION_WEBHOOK_SECRET`. Matikan `webhook_by_events` atau `webhookByEvents`, karena endpoint utama sudah menerima event `MESSAGES_UPSERT`. `PUBLIC_URL` dapat diisi URL publik aplikasi agar ditampilkan pada pesan ringkasan WhatsApp.

Evolution API mengirim pesan baru melalui event `MESSAGES_UPSERT` dan endpoint kirim teks menggunakan `POST /message/sendText/{instance}` dengan header API key. Lihat [dokumentasi webhook Evolution](https://github.com/evolution-foundation/evolution-docs/blob/main/docs/02-Configuration/Webhooks.md) dan [referensi endpoint kirim teks](https://skmtc.dev/evolution-foundation/apis/evolution-api-3/docs/message/sendText/:instance/post) untuk konfigurasi sesuai versi Evolution yang Anda jalankan.

## Troubleshooting bot WhatsApp

Setelah deploy perubahan, lihat log dengan `docker compose logs -f app`, lalu kirim `!help` dari WhatsApp yang nomornya terdaftar dan terverifikasi di MyKas. Access log hanya menampilkan request gagal (status 4xx/5xx), jadi polling `/health` dan halaman sukses tidak memenuhi log. Query string tidak dicatat agar secret webhook tidak muncul di log. Baris `component: whatsapp-webhook` mencatat event penting dan alasan jika webhook ditolak atau perintah diabaikan. Pesan dari nomor WhatsApp bot sendiri diabaikan.

Untuk mengecek koneksi jaringan ke Evolution dari container aplikasi, jalankan `docker exec mykas-app node -e "fetch(process.env.EVOLUTION_API_URL).then(r=>console.log('Evolution HTTP',r.status)).catch(e=>console.error(e.cause||e))"`. Status HTTP apa pun menunjukkan host dan port dapat dijangkau; `fetch failed` biasanya menandakan URL, jaringan Docker, atau port tidak cocok.
