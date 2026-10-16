const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "public");
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript" };
const HISTORY_MAX = 50;
const history = []; // historique en mémoire (perdu au redémarrage)

// Serveur HTTP : sert les fichiers du dossier public/
const server = http.createServer((req, res) => {
  const url = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const file = path.normalize(path.join(PUBLIC, url));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Introuvable"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "text/plain" });
    res.end(data);
  });
});

// Serveur WebSocket attaché au même port
const wss = new WebSocketServer({ server });

const send = (ws, data) => ws.readyState === 1 && ws.send(JSON.stringify(data));
const broadcast = (data, except) =>
  wss.clients.forEach((c) => c !== except && c.name && send(c, data));
const userList = () => [...wss.clients].filter((c) => c.name).map((c) => c.name);

wss.on("connection", (ws) => {
  ws.name = null;
  ws.lastMsg = 0;

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === "join") {
      const name = String(msg.name || "").trim().slice(0, 20);
      if (!name) return send(ws, { type: "error", text: "Entrez un pseudo." });
      if (userList().some((n) => n.toLowerCase() === name.toLowerCase()))
        return send(ws, { type: "error", text: "Ce pseudo est déjà utilisé." });
      ws.name = name;
      send(ws, { type: "joined", name, history });
      broadcast({ type: "system", text: `${name} a rejoint le chat` }, ws);
      broadcast({ type: "users", users: userList() });
      send(ws, { type: "users", users: userList() });
      return;
    }

    if (!ws.name) return; // il faut d'abord rejoindre

    if (msg.type === "message") {
      const text = String(msg.text || "").trim().slice(0, 1000);
      const now = Date.now();
      if (!text || now - ws.lastMsg < 300) return; // anti-spam simple
      ws.lastMsg = now;
      const m = { type: "message", name: ws.name, text, time: now };
      history.push(m);
      if (history.length > HISTORY_MAX) history.shift();
      broadcast(m);
      send(ws, m);
    }

    if (msg.type === "typing") broadcast({ type: "typing", name: ws.name }, ws);
  });

  ws.on("close", () => {
    if (!ws.name) return;
    broadcast({ type: "system", text: `${ws.name} a quitté le chat` });
    broadcast({ type: "users", users: userList() });
  });
});

server.listen(PORT, () => console.log(`Chat disponible sur http://localhost:${PORT}`));
