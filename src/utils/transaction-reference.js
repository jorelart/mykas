function formatTransactionReference(id, happenedOn) {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date(happenedOn)).replace(/-/g, '');
  return `MK-${date}-${String(id).padStart(6, '0')}`;
}

module.exports = { formatTransactionReference };
