# Contributing

Thanks for your interest in improving this project. A short guide to contribute:

- Fork the repository on GitHub.
- Create a feature branch: `git checkout -b feature/your-change`.
- Make changes and keep commits focused and atomic.
- Run the app locally and verify your changes:

```powershell
npm install
node server.js
# Open http://localhost:3000
```

- When ready, push your branch and open a Pull Request describing your changes.
- For security, do not commit secrets or database files; they are excluded via `.gitignore`.

If you're unsure about an API change or schema migration, open an issue first to discuss.