const crypto = require('node:crypto');
const User = require('../models/user.model');
const Transaction = require('../models/transaction.model');
const Wallet = require('../models/wallet.model');
const WebhookEvent = require('../models/webhook-event.model');
const { sendWhatsApp } = require('../utils/evolution');
const { normalizePhone } = require('../utils/phone');
const { buildBotReply, extractMessageText, formatMoney, parseTransactionMessage } = require('../utils/whatsapp-bot');
const { formatTransactionReference } = require('../utils/transaction-reference');

function log(stage, details = {}) {
  console.info(JSON.stringify({ component: 'whatsapp-webhook', stage, ...details }));
}

function parseTransactionId(reference) {
  const digits = String(reference).replace(/^MK-(?:\d{8}-)?/i, '');
  return digits.replace(/^0+(?=\d)/, '');
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
    const walletCommand = String(text).trim().match(/^\/(?:dompet(?:\s+(create|list|delete))?|wallets)(?:\s+(.+))?$/i);
    const selectMatch = String(text).trim().match(/^\/select\s+(.+)$/i);
    if (walletCommand || selectMatch) {
      let reply;
      if (selectMatch) {
        const name = selectMatch[1].trim().slice(0, 60);
        const [rows] = await connection.execute('SELECT id,name,balance FROM wallets WHERE user_id=? AND name=? LIMIT 1', [user.id, name]);
        if (!rows.length) reply = `Dompet *${name}* tidak ditemukan. Ketik */dompet* untuk melihat dompet Anda.`;
        else {
          await Wallet.select(connection, phone, rows[0].id);
          reply = `✅ Dompet aktif dipilih: *${rows[0].name}* (${formatMoney(rows[0].balance)}). Transaksi berikutnya akan masuk ke dompet ini.`;
        }
      } else {
        const action = walletCommand[1] ? walletCommand[1].toLowerCase() : 'list';
        const name = (walletCommand[2] || '').trim();
        if (action === 'create') {
          if (!name || name.length > 60) reply = 'Format: */dompet create [nama]* (maksimal 60 karakter).';
          else {
            try {
              const id = await Wallet.create(connection, phone, user.id, name);
              const [countRows] = await connection.execute('SELECT COUNT(*) total FROM wallets WHERE user_id=?', [user.id]);
              if (Number(countRows[0].total) === 1) await Wallet.select(connection, phone, id);
              reply = Number(countRows[0].total) === 1
                ? `✅ Dompet *${name}* dibuat dan dipilih sebagai dompet aktif. Saldo: ${formatMoney(0)}.`
                : `✅ Dompet *${name}* berhasil dibuat. Pilih dengan */select ${name}*.`;
            } catch (error) {
              if (error.code !== 'ER_DUP_ENTRY') throw error;
              reply = `Dompet *${name}* sudah ada.`;
            }
          }
        } else if (action === 'delete') {
          const [rows] = await connection.execute('SELECT id,balance FROM wallets WHERE user_id=? AND name=? LIMIT 1 FOR UPDATE', [user.id, name]);
          if (!rows.length) reply = `Dompet *${name || '(kosong)'}* tidak ditemukan.`;
          else {
            const [txRows] = await connection.execute('SELECT COUNT(*) total FROM transactions WHERE wallet_id=?', [rows[0].id]);
            if (Number(rows[0].balance) !== 0) reply = 'Dompet hanya bisa dihapus jika saldonya Rp 0.';
            else if (Number(txRows[0].total) > 0) reply = 'Dompet ini masih memiliki riwayat transaksi sehingga tidak dapat dihapus.';
            else {
              await connection.execute('DELETE FROM wallets WHERE id=?', [rows[0].id]);
              reply = `✅ Dompet *${name}* berhasil dihapus.`;
            }
          }
        } else {
          const wallets = await Wallet.list(connection, user.id);
          const active = await Wallet.active(connection, phone, user.id);
          reply = wallets.length
            ? `*Dompet Anda*${active ? `\nAktif: *${active.name}*` : ''}\n${wallets.map(w => `${active?.id === w.id ? '✓ AKTIF' : '-'} ${w.name}: ${formatMoney(w.balance)}`).join('\n')}\n\nPilih dompet: */select [nama]*`
            : 'Anda belum memiliki dompet. Buat dengan */dompet create [nama]*.';
        }
      }
      await connection.commit();
      try { await sendWhatsApp(phone, reply); } catch (error) { console.error(JSON.stringify({ component: 'whatsapp-webhook', stage: 'send_failed', message: error.message })); }
      return res.json({ status: 'replied' });
    }
    const deleteMatch = String(text).trim().match(/^\/hapus\s+(MK-(?:\d{8}-)?\d+|\d+)$/i);
    const normalizedCommand = String(text).trim().toLowerCase().replace(/^\//, '');
    let deleteReply = '';
    if (deleteMatch) {
      const transactionId = parseTransactionId(deleteMatch[1]);
      const [matches] = await connection.execute('SELECT id,kind,amount,category,happened_on FROM transactions WHERE id=? AND user_id=? AND wallet_id IS NULL AND deleted_at IS NULL LIMIT 1', [transactionId, user.id]);
      if (!matches.length) deleteReply = 'Transaksi tidak ditemukan atau sudah dihapus. Periksa ID di riwayat Anda.';
      else {
        await connection.execute('INSERT INTO pending_transaction_deletions (user_id,transaction_id,expires_at) VALUES (?,?,DATE_ADD(NOW(),INTERVAL 5 MINUTE)) ON DUPLICATE KEY UPDATE transaction_id=VALUES(transaction_id),expires_at=VALUES(expires_at)', [user.id, transactionId]);
        const tx = matches[0];
        deleteReply = `⚠️ Anda akan menghapus transaksi *${formatTransactionReference(tx.id)}* (${tx.kind === 'income' ? 'pemasukan' : 'pengeluaran'} ${formatMoney(tx.amount)}, ${tx.category}, ${new Date(tx.happened_on).toLocaleDateString('id-ID',{timeZone:'Asia/Jakarta'})}).\nData akan disembunyikan dari laporan.\nBalas */konfirmasi hapus* dalam 5 menit untuk melanjutkan, atau */batal hapus* untuk membatalkan.`;
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
        deleteReply = 'Tidak ada permintaan hapus yang aktif. Buat permintaan baru dengan */hapus MK-000123*.';
      } else {
        const [result] = await connection.execute('UPDATE transactions SET deleted_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND deleted_at IS NULL', [pending[0].transaction_id, user.id]);
        await connection.execute('DELETE FROM pending_transaction_deletions WHERE user_id=?', [user.id]);
        deleteReply = result.affectedRows ? 'Transaksi dihapus dari riwayat aktif. Data tersimpan sebagai soft delete.' : 'Transaksi tidak ditemukan atau sudah dihapus.';
      }
      await connection.commit();
      try { await sendWhatsApp(phone, deleteReply); } catch (error) { console.error(JSON.stringify({ component: 'whatsapp-webhook', stage: 'send_failed', message: error.message })); }
      return res.json({ status: 'replied' });
    }
    const restoreMatch = String(text).trim().match(/^\/restore\s+(MK-(?:\d{8}-)?\d+|\d+)$/i);
    if (restoreMatch) {
      const transactionId = parseTransactionId(restoreMatch[1]);
      const [result] = await connection.execute('UPDATE transactions SET deleted_at=NULL WHERE id=? AND user_id=? AND wallet_id IS NULL AND deleted_at IS NOT NULL', [transactionId, user.id]);
      deleteReply = result.affectedRows
        ? `Transaksi *${formatTransactionReference(transactionId)}* berhasil dipulihkan dan kembali masuk ke laporan.`
        : 'Transaksi terhapus tidak ditemukan pada akun Anda.';
      await connection.commit();
      try { await sendWhatsApp(phone, deleteReply); } catch (error) { console.error(JSON.stringify({ component: 'whatsapp-webhook', stage: 'send_failed', message: error.message })); }
      return res.json({ status: 'replied' });
    }
    if (normalizedCommand === 'terhapus') {
      const [deletedRows] = await connection.execute('SELECT id,kind,amount,category,deleted_at FROM transactions WHERE user_id=? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC,id DESC LIMIT 10', [user.id]);
      deleteReply = deletedRows.length
        ? `*Transaksi terhapus*\n${deletedRows.map(tx => `• ${formatTransactionReference(tx.id)} — ${tx.kind === 'income' ? 'pemasukan' : 'pengeluaran'} ${formatMoney(tx.amount)}, ${tx.category}`).join('\n')}\n\nPulihkan dengan /restore MK-000123.`
        : 'Tidak ada transaksi terhapus yang bisa dipulihkan.';
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

    const activeWallet = await Wallet.active(connection, phone, user.id);
    if (!activeWallet) {
      const wallets = await Wallet.list(connection, user.id);
      await connection.commit();
      const names = wallets.length ? wallets.map(wallet => wallet.name).join(', ') : 'belum ada dompet';
      try { await sendWhatsApp(phone, `Pilih dompet aktif terlebih dahulu dengan */select [nama_dompet]*. Dompet tersedia: ${names}. Jika belum ada, buat dengan */dompet create [nama]*.`); } catch (error) { console.error(JSON.stringify({ component: 'whatsapp-webhook', stage: 'send_failed', message: error.message })); }
      return res.json({ status: 'replied' });
    }
    const [lockedWallets] = await connection.execute('SELECT id,name,balance FROM wallets WHERE id=? AND user_id=? FOR UPDATE', [activeWallet.id, user.id]);
    if (!lockedWallets.length) throw new Error('Dompet aktif tidak ditemukan.');
    const wallet = lockedWallets[0];
    const balance = Number(wallet.balance) + (parsed.kind === 'income' ? parsed.amount : -parsed.amount);
    if (balance < 0) {
      await connection.commit();
      try { await sendWhatsApp(phone, `Saldo dompet *${wallet.name}* tidak cukup. Saldo saat ini: ${formatMoney(wallet.balance)}.`); } catch (error) { console.error(JSON.stringify({ component: 'whatsapp-webhook', stage: 'send_failed', message: error.message })); }
      return res.json({ status: 'replied' });
    }

    const transactionId = await Transaction.createFromWebhook({ connection, userId: user.id, walletId: wallet.id, ...parsed });
    await connection.execute('UPDATE wallets SET balance=? WHERE id=?', [balance, wallet.id]);
    await WebhookEvent.markRecorded(connection, messageId);
    await connection.commit();
    try {
      const date = new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'long', year: 'numeric' });
      const reference = formatTransactionReference(transactionId);
      await sendWhatsApp(phone, `✅ Berhasil dicatat! ${formatMoney(parsed.amount)} (${parsed.kind === 'income' ? 'Masuk' : 'Keluar'}) [Pos: 🏠 ${wallet.name}] | Sisa Saldo: ${formatMoney(balance)}\nID: *${reference}*\nTanggal: ${date}\nKeterangan: *${parsed.category}*`);
    } catch (error) { console.error(JSON.stringify({ component: 'whatsapp-webhook', stage: 'send_failed', message: error.message })); }
    log('transaction_recorded', { kind: parsed.kind, event: eventName });
    return res.json({ status: 'recorded' });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

module.exports = { evolution };
