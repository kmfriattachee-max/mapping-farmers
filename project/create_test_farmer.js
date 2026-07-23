const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');

(async () => {
  const DB_PATH = path.join(__dirname, 'farmers.db');
  const db = new sqlite3.Database(DB_PATH);
  const password = 'password123';
  const password_hash = await bcrypt.hash(password, 10);
  const farmer = {
    name: 'Test Farmer',
    email: 'testfarmer@example.com',
    phone: '0700000000',
    county: 'Kisii',
    latitude: -0.7,
    longitude: 34.82,
    species: 'Tilapia',
    species_json: JSON.stringify(['Tilapia']),
    culture_system: 'Pond',
    equipment: 'Nets',
    contact: '0700000000',
    image_filename: null,
    production_scale: 'Small',
    approved: 1
  };

  db.serialize(() => {
    const stmt = db.prepare(`INSERT INTO farmers (name, email, phone, password_hash, county, latitude, longitude, species, species_json, culture_system, equipment, contact, image_filename, production_scale, approved) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    stmt.run(
      farmer.name,
      farmer.email,
      farmer.phone,
      password_hash,
      farmer.county,
      farmer.latitude,
      farmer.longitude,
      farmer.species,
      farmer.species_json,
      farmer.culture_system,
      farmer.equipment,
      farmer.contact,
      farmer.image_filename,
      farmer.production_scale,
      farmer.approved,
      function(err) {
        if (err) {
          console.error('Insert error', err);
        } else {
          console.log('Inserted farmer id', this.lastID);
        }
        stmt.finalize();
        db.close();
      }
    );
  });
})();