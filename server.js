'use strict';

const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 3333;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css' : 'text/css',
  '.js'  : 'application/javascript',
  '.ico' : 'image/x-icon',
};

// ── Static file server ────────────────────────────────────────────────────────
const httpServer = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(ROOT, urlPath);

  // Security: prevent directory traversal
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext  = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

// ── WebSocket relay ───────────────────────────────────────────────────────────
//
// Rooms: each room holds 2 slots.
//   slots[0] → host (first to connect to the room)
//   slots[1] → guest
//
// URL: ws://<host>:<port>/?room=<name>   (default room: "default")
//

const wss = new WebSocketServer({ server: httpServer });

/** @type {Map<string, Array<WebSocket|null>>} */
const rooms = new Map();

wss.on('connection', (ws, req) => {
  const params   = new URLSearchParams(req.url.replace(/^[^?]*\?/, ''));
  const roomName = params.get('room') || 'default';

  if (!rooms.has(roomName)) rooms.set(roomName, [null, null]);
  const slots = rooms.get(roomName);

  // Find an open slot
  const idx = slots[0] === null ? 0 : (slots[1] === null ? 1 : -1);
  if (idx === -1) {
    ws.send(JSON.stringify({ type: 'error', msg: 'Room is full' }));
    ws.close();
    return;
  }

  slots[idx] = ws;
  ws._idx  = idx;
  ws._room = roomName;

  if (idx === 0) {
    // First player — wait for opponent
    ws.send(JSON.stringify({ type: 'waiting' }));
  } else {
    // Second player — both sides get their roles and the game starts
    slots[0].send(JSON.stringify({ type: 'role', role: 'host'  }));
    slots[1].send(JSON.stringify({ type: 'role', role: 'guest' }));
  }

  // Relay: forward every message to the peer
  ws.on('message', (raw) => {
    const peer = slots[1 - ws._idx];
    if (peer && peer.readyState === 1 /* OPEN */) peer.send(raw);
  });

  ws.on('close', () => {
    const s = rooms.get(ws._room);
    if (!s) return;
    s[ws._idx] = null;

    const peer = s[1 - ws._idx];
    if (peer && peer.readyState === 1) {
      peer.send(JSON.stringify({ type: 'peer_left' }));
    }

    // Clean up empty rooms
    if (!s[0] && !s[1]) rooms.delete(ws._room);
  });

  ws.on('error', () => ws.close());
});

// ── Start ─────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log('\n⚔️  Clash Royale LAN Server\n');
  console.log(`  This device  →  http://localhost:${PORT}`);

  // Print all non-loopback IPv4 addresses
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) {
        console.log(`  Other device →  http://${iface.address}:${PORT}`);
      }
    }
  }
  console.log('\nBoth players open the same URL and click "Jogar LAN".\n');
});
