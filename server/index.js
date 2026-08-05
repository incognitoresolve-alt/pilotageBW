import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "data.json");
const DIST_DIR = path.join(__dirname, "..", "dist");
const PORT = process.env.PORT || 4000;

function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

const app = express();
app.use(express.json());

// Stockage clé/valeur partagé entre tous les utilisateurs (membres, ventes, chiffres).
app.get("/api/storage/:key", (req, res) => {
  const data = readData();
  const value = data[req.params.key];
  if (value === undefined) return res.status(404).end();
  res.json({ value });
});

app.put("/api/storage/:key", (req, res) => {
  const data = readData();
  data[req.params.key] = req.body.value;
  writeData(data);
  res.status(204).end();
});

if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get("*", (req, res) => {
    res.sendFile(path.join(DIST_DIR, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`Backend Suivi Commercial en écoute sur http://localhost:${PORT}`);
});
