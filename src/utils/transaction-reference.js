function formatTransactionReference(id) {
  return `MK-${String(id).padStart(6, '0')}`;
}

module.exports = { formatTransactionReference };
