# KMFRI-GIS

Lightweight Node/Express map app for registering and viewing farmers with geo-located pins.

Getting started

1. Install Node.js (16+ recommended) and Git for Windows.
2. From the project root (`C:\Users\Yohana\Desktop\kmfri\project`) run:

```powershell
npm install
node server.js
# open http://localhost:3000 in your browser
```

Notes
- Database: local SQLite file (excluded from git via `.gitignore`).
- Uploaded images are stored in `public/uploads/` (excluded from git).
- The server will auto-add missing columns (e.g. `gender`) on startup.

Suggested commit message

```
Add map pins, enhanced popups, and gender field; add .gitignore and README
```

If you'd like, I can also create a minimal `LICENSE` file and a `CONTRIBUTING.md`.# Fish Farmers Map

A simple live mapping and registration system for fish farmers in Kisii, Nyamira, and Homa Bay.

## Features

- Interactive Leaflet map with farmer location markers
- OpenStreetMap tiles for map rendering
- Farmer registration form with farm location coordinates
- Admin login and approval workflow using JWT
- Farmer data stored locally in SQLite
- Image upload support for farmer profiles
- CSV export of registered farmer data
- County filtering and detail view for each farmer
- Equipment marketplace for nets, aerators, tanks, pumps, and feeders with county filters and seller contact
 - Supplier marketplace for fingerlings, feeds, equipment, and harvest fish with verified suppliers, distance filters, and contact tools

## Requirements

- Node.js 18+ (or compatible LTS)
- npm

## Installation

1. Open a terminal in the `project` folder
2. Install dependencies:

```bash
npm install
```

3. Create optional environment variables if you want to override defaults:

- `ADMIN_USER` (default: `admin`)
- `ADMIN_PASSWORD` (default: `password123`)
- `JWT_SECRET` (default: `change-this-secret`)

4. Start the server:

```bash
npm start
```

5. Open the application in your browser:

```text
http://localhost:3000
```

## Usage

- Register a farmer using the form on the page
- Click the map to fill latitude and longitude automatically
- Use the small registration map to pick a location or use device geolocation
- See registered farmers appear on the main map and in the farmer list
- Click markers or list items to view farmer details and approval status
- Admin users can log in and approve or revoke farmer approvals
- Export filtered farmer data as CSV using the `Download farmer data` button

## Project structure

- `server.js` — Express backend and SQLite database setup
- `public/index.html` — front-end HTML page
- `public/app.js` — client-side application logic
- `public/styles.css` — styling for the site
- `public/uploads/` — uploaded farmer images

## Notes

- The app runs locally and is suitable for development or quick demos
- The project can be extended with production deployment, authentication improvements, and a hosted database
- If Leaflet resources fail to load from the CDN, ensure the page includes correct script and stylesheet URLs without invalid integrity hashes
