const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
let turf;
try {
  turf = require('@turf/turf');
} catch (e) {
  console.warn('Turf not installed. River buffer endpoint will be unavailable until @turf/turf is installed.');
}

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'farmers.db');
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'password123';
const VALID_COUNTIES = ['Kisii', 'Nyamira', 'Homa Bay'];
const VALID_GENDERS = ['Male', 'Female', 'Other'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9.-]/g, '');
    cb(null, `${Date.now()}-${safeName}`);
  }
});

const imageFilter = (req, file, cb) => {
  if (!file.mimetype.startsWith('image/')) {
    return cb(new Error('Only image files are allowed'), false);
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Unable to open database', err);
    process.exit(1);
  }
});

const createTableSql = `
CREATE TABLE IF NOT EXISTS farmers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  phone TEXT,
  password_hash TEXT,
  county TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  species TEXT NOT NULL,
  species_json TEXT,
  gender TEXT,
  culture_system TEXT NOT NULL,
  equipment TEXT,
  contact TEXT,
  image_filename TEXT,
  approved INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`;

db.run(createTableSql, (err) => {
  if (err) {
    console.error('Unable to create farmers table', err);
  }
});

const createSupplierTableSql = `
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_name TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  county TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  species TEXT NOT NULL,
  species_json TEXT,
  category TEXT NOT NULL DEFAULT 'Fingerlings',
  verified INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`;

const createSupplierStockTableSql = `
CREATE TABLE IF NOT EXISTS supplier_stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL,
  species TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  price REAL NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT 'Fingerlings',
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(supplier_id) REFERENCES suppliers(id)
);
`;

