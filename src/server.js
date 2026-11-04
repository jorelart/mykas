require('dotenv').config();

const app = require('./app');
const { initializeDatabase } = require('./config/database');

async function start() {
  await initializeDatabase();
  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => console.log(`MyKas berjalan di port ${port}`));
}

if (require.main === module) {
  start().catch(error => {
    console.error(JSON.stringify({ level: 'fatal', component: 'startup', message: error.message }));
    process.exit(1);
  });
}

module.exports = { app, start };
