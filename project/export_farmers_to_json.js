const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'farmers.db');
const OUT_DIR = path.join(__dirname, 'public', 'data');
const OUT_FILE = path.join(OUT_DIR, 'farmers_export.json');

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) return console.error('DB open error', err);
});

db.all('SELECT * FROM farmers ORDER BY id', (err, rows) => {
  if (err) {
    console.error('Query error', err);
    db.close();
    process.exit(1);
  }

  const mapped = rows.map((r) => {
    let speciesArr = [];
    if (r.species_json) {
      try { speciesArr = JSON.parse(r.species_json); } catch (e) { speciesArr = (r.species||'').toString().split(',').map(s=>s.trim()).filter(Boolean); }
    } else if (r.species) {
      speciesArr = r.species.toString().split(',').map(s=>s.trim()).filter(Boolean);
    }
    return { ...r, species: speciesArr };
  });

  fs.writeFileSync(OUT_FILE, JSON.stringify(mapped, null, 2), 'utf8');
  console.log('Exported', mapped.length, 'farmers to', OUT_FILE);
  db.close();
});