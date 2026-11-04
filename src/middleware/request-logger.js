function requestLogger(req, res, next) {
  const startedAt = Date.now();
  res.on('finish', () => {
    if (res.statusCode < 400) return;
    // req.path excludes query parameters, keeping webhook secrets out of logs.
    console.warn(JSON.stringify({
      level: 'warn', component: 'http', method: req.method,
      path: req.path, status: res.statusCode, durationMs: Date.now() - startedAt,
    }));
  });
  next();
}

module.exports = { requestLogger };
