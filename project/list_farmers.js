const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.join(__dirname, 'farmers.db'));

db.all('SELECT id, name, email, latitude, longitude FROM farmers', (err, rows) => {
  if (err) return console.error('err', err);
  console.log(rows);
  db.close();
});