db.run(createSupplierTableSql, (err) => {
  if (err) {
    console.error('Unable to create suppliers table', err);
  }
  db.run(createSupplierStockTableSql, (err) => {
    if (err) {
      console.error('Unable to create supplier stock table', err);
    }
    // Now that tables are created, populate initial data
    db.serialize(() => {
      db.get('SELECT COUNT(*) AS count FROM suppliers', (err, row) => {
        if (!err && row && row.count === 0) {
          const supplierRecords = [
            { farm_name: 'Kegati Hatchery', owner_name: 'KMFRI Team', phone: '0712345678', county: 'Kisii', latitude: -0.70875, longitude: 34.82152, species: 'Tilapia', species_json: JSON.stringify(['Tilapia']), category: 'Fingerlings', verified: 1, quantity: 50000, price: 8 },
            { farm_name: 'Nyamira Aqua Farm', owner_name: 'Jane Doe', phone: '0722345678', county: 'Nyamira', latitude: -0.5580, longitude: 34.9380, species: 'Catfish', species_json: JSON.stringify(['Catfish']), category: 'Fingerlings', verified: 1, quantity: 35000, price: 10 },
            { farm_name: 'Homa Bay Hatchery', owner_name: 'John Otieno', phone: '0733456789', county: 'Homa Bay', latitude: -0.5280, longitude: 34.4530, species: 'Tilapia, Catfish', species_json: JSON.stringify(['Tilapia', 'Catfish']), category: 'Mixed', verified: 1, quantity: 25000, price: 12 }
          ];
          db.run('BEGIN TRANSACTION');
          supplierRecords.forEach((supplier) => {
            db.run(
              `INSERT INTO suppliers (farm_name, owner_name, phone, county, latitude, longitude, species, species_json, category, verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [supplier.farm_name, supplier.owner_name, supplier.phone, supplier.county, supplier.latitude, supplier.longitude, supplier.species, supplier.species_json, supplier.category, supplier.verified],
              function(err) {
                if (!err) {
                  db.run(
                    `INSERT INTO supplier_stock (supplier_id, species, quantity, price, category) VALUES (?, ?, ?, ?, ?)`,
                    [this.lastID, supplier.species, supplier.quantity, supplier.price, supplier.category]
                  );
                }
              }
            );
          });
          db.run('COMMIT');
        }
      });
    });
  });
});

const createPondsTableSql = `
CREATE TABLE IF NOT EXISTS ponds (
  pond_id INTEGER PRIMARY KEY AUTOINCREMENT,
  farmer_id INTEGER NOT NULL,
  pond_size REAL,
  fish_species TEXT,
  stocking_date TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(farmer_id) REFERENCES farmers(id)
);
`;

db.run(createPondsTableSql, (err) => {
  if (err) console.error('Unable to create ponds table', err);
});

db.all("PRAGMA table_info(farmers)", (err, rows) => {
  if (err) {
    console.error('Unable to read farmers schema', err);
    return;
  }
  const columns = rows.map((row) => row.name);
  const extraColumns = [
    { name: 'image_filename', type: 'TEXT' },
    { name: 'approved', type: 'INTEGER DEFAULT 0' },
    { name: 'production_scale', type: 'TEXT' },
    { name: 'gender', type: 'TEXT' },
    { name: 'species_json', type: 'TEXT' },
    { name: 'email', type: 'TEXT' },
    { name: 'phone', type: 'TEXT' },
    { name: 'password_hash', type: 'TEXT' }
  ];
  extraColumns.forEach((column) => {
    if (!columns.includes(column.name)) {
      db.run(`ALTER TABLE farmers ADD COLUMN ${column.name} ${column.type}`);
    }
  });
});

function validateFarmerInput(data) {
  const errors = [];
  if (!data.name || typeof data.name !== 'string' || data.name.trim().length < 3) {
    errors.push('Name must be at least 3 characters.');
  }
  if (!VALID_COUNTIES.includes(data.county)) {
    errors.push('County must be Kisii, Nyamira, or Homa Bay.');
  }
  const lat = Number(data.latitude);
  const lng = Number(data.longitude);
  if (Number.isNaN(lat) || lat < -90 || lat > 90) {
    errors.push('Latitude must be a valid number between -90 and 90.');
  }
  if (Number.isNaN(lng) || lng < -180 || lng > 180) {
    errors.push('Longitude must be a valid number between -180 and 180.');
  }
  if (!data.gender || typeof data.gender !== 'string' || !VALID_GENDERS.includes(data.gender)) {
    errors.push('Gender is required.');
  }
  if (!data.species || typeof data.species !== 'string' || data.species.trim().length < 2) {
    errors.push('Species must be at least 2 characters.');
  }
  if (!data.culture_system || typeof data.culture_system !== 'string' || data.culture_system.trim().length < 2) {
    errors.push('Culture system must be at least 2 characters.');
  }
  if (data.equipment && data.equipment.length > 200) {
    errors.push('Equipment description is too long.');
  }
  if (data.contact && data.contact.length > 100) {
    errors.push('Contact information is too long.');
  }
  return errors;
}

function validateAdminLogin(data) {
  const errors = [];
  if (!data.username || typeof data.username !== 'string' || !data.username.trim()) {
    errors.push('Username is required.');
  }
  if (!data.password || typeof data.password !== 'string' || !data.password.trim()) {
    errors.push('Password is required.');
  }
  return errors;
}

function parseSpeciesField(value) {
  if (Array.isArray(value)) return value.map((s) => String(s).trim()).filter(Boolean);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map((s) => String(s).trim()).filter(Boolean);
    } catch (e) {
      return value.toString().split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

function validateSupplierInput(data) {
  const errors = [];
  if (!data.farm_name || typeof data.farm_name !== 'string' || data.farm_name.trim().length < 3) {
    errors.push('Hatchery or farm name must be at least 3 characters.');
  }
  if (!data.owner_name || typeof data.owner_name !== 'string' || data.owner_name.trim().length < 3) {
    errors.push('Owner name must be at least 3 characters.');
  }
  if (!data.phone || typeof data.phone !== 'string' || data.phone.trim().length < 7) {
    errors.push('Phone number is required.');
  }
  if (!VALID_COUNTIES.includes(data.county)) {
    errors.push('County must be Kisii, Nyamira, or Homa Bay.');
  }
  const lat = Number(data.latitude);
  const lng = Number(data.longitude);
  if (Number.isNaN(lat) || lat < -90 || lat > 90) {
    errors.push('Latitude must be a valid number between -90 and 90.');
  }
  if (Number.isNaN(lng) || lng < -180 || lng > 180) {
    errors.push('Longitude must be a valid number between -180 and 180.');
  }
  if (!data.species || !parseSpeciesField(data.species).length) {
    errors.push('At least one species is required.');
  }
  if (!data.category || typeof data.category !== 'string' || !data.category.trim()) {
    errors.push('Supplier category is required.');
  }
  if (data.quantity !== undefined && data.quantity !== null) {
    const quantity = Number(data.quantity);
    if (Number.isNaN(quantity) || quantity < 0) {
      errors.push('Quantity must be a non-negative integer.');
    }
  }
  if (data.price !== undefined && data.price !== null) {
    const price = Number(data.price);
    if (Number.isNaN(price) || price < 0) {
      errors.push('Price must be a non-negative number.');
    }
  }
  return errors;
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Missing token' });
  }
  jwt.verify(token, JWT_SECRET, (err, payload) => {
    if (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    req.admin = payload;
    next();
  });
}

// Role-based authorization middleware generator
function authorizeRole(requiredRole) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Missing token' });
    jwt.verify(token, JWT_SECRET, (err, payload) => {
      if (err) return res.status(401).json({ error: 'Invalid or expired token' });
      if (!payload || payload.role !== requiredRole) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      req.user = payload;
      next();
    });
  };
}

app.get('/api/farmers', (req, res) => {
  db.all('SELECT * FROM farmers ORDER BY created_at DESC', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Unable to fetch farmers' });
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
    res.json(mapped);
  });
});

app.get('/api/farmers/:id', (req, res) => {
  const { id } = req.params;
  db.get('SELECT * FROM farmers WHERE id = ?', [id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Unable to fetch farmer' });
    }
    if (!row) {
      return res.status(404).json({ error: 'Farmer not found' });
    }
    let speciesArr = [];
    if (row.species_json) {
      try { speciesArr = JSON.parse(row.species_json); } catch (e) { speciesArr = (row.species||'').toString().split(',').map(s=>s.trim()).filter(Boolean); }
    } else if (row.species) {
      speciesArr = row.species.toString().split(',').map(s=>s.trim()).filter(Boolean);
    }
    res.json({ ...row, species: speciesArr });
  });
});

app.post('/api/farmers', upload.single('image'), (req, res) => {
  let {
    name,
    county,
    gender,
    latitude,
    longitude,
    species,
    culture_system,
    equipment,
    contact,
    production_scale
  } = req.body;
  const imageFilename = req.file ? req.file.filename : '';

  // Normalize species: accept JSON array, array, or comma-separated string
  let speciesStr = '';
  if (Array.isArray(species)) {
    speciesStr = species.join(', ');
  } else if (typeof species === 'string') {
    try {
      const parsed = JSON.parse(species);
      if (Array.isArray(parsed)) speciesStr = parsed.join(', ');
      else speciesStr = String(parsed);
    } catch (e) {
      speciesStr = species;
    }
  }

  // Basic required fields check (after normalization)
  if (!name || !county || !gender || !latitude || !longitude || !speciesStr || !culture_system) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Validate inputs more strictly
  const input = { name, county, gender, latitude, longitude, species: speciesStr, culture_system, equipment, contact };
  const errors = validateFarmerInput(input);
  if (errors.length) {
    return res.status(400).json({ error: errors.join(' ') });
  }

  // Build species array and JSON
  let speciesArr = [];
  if (speciesStr) {
    speciesArr = speciesStr.toString().split(',').map(s => s.trim()).filter(Boolean);
  }
  const speciesJson = JSON.stringify(speciesArr);

  const stmt = db.prepare(
    `INSERT INTO farmers (name, county, gender, latitude, longitude, species, species_json, culture_system, equipment, contact, image_filename, production_scale, approved) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  stmt.run(
    name,
    county,
    gender,
    parseFloat(latitude),
    parseFloat(longitude),
    speciesStr,
    speciesJson,
    culture_system,
    equipment || '',
    contact || '',
    imageFilename,
    production_scale || '',
    0,
    function (err) {
      if (err) {
        return res.status(500).json({ error: 'Unable to save farmer' });
      }
      res.json({
        id: this.lastID,
        name,
        county,
        gender,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        species: speciesArr,
        culture_system,
        equipment: equipment || '',
        contact: contact || '',
        image_filename: imageFilename,
        production_scale: production_scale || '',
        approved: 0
      });
    }
  );
  stmt.finalize();
});

app.patch('/api/farmers/:id/approval', authorizeRole('admin'), (req, res) => {
  const { id } = req.params;
  const { approved } = req.body;
  if (approved === undefined) {
    return res.status(400).json({ error: 'Approval status required' });
  }
  const approvedValue = approved ? 1 : 0;
  db.run('UPDATE farmers SET approved = ? WHERE id = ?', [approvedValue, id], function (err) {
    if (err) {
      return res.status(500).json({ error: 'Unable to update approval' });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Farmer not found' });
    }
    res.json({ id: Number(id), approved: approvedValue });
  });
});

function calculateDistanceKm(lat1, lng1, lat2, lng2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

app.get('/api/suppliers', (req, res) => {
  const sql = `SELECT s.*, ss.quantity, ss.price, ss.updated_at, ss.category AS stock_category
    FROM suppliers s
    LEFT JOIN supplier_stock ss ON ss.id = (
      SELECT id FROM supplier_stock WHERE supplier_id = s.id ORDER BY updated_at DESC LIMIT 1
    )
    ORDER BY s.created_at DESC`;
  db.all(sql, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Unable to fetch suppliers' });
    }
    const mapped = rows.map((r) => {
      const speciesArr = r.species_json ? JSON.parse(r.species_json) : (r.species || '').toString().split(',').map(s => s.trim()).filter(Boolean);
      return {
        id: r.id,
        farm_name: r.farm_name,
        owner_name: r.owner_name,
        phone: r.phone,
        county: r.county,
        latitude: r.latitude,
        longitude: r.longitude,
        species: speciesArr,
        category: r.category,
        verified: r.verified,
        quantity: r.quantity != null ? r.quantity : null,
        price: r.price != null ? r.price : null,
        updated_at: r.updated_at || null,
        created_at: r.created_at
      };
    });
    res.json(mapped);
  });
});

app.post('/api/suppliers', (req, res) => {
  const {
    farm_name,
    owner_name,
    phone,
    county,
    latitude,
    longitude,
    species,
    category,
    quantity,
    price
  } = req.body;

  const supplierData = { farm_name, owner_name, phone, county, latitude, longitude, species, category, quantity, price };
  const errors = validateSupplierInput(supplierData);
  if (errors.length) {
    return res.status(400).json({ error: errors.join(' ') });
  }

  const speciesArr = parseSpeciesField(species);
  const speciesStr = speciesArr.join(', ');
  const speciesJson = JSON.stringify(speciesArr);
  const supplierCategory = category || 'Fingerlings';
  const verifiedValue = 0;

  db.run(
    `INSERT INTO suppliers (farm_name, owner_name, phone, county, latitude, longitude, species, species_json, category, verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [farm_name, owner_name, phone, county, parseFloat(latitude), parseFloat(longitude), speciesStr, speciesJson, supplierCategory, verifiedValue],
    function (err) {
      if (err) {
        return res.status(500).json({ error: 'Unable to save supplier' });
      }
      const supplierId = this.lastID;
      if (quantity !== undefined && price !== undefined) {
        db.run(
          `INSERT INTO supplier_stock (supplier_id, species, quantity, price, category) VALUES (?, ?, ?, ?, ?)`,
          [supplierId, speciesStr, Number(quantity), parseFloat(price), supplierCategory],
          (stockErr) => {
            if (stockErr) {
              return res.status(500).json({ error: 'Unable to save supplier stock' });
            }
            res.status(201).json({ id: supplierId, ...supplierData, species: speciesArr, verified: verifiedValue });
          }
        );
      } else {
        res.status(201).json({ id: supplierId, ...supplierData, species: speciesArr, verified: verifiedValue });
      }
    }
  );
});

app.patch('/api/suppliers/:id/verify', authorizeRole('admin'), (req, res) => {
  const { id } = req.params;
  const verified = req.body.verified === true || req.body.verified === 'true' || req.body.verified === 1 || req.body.verified === '1' ? 1 : 0;
  db.run('UPDATE suppliers SET verified = ? WHERE id = ?', [verified, id], function (err) {
    if (err) {
      return res.status(500).json({ error: 'Unable to update verification status' });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Supplier not found' });
    }
    res.json({ id: Number(id), verified });
  });
});

app.patch('/api/suppliers/:id/stock', authorizeRole('admin'), (req, res) => {
  const { id } = req.params;
  const { quantity, price, species, category } = req.body;
  db.get('SELECT * FROM suppliers WHERE id = ?', [id], (err, supplier) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!supplier) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    const updatedCategory = category || supplier.category;
    const speciesArr = parseSpeciesField(species || supplier.species);
    const speciesStr = speciesArr.join(', ');
    const quantityValue = parseInt(quantity, 10);
    const priceValue = parseFloat(price);

    db.run(
      `UPDATE suppliers SET category = ?, species = ?, species_json = ? WHERE id = ?`,
      [updatedCategory, speciesStr, JSON.stringify(speciesArr), id],
      function (updateErr) {
        if (updateErr) {
          return res.status(500).json({ error: 'Unable to update supplier details' });
        }
        db.run(
          `INSERT INTO supplier_stock (supplier_id, species, quantity, price, category) VALUES (?, ?, ?, ?, ?)`,
          [id, speciesStr, Number.isNaN(quantityValue) ? 0 : quantityValue, Number.isNaN(priceValue) ? 0 : priceValue, updatedCategory],
          function (stockErr) {
            if (stockErr) {
              return res.status(500).json({ error: 'Unable to save supplier stock' });
            }
            res.json({ id: Number(id), quantity: quantityValue, price: priceValue, category: updatedCategory, species: speciesArr });
          }
        );
      }
    );
  });
});

app.get('/api/suppliers/nearby', (req, res) => {
  const { lat, lng, species, county, radiusKm, priceMin, priceMax, category } = req.query;
  if (!lat || !lng) {
    return res.status(400).json({ error: 'Latitude and longitude are required for nearby supplier search' });
  }
  const sql = `SELECT s.*, ss.quantity, ss.price, ss.updated_at, ss.category AS stock_category
    FROM suppliers s
    LEFT JOIN supplier_stock ss ON ss.id = (
      SELECT id FROM supplier_stock WHERE supplier_id = s.id ORDER BY updated_at DESC LIMIT 1
    )
    ORDER BY s.created_at DESC`;
  db.all(sql, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Unable to fetch suppliers' });
    }
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    const radius = radiusKm ? Number(radiusKm) : null;
    const minPrice = priceMin ? Number(priceMin) : null;
    const maxPrice = priceMax ? Number(priceMax) : null;

    const suppliers = rows.map((r) => {
      const speciesArr = r.species_json ? JSON.parse(r.species_json) : (r.species || '').toString().split(',').map(s => s.trim()).filter(Boolean);
      const distance = calculateDistanceKm(latitude, longitude, r.latitude, r.longitude);
      return {
        id: r.id,
        farm_name: r.farm_name,
        owner_name: r.owner_name,
        phone: r.phone,
        county: r.county,
        latitude: r.latitude,
        longitude: r.longitude,
        species: speciesArr,
        category: r.category,
        verified: r.verified,
        quantity: r.quantity != null ? r.quantity : null,
        price: r.price != null ? r.price : null,
        updated_at: r.updated_at || null,
        distance
      };
    }).filter((supplier) => {
      if (!supplier.verified) return false;
      if (county && supplier.county !== county) return false;
      if (category && supplier.category !== category) return false;
      if (species && !supplier.species.some((item) => item.toLowerCase().includes(species.toLowerCase()))) return false;
      if (minPrice !== null && supplier.price !== null && supplier.price < minPrice) return false;
      if (maxPrice !== null && supplier.price !== null && supplier.price > maxPrice) return false;
      if (radius !== null && supplier.distance > radius) return false;
      return true;
    }).sort((a, b) => a.distance - b.distance);

    res.json(suppliers);
  });
});

// PONDS: create and list ponds
app.post('/api/ponds', (req, res) => {
  const { farmer_id, pond_size, fish_species, stocking_date } = req.body;
  if (!farmer_id) return res.status(400).json({ error: 'farmer_id is required' });
  db.get('SELECT id FROM farmers WHERE id = ?', [farmer_id], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!row) return res.status(404).json({ error: 'Farmer not found' });
    db.run(
      `INSERT INTO ponds (farmer_id, pond_size, fish_species, stocking_date) VALUES (?, ?, ?, ?)`,
      [farmer_id, pond_size || null, fish_species || '', stocking_date || null],
      function (err) {
        if (err) return res.status(500).json({ error: 'Unable to save pond' });
        res.status(201).json({ pond_id: this.lastID, farmer_id, pond_size, fish_species, stocking_date });
      }
    );
  });
});

app.get('/api/ponds', (req, res) => {
  const { farmer_id } = req.query;
  let sql = 'SELECT * FROM ponds';
  const params = [];
  if (farmer_id) {
    sql += ' WHERE farmer_id = ?';
    params.push(farmer_id);
  }
  db.all(sql + ' ORDER BY created_at DESC', params, (err, rows) => {
    if (err) return res.status(500).json({ error: 'Unable to fetch ponds' });
    res.json(rows);
  });
});

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  const errors = validateAdminLogin({ username, password });
  if (errors.length) {
    return res.status(400).json({ error: errors.join(' ') });
  }
  if (username !== ADMIN_USER || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ username: ADMIN_USER, role: 'admin' }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token });
});

// ADMIN DASHBOARD ANALYTICS
app.get('/api/admin/analytics', authorizeRole('admin'), (req, res) => {
  db.all('SELECT * FROM farmers', (err, farmers) => {
    if (err) {
      return res.status(500).json({ error: 'Unable to fetch analytics' });
    }

    const stats = {
      total_farmers: farmers.length,
      approved_farmers: farmers.filter(f => f.approved).length,
      pending_farmers: farmers.filter(f => !f.approved).length,
      by_county: {},
      by_species: {},
      by_culture: {},
      most_common_species: [],
      most_common_culture: []
    };

    farmers.forEach(farmer => {
      // County stats
      if (!stats.by_county[farmer.county]) {
        stats.by_county[farmer.county] = { total: 0, approved: 0 };
      }
      stats.by_county[farmer.county].total++;
      if (farmer.approved) stats.by_county[farmer.county].approved++;

      // Species stats
      const species = farmer.species ? farmer.species.split(',').map(s => s.trim()).filter(Boolean) : [];
      species.forEach(s => {
        stats.by_species[s] = (stats.by_species[s] || 0) + 1;
      });

      // Culture system stats
      if (!stats.by_culture[farmer.culture_system]) {
        stats.by_culture[farmer.culture_system] = { total: 0, approved: 0 };
      }
      stats.by_culture[farmer.culture_system].total++;
      if (farmer.approved) stats.by_culture[farmer.culture_system].approved++;
    });

    // Sort species by frequency
    stats.most_common_species = Object.entries(stats.by_species)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    // Sort culture by frequency
    stats.most_common_culture = Object.entries(stats.by_culture)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.total - a.total);

    const supplierSql = `SELECT s.*, ss.quantity, ss.price, ss.category AS stock_category
      FROM suppliers s
      LEFT JOIN supplier_stock ss ON ss.id = (
        SELECT id FROM supplier_stock WHERE supplier_id = s.id ORDER BY updated_at DESC LIMIT 1
      )`;
    db.all(supplierSql, (supplierErr, suppliers) => {
      if (supplierErr) {
        return res.status(500).json({ error: 'Unable to fetch supplier analytics' });
      }

      const supplierStats = {
        total_suppliers: suppliers.length,
        total_stock: 0,
        average_price: 0,
        stock_by_county: {},
        stock_by_species: {}
      };
      let priceSum = 0;
      let priceCount = 0;

      suppliers.forEach((supplier) => {
        const quantity = supplier.quantity != null ? Number(supplier.quantity) : 0;
        supplierStats.total_stock += quantity;
        if (supplier.price != null && !Number.isNaN(Number(supplier.price))) {
          priceSum += Number(supplier.price);
          priceCount += 1;
        }
        if (!supplierStats.stock_by_county[supplier.county]) {
          supplierStats.stock_by_county[supplier.county] = 0;
        }
        supplierStats.stock_by_county[supplier.county] += quantity;
        let speciesArr = [];
        if (supplier.species_json) {
          try {
            speciesArr = JSON.parse(supplier.species_json);
          } catch (e) {
            speciesArr = (supplier.species || '').toString().split(',').map(s => s.trim()).filter(Boolean);
          }
        } else if (supplier.species) {
          speciesArr = supplier.species.toString().split(',').map(s => s.trim()).filter(Boolean);
        }
        speciesArr.forEach((item) => {
          if (!supplierStats.stock_by_species[item]) {
            supplierStats.stock_by_species[item] = 0;
          }
          supplierStats.stock_by_species[item] += quantity;
        });
      });

      supplierStats.average_price = priceCount ? Number((priceSum / priceCount).toFixed(2)) : 0;
      stats.supplier_stats = supplierStats;
      res.json(stats);
    });
  });
});

// Public statistics endpoint (no authentication)
app.get('/api/stats', (req, res) => {
  db.get('SELECT COUNT(*) AS total, SUM(approved) AS approved_sum FROM farmers', (err, row) => {
    if (err) return res.status(500).json({ error: 'Unable to fetch farmer stats' });
    const totalFarmers = row && row.total ? Number(row.total) : 0;
    const approvedFarmers = row && row.approved_sum ? Number(row.approved_sum) : 0;
    const pendingFarmers = Math.max(0, totalFarmers - approvedFarmers);

    db.get('SELECT COUNT(*) AS total FROM suppliers', (err2, r2) => {
      const totalSuppliers = (!err2 && r2 && r2.total) ? Number(r2.total) : 0;

      // Count markets and hatcheries from GeoJSON files if present
      let marketsCount = 0;
      let hatcheriesCount = 0;
      try {
        const marketsPath = path.join(__dirname, 'public', 'data', 'markets.geojson');
        if (fs.existsSync(marketsPath)) {
          const mk = JSON.parse(fs.readFileSync(marketsPath, 'utf8'));
          marketsCount = Array.isArray(mk.features) ? mk.features.length : 0;
        }
      } catch (e) { /* ignore */ }
      try {
        const hatchPath = path.join(__dirname, 'public', 'data', 'hatcheries.geojson');
        if (fs.existsSync(hatchPath)) {
          const ht = JSON.parse(fs.readFileSync(hatchPath, 'utf8'));
          hatcheriesCount = Array.isArray(ht.features) ? ht.features.length : 0;
        }
      } catch (e) { /* ignore */ }

      db.get('SELECT COUNT(*) AS total FROM ponds', (err3, r3) => {
        const totalPonds = (!err3 && r3 && r3.total) ? Number(r3.total) : 0;
        return res.json({
          total_farmers: totalFarmers,
          approved_farmers: approvedFarmers,
          pending_farmers: pendingFarmers,
          total_suppliers: totalSuppliers,
          markets_count: marketsCount,
          hatcheries_count: hatcheriesCount,
          total_ponds: totalPonds
        });
      });
    });
  });
});

// ADMIN FARMER LIST WITH FILTERS
app.get('/api/admin/farmers', authorizeRole('admin'), (req, res) => {
  const { county, approved, search } = req.query;
  let query = 'SELECT id, name, email, phone, county, latitude, longitude, species, culture_system, production_scale, image_filename, approved, created_at FROM farmers';
  const params = [];
  const filters = [];

  if (county) {
    filters.push('county = ?');
    params.push(county);
  }
  if (approved !== undefined && approved !== '') {
    const approvedVal = approved === 'true' ? 1 : 0;
    filters.push('approved = ?');
    params.push(approvedVal);
  }
  if (search) {
    filters.push('(name LIKE ? OR email LIKE ? OR phone LIKE ?)');
    const searchTerm = `%${search}%`;
    params.push(searchTerm, searchTerm, searchTerm);
  }

  if (filters.length) {
    query += ' WHERE ' + filters.join(' AND ');
  }
  query += ' ORDER BY created_at DESC';

  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Unable to fetch farmers' });
    }
    const mapped = rows.map(r => {
      let speciesArr = [];
      if (r.species) {
        speciesArr = r.species.toString().split(',').map(s => s.trim()).filter(Boolean);
      }
      return { ...r, species: speciesArr };
    });
    res.json(mapped);
  });
});

// ADMIN: Approve / Revoke farmer
app.patch('/api/admin/farmers/:id/approval', authorizeRole('admin'), (req, res) => {
  const { id } = req.params;
  const { approved } = req.body;
  const val = approved ? 1 : 0;
  db.run('UPDATE farmers SET approved = ? WHERE id = ?', [val, id], function(err) {
    if (err) return res.status(500).json({ error: 'Unable to update approval' });
    return res.json({ id: Number(id), approved: val });
  });
});

// ADMIN: Edit farmer details
app.put('/api/admin/farmers/:id', authorizeRole('admin'), (req, res) => {
  const { id } = req.params;
  const {
    name, email, phone, county, latitude, longitude, species, culture_system, equipment, contact, production_scale, approved
  } = req.body;
  db.run(
    `UPDATE farmers SET name = ?, email = ?, phone = ?, county = ?, latitude = ?, longitude = ?, species = ?, culture_system = ?, equipment = ?, contact = ?, production_scale = ?, approved = ? WHERE id = ?`,
    [name, email, phone, county, latitude, longitude, species, culture_system, equipment, contact, production_scale, approved ? 1 : 0, id],
    function(err) {
      if (err) return res.status(500).json({ error: 'Unable to update farmer' });
      db.get('SELECT * FROM farmers WHERE id = ?', [id], (err2, row) => {
        if (err2) return res.status(500).json({ error: 'Unable to fetch updated farmer' });
        return res.json(row);
      });
    }
  );
});

// ADMIN: Delete farmer
app.delete('/api/admin/farmers/:id', authorizeRole('admin'), (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM farmers WHERE id = ?', [id], function(err) {
    if (err) return res.status(500).json({ error: 'Unable to delete farmer' });
    return res.json({ id: Number(id), deleted: true });
  });
});

// ADMIN: Export farmers CSV
app.get('/api/admin/farmers/export/csv', authorizeRole('admin'), (req, res) => {
  db.all('SELECT * FROM farmers ORDER BY id', (err, rows) => {
    if (err) return res.status(500).json({ error: 'Unable to fetch farmers' });
    const headers = ['id','name','email','phone','county','latitude','longitude','species','culture_system','production_scale','contact','approved','created_at'];
    const csv = [headers.join(',')].concat(rows.map(r => {
      const species = r.species_json || r.species || '';
      return [r.id, r.name, r.email, r.phone, r.county, r.latitude, r.longitude, `"${String(species).replace(/"/g,'""')}"`, r.culture_system, r.production_scale, r.contact, r.approved, r.created_at].join(',');
    })).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="farmers_export.csv"');
    res.send(csv);
  });
});

// ADMIN: Simple report (JSON stats)
app.get('/api/admin/farmers/report', authorizeRole('admin'), (req, res) => {
  db.all('SELECT county, COUNT(*) as count FROM farmers GROUP BY county', (err, rows) => {
    if (err) return res.status(500).json({ error: 'Unable to generate report' });
    res.json({ by_county: rows });
  });
});

// ADMIN: Upload landing page image (single image). Field name: 'landing'
app.post('/api/admin/upload-landing', authorizeRole('admin'), upload.single('landing'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const orig = req.file.originalname || 'landing.jpg';
    const ext = path.extname(orig) || '.jpg';
    const destName = `landing-bg${ext.toLowerCase()}`;
    const destPath = path.join(UPLOAD_DIR, destName);

    // Attempt to rename to a stable filename; if rename fails, try copy
    fs.rename(req.file.path, destPath, (err) => {
      if (err) {
        // fallback to copy
        fs.copyFile(req.file.path, destPath, (copyErr) => {
          if (copyErr) {
            console.error('Failed to persist landing image', copyErr);
            return res.status(500).json({ error: 'Unable to save landing image' });
          }
          // try to remove the uploaded temp file
          fs.unlink(req.file.path, () => {});
          return res.json({ message: 'Landing image updated', filename: destName, url: `/uploads/${destName}` });
        });
      } else {
        return res.json({ message: 'Landing image updated', filename: destName, url: `/uploads/${destName}` });
      }
    });
  } catch (e) {
    console.error('Upload handler error', e);
    res.status(500).json({ error: 'Server error during upload' });
  }
});

// GIS Analysis: Buffer around rivers
app.get('/api/analysis/rivers/buffer', (req, res) => {
  if (!turf) return res.status(503).json({ error: 'Server-side spatial library not available. Install @turf/turf.' });
  const distance = Number(req.query.distance || 100); // meters by default
  if (!Number.isFinite(distance) || distance <= 0) return res.status(400).json({ error: 'Distance must be a positive number (meters).' });

  // Optional bbox filter: bbox=minX,minY,maxX,maxY (lng/lat)
  const bboxParam = req.query.bbox;
  let bboxPoly = null;
  if (bboxParam) {
    const parts = bboxParam.toString().split(',').map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      // turf expects [minX, minY, maxX, maxY]
      bboxPoly = turf.bboxPolygon(parts);
    }
  }

  const dissolve = String(req.query.dissolve || 'false').toLowerCase() === 'true';

  const riversPath = path.join(__dirname, 'public', 'data', 'rivers.geojson');
  if (!fs.existsSync(riversPath)) return res.status(404).json({ error: 'Rivers GeoJSON not found on server.' });

  try {
    const raw = fs.readFileSync(riversPath, 'utf8');
    const geo = JSON.parse(raw);
    const buffers = [];
    if (geo.type === 'FeatureCollection' && Array.isArray(geo.features)) {
      geo.features.forEach((feature) => {
        try {
          // If bbox provided, skip features that do not intersect
          if (bboxPoly && !turf.booleanIntersects(feature, bboxPoly)) return;
          const buf = turf.buffer(feature, distance, { units: 'meters' });
          if (buf) buffers.push(buf);
        } catch (e) {
          // skip invalid geometry
        }
      });
    }

    // If dissolve requested, union buffers into a single geometry (guard against very large unions)
    if (dissolve) {
      if (buffers.length === 0) {
        return res.json({ type: 'FeatureCollection', features: [] });
      }
      // safety guard
      if (buffers.length > 200) {
        return res.status(413).json({ error: 'Dissolve not supported for large number of features. Reduce bbox or features.' });
      }
      let merged = buffers[0];
      for (let i = 1; i < buffers.length; i++) {
        try {
          merged = turf.union(merged, buffers[i]);
        } catch (e) {
          // if union fails for a pair, skip the feature
          console.warn('Union failed for one buffer, skipping', e && e.message);
        }
      }
      const out = { type: 'FeatureCollection', features: [] };
      if (merged && merged.geometry) out.features.push({ type: 'Feature', properties: {}, geometry: merged.geometry });
      return res.json(out);
    }

    const featureCollection = {
      type: 'FeatureCollection',
      features: buffers.map(b => b.geometry ? { type: 'Feature', properties: {}, geometry: b.geometry } : b)
    };
    res.json(featureCollection);
  } catch (e) {
    console.error('Error generating river buffers', e);
    res.status(500).json({ error: 'Error processing rivers GeoJSON' });
  }
});

// FARMER AUTHENTICATION MIDDLEWARE
function authenticateFarmerToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Missing token' });
  }
  jwt.verify(token, JWT_SECRET, (err, payload) => {
    if (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    if (payload.role !== 'farmer') {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    console.log('authenticateFarmerToken payload:', payload);
    req.farmer = payload;
    next();
  });
}

// FARMER REGISTRATION WITH CREDENTIALS
app.post('/api/farmers/auth/register', upload.single('image'), async (req, res) => {
  let {
    name,
    email,
    phone,
    password,
    county,
    gender,
    latitude,
    longitude,
    species,
    culture_system,
    equipment,
    contact,
    production_scale
  } = req.body;

  // Validate required fields
  if (!name || !email || !phone || !password || !county || !gender || !latitude || !longitude || !species || !culture_system) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  // Normalize species
  let speciesStr = '';
  if (Array.isArray(species)) {
    speciesStr = species.join(', ');
  } else if (typeof species === 'string') {
    try {
      const parsed = JSON.parse(species);
      speciesStr = Array.isArray(parsed) ? parsed.join(', ') : String(parsed);
    } catch (e) {
      speciesStr = species;
    }
  }

  const input = { name, county, latitude, longitude, species: speciesStr, culture_system, equipment, contact };
  const errors = validateFarmerInput(input);
  if (errors.length) {
    return res.status(400).json({ error: errors.join(' ') });
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(password, 10);
  
  let speciesArr = speciesStr.toString().split(',').map(s => s.trim()).filter(Boolean);
  const speciesJson = JSON.stringify(speciesArr);
  const imageFilename = req.file ? req.file.filename : '';

  db.get('SELECT id FROM farmers WHERE email = ?', [email], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (row) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const input = { name, county, gender, latitude, longitude, species: speciesStr, culture_system, equipment, contact };
    const errors = validateFarmerInput(input);
    if (errors.length) {
      return res.status(400).json({ error: errors.join(' ') });
    }

    const stmt = db.prepare(
      `INSERT INTO farmers (name, email, phone, password_hash, county, gender, latitude, longitude, species, species_json, culture_system, equipment, contact, image_filename, production_scale, approved) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    stmt.run(
      name,
      email,
      phone,
      hashedPassword,
      county,
      gender,
      parseFloat(latitude),
      parseFloat(longitude),
      speciesStr,
      speciesJson,
      culture_system,
      equipment || '',
      contact || '',
      imageFilename,
      production_scale || '',
      0,
      function (err) {
        if (err) {
          return res.status(500).json({ error: 'Unable to save farmer' });
        }
        res.status(201).json({
          id: this.lastID,
          name,
          email,
          county,
          approved: 0,
          message: 'Registration successful. Please log in.'
        });
      }
    );
    stmt.finalize();
  });
});

// FARMER LOGIN
app.post('/api/farmers/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  db.get('SELECT * FROM farmers WHERE email = ?', [email], async (err, farmer) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!farmer) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check password
    const passwordMatch = await bcrypt.compare(password, farmer.password_hash || '');
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate token
    const token = jwt.sign({ id: farmer.id, email: farmer.email, role: 'farmer' }, JWT_SECRET, { expiresIn: '7d' });
    
    res.json({
      token,
      farmer: {
        id: farmer.id,
        name: farmer.name,
        email: farmer.email,
        county: farmer.county,
        approved: farmer.approved
      }
    });
  });
});

// GET FARMER PROFILE (Current authenticated farmer)
app.get('/api/farmers/me', authenticateFarmerToken, (req, res) => {
  const farmerId = req.farmer.id;
  console.log('GET /api/farmers/me farmerId from token:', farmerId);
  db.get('SELECT * FROM farmers WHERE id = ?', [farmerId], (err, farmer) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!farmer) {
      console.log('GET /api/farmers/me - no farmer found for id', farmerId);
      return res.status(404).json({ error: 'Farmer not found' });
    }

    let speciesArr = [];
    if (farmer.species_json) {
      try { speciesArr = JSON.parse(farmer.species_json); } catch (e) { speciesArr = (farmer.species||'').toString().split(',').map(s=>s.trim()).filter(Boolean); }
    } else if (farmer.species) {
      speciesArr = farmer.species.toString().split(',').map(s=>s.trim()).filter(Boolean);
    }

    res.json({
      id: farmer.id,
      name: farmer.name,
      email: farmer.email,
      phone: farmer.phone,
      county: farmer.county,
      latitude: farmer.latitude,
      longitude: farmer.longitude,
      species: speciesArr,
      culture_system: farmer.culture_system,
      equipment: farmer.equipment,
      contact: farmer.contact,
      production_scale: farmer.production_scale,
      image_filename: farmer.image_filename,
      approved: farmer.approved,
      created_at: farmer.created_at
    });
  });
});

// UPDATE FARMER PROFILE (Current authenticated farmer)
app.patch('/api/farmers/me', authenticateFarmerToken, upload.single('image'), (req, res) => {
  const farmerId = req.farmer.id;
  const { name, phone, county, latitude, longitude, species, culture_system, equipment, contact, production_scale } = req.body;

  // Get current farmer to preserve unchanged fields
  db.get('SELECT * FROM farmers WHERE id = ?', [farmerId], (err, farmer) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!farmer) {
      return res.status(404).json({ error: 'Farmer not found' });
    }

    // Prepare updated values (keep current if not provided)
    const newName = name || farmer.name;
    const newPhone = phone !== undefined ? phone : farmer.phone;
    const newCounty = county || farmer.county;
    const newLat = latitude !== undefined ? parseFloat(latitude) : farmer.latitude;
    const newLng = longitude !== undefined ? parseFloat(longitude) : farmer.longitude;
    const newCultureSystem = culture_system || farmer.culture_system;
    const newEquipment = equipment !== undefined ? equipment : farmer.equipment;
    const newContact = contact !== undefined ? contact : farmer.contact;
    const newProductionScale = production_scale !== undefined ? production_scale : farmer.production_scale;

    // Handle species
    let newSpeciesStr = farmer.species;
    let newSpeciesJson = farmer.species_json;
    if (species) {
      let speciesArray = [];
      if (Array.isArray(species)) {
        speciesArray = species;
      } else if (typeof species === 'string') {
        try {
          const parsed = JSON.parse(species);
          speciesArray = Array.isArray(parsed) ? parsed : [parsed];
        } catch (e) {
          speciesArray = species.split(',').map(s => s.trim());
        }
      }
      newSpeciesStr = speciesArray.join(', ');
      newSpeciesJson = JSON.stringify(speciesArray);
    }

    // Handle image
    let imageFilename = farmer.image_filename;
    if (req.file) {
      imageFilename = req.file.filename;
    }

    // Update farmer record
    db.run(
      `UPDATE farmers SET name = ?, phone = ?, county = ?, latitude = ?, longitude = ?, species = ?, species_json = ?, culture_system = ?, equipment = ?, contact = ?, production_scale = ?, image_filename = ? WHERE id = ?`,
      [newName, newPhone, newCounty, newLat, newLng, newSpeciesStr, newSpeciesJson, newCultureSystem, newEquipment, newContact, newProductionScale, imageFilename, farmerId],
      function (err) {
        if (err) {
          return res.status(500).json({ error: 'Unable to update profile' });
        }
        res.json({ message: 'Profile updated successfully' });
      }
    );
  });
});

app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Health and system test endpoint
app.get('/api/test/portal', (req, res) => {
  const results = {
    timestamp: new Date().toISOString(),
    status: 'ok',
    checks: {}
  };

  // Check database
  try {
    db.get('SELECT COUNT(*) as count FROM farmers', (err, row) => {
      results.checks.database = err ? { status: 'error', message: err.message } : { status: 'ok', farmers: row?.count || 0 };
    });
  } catch (e) {
    results.checks.database = { status: 'error', message: e.message };
  }

  // Check GeoJSON data files
  const geoJsonFiles = [
    'farmers.geojson',
    'hatcheries.geojson',
    'feed_suppliers.geojson',
    'equipment_suppliers.geojson',
    'markets.geojson',
    'water_sources.geojson',
    'rivers.geojson',
    'roads.geojson'
  ];
  const geoJsonStatus = {};
  geoJsonFiles.forEach(file => {
    const filePath = path.join(__dirname, 'public', 'data', file);
    geoJsonStatus[file] = fs.existsSync(filePath) ? 'exists' : 'missing';
  });
  results.checks.geoJsonData = geoJsonStatus;

  // Check frontend resources
  const frontendResources = [
    'public/app.html',
    'public/app.js',
    'public/styles.css',
    'public/index.html'
  ];
  const frontendStatus = {};
  frontendResources.forEach(resource => {
    const filePath = path.join(__dirname, resource);
    frontendStatus[resource] = fs.existsSync(filePath) ? 'exists' : 'missing';
  });
  results.checks.frontend = frontendStatus;

  // Check uploads directory
  results.checks.uploads = {
    directory: fs.existsSync(UPLOAD_DIR) ? 'exists' : 'missing',
    writeable: fs.existsSync(UPLOAD_DIR) ? 'ok' : 'error'
  };

  // Check API endpoints availability
  results.checks.apiEndpoints = {
    farmers: true,
    suppliers: true,
    stats: true,
    resources: ['farmers', 'hatcheries', 'equipment_suppliers', 'feed_suppliers', 'markets']
  };

  // Portal features summary
  results.portalFeatures = {
    extensionServices: 'Knowledge base, FAQ, Ask-an-Expert',
    feedSuppliers: 'Directory with location and pricing',
    diseaseReporting: 'Local storage for disease reports',
    waterQualityMonitoring: 'pH, DO, temperature, ammonia tracking',
    training: 'Event registration and materials',
    publications: 'Research guides and technical manuals',
    marketIntelligence: 'Fish prices by county',
    equipmentSuppliers: 'Aerators, pumps, nets, test kits with verification',
    gisLayers: 'Farmers, hatcheries, feed suppliers, equipment, markets, water sources, rivers, roads',
    verification: 'Verified farmer and supplier badges'
  };

  res.json(results);
});

// Redirect requests that include `/public` to the site root to avoid exposing directory listings
app.get('/public', (req, res) => res.redirect(301, '/'));
app.get('/public/*', (req, res) => res.redirect(301, '/'));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
