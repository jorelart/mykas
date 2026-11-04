const { pool } = require('../config/database');
const { normalizePhone } = require('./phone');

function formatMoney(amount) {
  return `Rp ${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Number(amount || 0))}`;
}

function extractMessageText(data) {
  const msg = data?.message || {};
  return msg.conversation || msg.extendedTextMessage?.text || msg.imageMessage?.caption || msg.videoMessage?.caption || data?.text || '';
}

function parseTransactionMessage(text) {
  const match = String(text || '').match(/^\s*\/\s*(masuk|pemasukan|keluar|pengeluaran)\s+([\d.,]+)(?:\s+(.+))?\s*$/i);
  if (!match) return null;
  const amount = Number(match[2].replace(/[.,]/g, ''));
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 99999999999999) return null;
  const category = (match[3] || '').trim().slice(0, 80) || 'WhatsApp';
  return { kind: /^(masuk|pemasukan)$/i.test(match[1]) ? 'income' : 'expense', amount, category, note: null };
}

function baseHelpMessage() {
  return '*Perintah bot MyKas*\n\n`/masuk 5000 Gaji` - catat pemasukan\n`/keluar 25000 Makan` - catat pengeluaran\n`/dompet create [nama]` - buat dompet\n`/dompet` atau `/wallets` - lihat saldo setiap dompet\n`/dompet delete [nama]` - hapus dompet kosong tanpa riwayat\n`/select [nama]` - pilih dompet aktif\nSetiap transaksi masuk ke dompet aktif. Contoh: `/keluar 50000 beli semen`.\n\n`/hapus MK-000123` - minta hapus transaksi tanpa dompet; perlu konfirmasi\n`/konfirmasi hapus` atau `/batal hapus` - konfirmasi atau batalkan (5 menit)\n`/terhapus` - lihat transaksi terhapus\n`/restore MK-000123` - pulihkan transaksi tanpa dompet\n`/saldo` - ringkasan bulan ini untuk dompet aktif\n`/laporan` - laporan bulan ini untuk dompet aktif\n`/laporan bulanan` atau `/laporan mingguan` - laporan periode dompet aktif\n`/dashboard` - tautan dashboard web\n`/help` - daftar perintah\n\nGunakan titik/koma sebagai pemisah ribuan, contoh: `/masuk 1.500.000 Freelance`.';
}

function helpMessage() {
  return baseHelpMessage();
}

function welcomeMessage(name) {
  return `ðŸŽ‰ Selamat datang di MyKas, ${name}!\nAkun WhatsApp Anda berhasil diaktifkan. Anda bisa mencatat transaksi dan melihat ringkasan langsung melalui chat.\n\n${helpMessage()}`;
}

async function buildBotReply(text, phone) {
  if (!String(text || '').trim().startsWith('/')) return '';
  const command = String(text || '').trim().toLowerCase().replace(/^[/!]/, '');
  const [users] = await pool.execute('SELECT id FROM users WHERE whatsapp_number=? AND is_verified=1 LIMIT 1', [phone]);
  if (!users.length) return '';

  const reportMatch = command.match(/^laporan(?:\s+(mingguan|bulanan|weekly|monthly))?$/);
  if (command === 'saldo' || reportMatch) {
    const [sessions] = await pool.execute(`SELECT w.id,w.name FROM user_sessions s JOIN wallets w ON w.id=s.active_wallet_id JOIN users u ON u.whatsapp_number=s.phone_number WHERE u.id=? LIMIT 1`, [users[0].id]);
    if (!sessions.length) return 'Pilih dompet aktif terlebih dahulu dengan `/select [nama]`. Buat dompet dengan `/dompet create [nama]`.';
    const wallet = sessions[0];
    const weekly = reportMatch && ['mingguan', 'weekly'].includes(reportMatch[1]);
    const label = weekly ? 'Minggu ini' : 'Bulan ini';
    const periodSql = weekly
      ? 'happened_on>=DATE_SUB(CURDATE(),INTERVAL WEEKDAY(CURDATE()) DAY) AND happened_on<=CURDATE()'
      : 'happened_on>=DATE_FORMAT(CURDATE(),\'%Y-%m-01\') AND happened_on<CURDATE()+INTERVAL 1 DAY';
    const [[totals]] = await pool.execute(`SELECT COALESCE(SUM(CASE WHEN kind='income' THEN amount ELSE 0 END),0) income,
      COALESCE(SUM(CASE WHEN kind='expense' THEN amount ELSE 0 END),0) expense FROM transactions WHERE user_id=? AND wallet_id=? AND deleted_at IS NULL AND ${periodSql}`, [users[0].id, wallet.id]);
    const [categories] = await pool.execute(`SELECT category,kind,SUM(amount) total FROM transactions WHERE user_id=? AND wallet_id=? AND deleted_at IS NULL AND ${periodSql} GROUP BY category,kind ORDER BY total DESC LIMIT 4`, [users[0].id, wallet.id]);
    const details = categories.length ? `\n\n*Kategori teratas*\n${categories.map(row => `â€¢ ${row.category} (${row.kind === 'income' ? 'masuk' : 'keluar'}): ${formatMoney(row.total)}`).join('\n')}` : '';
    const dashboard = process.env.PUBLIC_URL ? `\n\nDashboard: ${process.env.PUBLIC_URL.replace(/\/$/, '')}` : '';
    return `ðŸ“Š *Laporan ${label} · ${wallet.name}*\nPemasukan: ${formatMoney(totals.income)}\nPengeluaran: ${formatMoney(totals.expense)}\nSaldo bersih: ${formatMoney(Number(totals.income) - Number(totals.expense))}${details}${dashboard}`;
  }
  if (command === 'dashboard') return process.env.PUBLIC_URL
    ? `Buka dashboard MyKas: ${process.env.PUBLIC_URL.replace(/\/$/, '')}`
    : 'Dashboard belum memiliki URL publik. Minta admin mengatur PUBLIC_URL.';
  if (['help', 'bantuan', 'menu'].includes(command)) return helpMessage();
  return '';
}

module.exports = { buildBotReply, extractMessageText, formatMoney, helpMessage, parseTransactionMessage, welcomeMessage };
