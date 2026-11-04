function requestLogger(req, res, next) {
  const startedAt = Date.now();
  res.on('finish', () => {
    // req.path excludes query parameters, keeping webhook secrets out of logs.
    console.info(JSON.stringify({
      level: 'info', component: 'http', method: req.method,
      path: req.path, status: res.statusCode, durationMs: Date.now() - startedAt,
    }));
  });
  next();
}

module.exports = { requestLogger };
