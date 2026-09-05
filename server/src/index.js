import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { db } from './db.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  const row = db.prepare('SELECT value FROM _meta WHERE key = ?').get('schema_version');
  res.json({
    ok: true,
    service: 'liana-server',
    schema_version: row?.value ?? null,
    time: new Date().toISOString(),
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`liana-server گوش می‌ده رو پورت ${PORT}`);
});
