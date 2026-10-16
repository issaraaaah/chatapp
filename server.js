const http = require("http");
const fs = require("fs");
const path = require("path");
const { randomInt } = require("crypto");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "public");
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript" };
const HISTORY_MAX = 50;
const history = []; // historique des messages texte (perdu au redémarrage)
const AUDIO_RE = /^data:audio\/[a-z0-9.+-]+(;[a-z0-9=.+-]+)*;base64,/i;
const AUDIO_MAX = 1500000; // taille maximale d'un vocal (caractères base64)

// ---------- Jeux ----------
const games = new Map(); // parties en mémoire
let gameSeq = 0;
const GAMES_MAX = 50;
const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
const BEATS = { pierre: "ciseaux", feuille: "pierre", ciseaux: "feuille" };

// Ce que les clients ont le droit de voir (les choix pierre/feuille/ciseaux restent secrets)
const view = (g) => ({
  id: g.id, kind: g.kind, players: g.players, status: g.status,
  winner: g.winner, board: g.board, turn: g.turn, line: g.line,
  picked: g.choices ? g.choices.map((c) => c !== null) : undefined,
  choices: g.status === "done" && g.choices ? g.choices : undefined,
});

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

// Serveur WebSocket attaché au même port (messages limités à 2 Mo)
const wss = new WebSocketServer({ server, maxPayload: 2 * 1024 * 1024 });

const send = (ws, data) => ws.readyState === 1 && ws.send(JSON.stringify(data));
// broadcast envoie à tous les utilisateurs connectés (sauf `except` si fourni)
const broadcast = (data, except) =>
  wss.clients.forEach((c) => c !== except && c.name && send(c, data));
const userList = () => [...wss.clients].filter((c) => c.name).map((c) => c.name);

function postMessage(name, text) {
  const m = { type: "message", name, text, time: Date.now() };
  history.push(m);
  if (history.length > HISTORY_MAX) history.shift();
  broadcast(m);
}

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
      const open = [...games.values()].filter((g) => g.status !== "done").map(view);
      send(ws, { type: "joined", name, history, games: open });
      broadcast({ type: "system", text: `${name} a rejoint le chat` }, ws);
      broadcast({ type: "users", users: userList() });
      return;
    }

    if (!ws.name) return; // il faut d'abord rejoindre

    if (msg.type === "message") {
      const text = String(msg.text || "").trim().slice(0, 1000);
      const now = Date.now();
      if (!text || now - ws.lastMsg < 300) return; // anti-spam simple
      ws.lastMsg = now;
      postMessage(ws.name, text);
    }

    if (msg.type === "voice") {
      const audio = String(msg.audio || "");
      const now = Date.now();
      if (!AUDIO_RE.test(audio) || audio.length > AUDIO_MAX || now - ws.lastMsg < 300) return;
      ws.lastMsg = now;
      // Les vocaux ne sont pas gardés dans l'historique (trop lourds pour la mémoire)
      broadcast({ type: "voice", name: ws.name, audio, time: now });
    }

    // Dé et pile ou face : résultat tiré par le serveur
    if (msg.type === "quick") {
      const now = Date.now();
      if (now - ws.lastMsg < 300) return;
      if (msg.kind === "dice") postMessage(ws.name, `🎲 Dé : ${randomInt(1, 7)}`);
      else if (msg.kind === "coin") postMessage(ws.name, `🪙 Pile ou face : ${randomInt(2) ? "Pile" : "Face"}`);
      else return;
      ws.lastMsg = now;
    }

    // Nouvelle partie
    if (msg.type === "game_new") {
      const now = Date.now();
      if (!["ttt", "rps"].includes(msg.kind) || now - ws.lastMsg < 300) return;
      ws.lastMsg = now;
      const g = { id: ++gameSeq, kind: msg.kind, players: [ws.name, null], status: "waiting", winner: null };
      if (g.kind === "ttt") { g.board = Array(9).fill(null); g.turn = 0; g.line = null; }
      else g.choices = [null, null];
      games.set(g.id, g);
      if (games.size > GAMES_MAX) games.delete(games.keys().next().value);
      broadcast({ type: "game", game: view(g) });
    }

    // Rejoindre une partie
    if (msg.type === "game_join") {
      const g = games.get(msg.id);
      if (!g || g.status !== "waiting" || g.players[0] === ws.name) return;
      g.players[1] = ws.name;
      g.status = "playing";
      broadcast({ type: "game", game: view(g) });
    }

    // Jouer un coup
    if (msg.type === "game_move") {
      const g = games.get(msg.id);
      if (!g || g.status !== "playing") return;
      const i = g.players.indexOf(ws.name);
      if (i < 0) return;

      if (g.kind === "ttt") {
        const c = msg.move;
        if (g.turn !== i || !Number.isInteger(c) || c < 0 || c > 8 || g.board[c]) return;
            g.board[c] = i === 0 ? "X" : "O";
                    const line = LINES.find(([a, b, d]) => g.board[a] && g.board[a] === g.board[b] && g.board[a] === g.board[d]);
        if (line) { g.status = "done"; g.winner = ws.name; g.line = line; }
        else if (g.board.every(Boolean)) { g.status = "done"; g.winner = "draw"; }
        else g.turn = 1 - g.turn;
      } else {
        if (!Object.hasOwn(BEATS, msg.move) || g.choices[i] !== null) return;
        g.choices[i] = msg.move;
        if (g.choices[0] && g.choices[1]) {
          const [a, b] = g.choices;
          g.status = "done";
          g.winner = a === b ? "draw" : BEATS[a] === b ? g.players[0] : g.players[1];
        }
      }
      broadcast({ type: "game", game: view(g) });
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