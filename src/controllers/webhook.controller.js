const crypto = require('node:crypto');
const User = require('../models/user.model');
const Transaction = require('../models/transaction.model');
const WebhookEvent = require('../models/webhook-event.model');
const { sendWhatsApp } = require('../utils/evolution');
const { normalizePhone } = require('../utils/phone');
const { buildBotReply, extractMessageText, formatMoney, parseTransactionMessage } = require('../utils/whatsapp-bot');
const { formatTransactionReference } = require('../utils/transaction-reference');

function log(stage, details = {}) {
  console.info(JSON.stringify({ component: 'whatsapp-webhook', stage, ...details }));
}

async function evolution(req, res) {
  const eventName = req.params.event || req.body?.event || 'unspecified';
  log('received', { event: eventName });
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET || '';
  if (!secret) {
    console.error(JSON.stringify({ component: 'whatsapp-webhook', stage: 'rejected', reason: 'secret_not_configured' }));
    return res.status(503).json({ error: 'webhook_not_configured' });
  }
  const supplied = String(req.get('x-webhook-secret') || req.query.secret || '');
  if (supplied.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(secret))) {
    console.warn(JSON.stringify({ component: 'whatsapp-webhook', stage: 'rejected', reason: 'invalid_secret' }));
    return res.status(401).json({ error: 'unauthorized' });
  }

  const data = req.body?.data && typeof req.body.data === 'object' ? req.body.data : req.body;
  const key = data?.key || {};
  const messageId = String(key.id || data?.id || '');
  if (!messageId) { log('ignored', { reason: 'missing_message_id', event: eventName }); return res.json({ status: 'ignored', reason: 'missing_message_id' }); }

  const connection = await WebhookEvent.getConnection();
  try {
    await connection.beginTransaction();
    if (!(await WebhookEvent.claim(connection, messageId))) {
      await connection.rollback(); log('ignored', { reason: 'duplicate_message', event: eventName });
      return res.json({ status: 'duplicate' });
    }
    const text = extractMessageText(data);
    const parsed = parseTransactionMessage(text);
    const phone = normalizePhone(String(key.remoteJidAlt || key.remoteJid || data?.remoteJidAlt || data?.remoteJid || '').split('@')[0]);
    if (key.fromMe) {
      await connection.commit(); log('ignored', { reason: 'message_from_bot', event: eventName });
      return res.json({ status: 'ignored' });
    }
    const user = await User.findVerifiedByPhone(phone);
    if (!user) {
      await connection.commit(); log('ignored', { reason: 'sender_not_verified', event: eventName });
      return res.json({ status: 'unmatched_sender' });
    }
    const deleteMatch = String(text).trim().match(/^!?hapus\s+(MK-(?:\d{8}-)?\d+|\d+)$/i);
    const normalizedCommand = String(text).trim().toLowerCase().replace(/^!/, '');
    let deleteReply = '';
    if (deleteMatch) {
      const digits = deleteMatch[1].replace(/^MK-(?:\d{8}-)?/i, '');
      const transactionId = digits.replace(/^0+(?=\d)/, '');
      const [matches] = await connection.execute('SELECT id,kind,amount,category,happened_on FROM transactions WHERE id=? AND user_id=? AND deleted_at IS NULL LIMIT 1', [transactionId, user.id]);
      if (!matches.length) deleteReply = 'Transaksi tidak ditemukan atau sudah dihapus. Periksa ID di riwayat Anda.';
      else {
        await connection.execute('INSERT INTO pending_transaction_deletions (user_id,transaction_id,expires_at) VALUES (?,?,DATE_ADD(NOW(),INTERVAL 5 MINUTE)) ON DUPLICATE KEY UPDATE transaction_id=VALUES(transaction_id),expires_at=VALUES(expires_at)', [user.id, transactionId]);
        const tx = matches[0];
        deleteReply = `⚠️ Anda akan menghapus transaksi *${formatTransactionReference(tx.id)}* (${tx.kind === 'income' ? 'pemasukan' : 'pengeluaran'} ${formatMoney(tx.amount)}, ${tx.category}, ${new Date(tx.happened_on).toLocaleDateString('id-ID',{timeZone:'Asia/Jakarta'})}).\nData akan disembunyikan dari laporan.\nBalas *!konfirmasi hapus* dalam 5 menit untuk melanjutkan, atau *!batal hapus* untuk membatalkan.`;
      }
      await connection.commit();
      try { await sendWhatsApp(phone, deleteReply); } catch (error) { console.error(JSON.stringify({ component: 'whatsapp-webhook', stage: 'send_failed', message: error.message })); }
      return res.json({ status: 'replied' });
    }
    if (['konfirmasi hapus', 'batal hapus'].includes(normalizedCommand)) {
      const [pending] = await connection.execute('SELECT transaction_id FROM pending_transaction_deletions WHERE user_id=? AND expires_at>NOW() LIMIT 1', [user.id]);
      if (normalizedCommand === 'batal hapus') {
        await connection.execute('DELETE FROM pending_transaction_deletions WHERE user_id=?', [user.id]);
        deleteReply = pending.length ? 'Permintaan hapus dibatalkan.' : 'Tidak ada permintaan hapus yang masih aktif.';
      } else if (!pending.length) {
        await connection.execute('DELETE FROM pending_transaction_deletions WHERE user_id=?', [user.id]);
        deleteReply = 'Tidak ada permintaan hapus yang aktif. Buat permintaan baru dengan *!hapus MK-000123*.';
      } else {
        const [result] = await connection.execute('UPDATE transactions SET deleted_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND deleted_at IS NULL', [pending[0].transaction_id, user.id]);
        await connection.execute('DELETE FROM pending_transaction_deletions WHERE user_id=?', [user.id]);
        deleteReply = result.affectedRows ? 'Transaksi dihapus dari riwayat aktif. Data tersimpan sebagai soft delete.' : 'Transaksi tidak ditemukan atau sudah dihapus.';
      }
      await connection.commit();
      try { await sendWhatsApp(phone, deleteReply); } catch (error) { console.error(JSON.stringify({ component: 'whatsapp-webhook', stage: 'send_failed', message: error.message })); }
      return res.json({ status: 'replied' });
    }
    if (!parsed) {
      await connection.commit();
      const reply = await buildBotReply(text, phone);
      if (!reply) { log('ignored', { reason: 'unknown_command', event: eventName }); return res.json({ status: 'ignored' }); }
      try { await sendWhatsApp(phone, reply); log('replied', { command: 'bot_command', event: eventName }); }
      catch (error) { console.error(JSON.stringify({ component: 'whatsapp-webhook', stage: 'send_failed', message: error.message })); }
      return res.json({ status: 'replied' });
    }

    const transactionId = await Transaction.createFromWebhook({ connection, userId: user.id, ...parsed });
    await WebhookEvent.markRecorded(connection, messageId);
    await connection.commit();
    try {
      const date = new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'long', year: 'numeric' });
      const reference = formatTransactionReference(transactionId);
      await sendWhatsApp(phone, `✅ ${parsed.kind === 'income' ? 'Pemasukan' : 'Pengeluaran'} berhasil dicatat.\nID: *${reference}*\nTanggal: ${date}\nKategori: *${parsed.category}*\nNominal: *${formatMoney(parsed.amount)}*\nKetik *!saldo* untuk ringkasan atau *!help* untuk daftar perintah.`);
    } catch (error) { console.error(JSON.stringify({ component: 'whatsapp-webhook', stage: 'send_failed', message: error.message })); }
    log('transaction_recorded', { kind: parsed.kind, event: eventName });
    return res.json({ status: 'recorded' });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

module.exports = { evolution };
