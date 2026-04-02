'use strict';

// window.myTeam is read by isMine() in entities.js
// 'player' → solo / host  |  'enemy' → guest
window.myTeam = 'player';

// ─── Lobby ────────────────────────────────────────────────────────────────────

function initLobby() {
  document.getElementById('btn-solo').addEventListener('click', () => {
    _hideLobby();
    new Game('solo', null);
  });

  document.getElementById('btn-lan').addEventListener('click', () => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url      = `${protocol}//${location.host}`;
    _connectWS(url);
  });

  document.getElementById('restart-btn').addEventListener('click', () => location.reload());
}

function _connectWS(url) {
  _setLobbyStatus(`Conectando a ${url}…`);

  const ws = new WebSocket(url);

  ws.addEventListener('open', () => {
    _setLobbyStatus('Aguardando adversário…');
  });

  ws.addEventListener('error', () => {
    _setLobbyStatus('Servidor não encontrado. Iniciando solo…');
    setTimeout(() => { _hideLobby(); new Game('solo', null); }, 1600);
  });

  ws.addEventListener('message', e => {
    const msg = JSON.parse(e.data);

    if (msg.type === 'waiting') {
      _setLobbyStatus('Aguardando adversário…');

    } else if (msg.type === 'role') {
      const role = msg.role; // 'host' or 'guest'
      window.myTeam = role === 'guest' ? 'enemy' : 'player';
      _setLobbyStatus(role === 'host' ? 'Você é o Anfitrião — iniciando…' : 'Você é o Convidado — iniciando…');
      setTimeout(() => {
        _hideLobby();
        new Game(role, ws);
      }, 600);

    } else if (msg.type === 'error') {
      _setLobbyStatus(`Erro: ${msg.msg}`);
    }
  });

  ws.addEventListener('close', () => {
    // Only matters if we never left the lobby
    if (!document.getElementById('lobby').classList.contains('hidden')) {
      _setLobbyStatus('Conexão encerrada. Tente novamente.');
    }
  });
}

function _setLobbyStatus(text) {
  document.getElementById('lobby-status').textContent = text;
}
function _hideLobby() {
  document.getElementById('lobby').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
}

// ─── Solo AI ──────────────────────────────────────────────────────────────────
class AI {
  constructor(game) {
    this.game  = game;
    this.queue = shuffle([...DEFAULT_DECK]);
    this.timer = randBetween(3, 7);
  }

  update(dt) {
    this.timer -= dt;
    if (this.timer > 0) return;

    const cardKey = this.queue[0];
    const card    = CARDS[cardKey];

    if (this.game.enemyElixir >= card.cost) {
      const x = randBetween(50, C.W - 50);
      const y = randBetween(20, C.RIVER_Y - 20);
      this.game.deployCard(cardKey, x, y, 'enemy');
      this.queue.shift();
      this.queue.push(cardKey);
    }

    this.timer = randBetween(2.5, 6.5);
  }
}

// ─── Network Guest Handler (runs on host) ─────────────────────────────────────
class NetworkGuestHandler {
  constructor(game, ws) {
    this.game  = game;
    this.ws    = ws;
    this._queue = [];

    ws.addEventListener('message', e => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'deploy') this._queue.push(msg);
        if (msg.type === 'peer_left') {
          if (!game.gameOver) game._endGame('win'); // guest left → host wins
        }
      } catch {}
    });

    ws.addEventListener('close', () => {
      if (!game.gameOver) game._endGame('win');
    });
  }

  processIncoming() {
    for (const msg of this._queue) {
      const card = CARDS[msg.cardKey];
      if (!card || this.game.enemyElixir < card.cost) continue;
      // x/y are already in server coordinates (guest transformed them)
      // Validate: guest's territory is y < C.RIVER_Y (or anywhere for spells)
      if (card.type !== 'spell' && msg.y >= C.RIVER_Y) continue;
      this.game.deployCard(msg.cardKey, msg.x, msg.y, 'enemy');
    }
    this._queue = [];
  }

  sendState() {
    if (!this.ws || this.ws.readyState !== 1 /* OPEN */) return;
    const g = this.game;

    this.ws.send(JSON.stringify({
      type:         'state',
      timeLeft:     g.timeLeft,
      overtime:     g.overtime,
      enemyElixir:  g.enemyElixir,       // guest's elixir (they're 'enemy')
      towers: {
        p_king:  g.pTowers.king.serialize(),
        p_left:  g.pTowers.left.serialize(),
        p_right: g.pTowers.right.serialize(),
        e_king:  g.eTowers.king.serialize(),
        e_left:  g.eTowers.left.serialize(),
        e_right: g.eTowers.right.serialize(),
      },
      troops:      g.troops.filter(t => t.alive).map(t => t.serialize()),
      projectiles: g.projectiles.filter(p => p.alive).map(p => p.serialize()),
      effects:     g.effects.filter(e => e.alive).map(e => e.serialize()),
      crowns: { p: g._crowns('enemy'), e: g._crowns('player') },
      gameOver:    g.gameOver,
      result:      g.result, // 'win'|'lose' from host's POV
    }));
  }
}

// ─── Main Game Class ──────────────────────────────────────────────────────────
class Game {
  constructor(mode, ws) {
    this.mode = mode; // 'solo' | 'host' | 'guest'
    this.ws   = ws;

    this.canvas = document.getElementById('gameCanvas');
    this.ctx    = this.canvas.getContext('2d');
    this.mouseX = 0;
    this.mouseY = 0;
    this.selectedCard = null;
    this.gameOver     = false;
    this.result       = null;

    this._bindEvents();

    if (mode === 'guest') {
      this._initGuest();
    } else {
      this.start();
    }
  }

  // ── Solo / Host initialization ─────────────────────────────────────────────
  start() {
    this.gameOver     = false;
    this.result       = null;
    this.selectedCard = null;
    this.playerElixir = 5;
    this.enemyElixir  = 5;
    this.timeLeft     = C.GAME_DURATION;
    this.overtime     = false;
    this.lastTs       = null;

    this.pTowers = {
      king:  new Tower(C.P_KING,  'player'),
      left:  new Tower(C.P_LEFT,  'player'),
      right: new Tower(C.P_RIGHT, 'player'),
    };
    this.eTowers = {
      king:  new Tower(C.E_KING,  'enemy'),
      left:  new Tower(C.E_LEFT,  'enemy'),
      right: new Tower(C.E_RIGHT, 'enemy'),
    };

    this.troops      = [];
    this.projectiles = [];
    this.effects     = [];

    this.playerQueue = shuffle([...DEFAULT_DECK]);

    if (this.mode === 'host') {
      this.netGuest = new NetworkGuestHandler(this, this.ws);
    } else {
      this.ai = new AI(this);
    }

    document.getElementById('game-over').classList.add('hidden');
    this.renderCards();
    requestAnimationFrame(ts => this._loop(ts));
  }

  // ── Guest initialization ───────────────────────────────────────────────────
  _initGuest() {
    this.guestState   = null;
    this.playerElixir = 5;
    this.playerQueue  = shuffle([...DEFAULT_DECK]);
    this.selectedCard = null;
    this.timeLeft     = C.GAME_DURATION;
    this.overtime     = false;

    document.getElementById('game-over').classList.add('hidden');
    this.renderCards();

    this.ws.addEventListener('message', e => {
      try { this._onGuestMessage(JSON.parse(e.data)); } catch {}
    });
    this.ws.addEventListener('close', () => {
      if (!this.gameOver) {
        document.getElementById('result-text').textContent  = '🔌 Desconectado';
        document.getElementById('result-text').style.color  = '#e67e22';
        document.getElementById('result-crowns').textContent = '';
        document.getElementById('game-over').classList.remove('hidden');
        this.gameOver = true;
      }
    });

    requestAnimationFrame(ts => this._guestLoop(ts));
  }

  _onGuestMessage(msg) {
    if (msg.type !== 'state') return;

    this.guestState   = msg;
    this.playerElixir = msg.enemyElixir;
    this.timeLeft     = msg.timeLeft;
    this.overtime     = msg.overtime;

    // HUD
    const pct = this.playerElixir / C.MAX_ELIXIR;
    document.getElementById('elixir-fill').style.width    = `${pct * 100}%`;
    document.getElementById('elixir-count').textContent   = Math.floor(this.playerElixir);
    document.getElementById('player-crowns').textContent  = `${msg.crowns.e}`; // guest's crowns
    document.getElementById('enemy-crowns').textContent   = `${msg.crowns.p}`; // host's crowns

    // Card affordability
    document.querySelectorAll('.card').forEach((el, i) => {
      const key  = this.playerQueue[i];
      const card = CARDS[key];
      if (card) el.classList.toggle('disabled', this.playerElixir < card.cost);
    });

    // Game over
    if (msg.gameOver && !this.gameOver) {
      // result is from host's POV; invert for guest
      const guestResult = msg.result === 'win' ? 'lose' : (msg.result === 'lose' ? 'win' : null);
      if (guestResult) this._endGame(guestResult);
    }
  }

  // ── Guest render loop ──────────────────────────────────────────────────────
  _guestLoop(ts) {
    if (this.gameOver) return;
    this._guestRender();
    requestAnimationFrame(ts => this._guestLoop(ts));
  }

  _guestRender() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, C.W, C.H);

    // No canvas flip: guest sees the arena in server coordinates.
    // Their towers (team:'enemy') are at the TOP; they deploy in the top half.
    // isMine('enemy') === true for guest, so their towers draw blue. ✓
    this._drawArena(ctx);

    const s = this.guestState;
    if (s) {
      for (const ed of s.effects) this._drawEffectFromData(ctx, ed);

      for (const td of Object.values(s.towers)) {
        if (!td.alive) continue;
        const t = Object.assign(Object.create(Tower.prototype), td);
        t.draw(ctx);
      }

      for (const td of s.troops) {
        if (!td.alive) continue;
        const def = CARDS[td.cardKey] || {};
        const t   = Object.assign(Object.create(Troop.prototype), def, td);
        t.draw(ctx);
      }

      for (const pd of s.projectiles) {
        if (!pd.alive) continue;
        ctx.beginPath();
        ctx.arc(pd.x, pd.y, pd.r, 0, Math.PI * 2);
        ctx.fillStyle = pd.color;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(pd.x, pd.y, pd.r + 2, 0, Math.PI * 2);
        ctx.strokeStyle = pd.color;
        ctx.globalAlpha = 0.4;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // Deploy zone + ghost — guest deploys in TOP half (their territory)
    if (this.selectedCard !== null) {
      const key    = this.playerQueue[this.selectedCard];
      const card   = CARDS[key];
      if (card) {
        const isSpell = card.type === 'spell';
        const inZone  = isSpell || this.mouseY < C.RIVER_Y;

        if (!isSpell) {
          ctx.fillStyle = 'rgba(52,152,219,0.09)';
          ctx.fillRect(0, 0, C.W, C.RIVER_Y);
          ctx.strokeStyle = 'rgba(93,173,226,0.55)';
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 6]);
          ctx.strokeRect(2, 2, C.W - 4, C.RIVER_Y - 4);
          ctx.setLineDash([]);
        } else {
          ctx.fillStyle = 'rgba(52,152,219,0.05)';
          ctx.fillRect(0, 0, C.W, C.H);
        }

        if (inZone) {
          ctx.globalAlpha = 0.5;
          ctx.beginPath();
          ctx.arc(this.mouseX, this.mouseY, card.r || 20, 0, Math.PI * 2);
          ctx.fillStyle = card.bgColor || '#999';
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    }

    this._drawTimer(ctx);

    // Side label so the guest knows which half is theirs
    ctx.fillStyle = 'rgba(93,173,226,0.55)';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('← YOUR SIDE', 6, 6);
  }

  _drawEffectFromData(ctx, ed) {
    let obj;
    if (ed.type === 'HitEffect')    obj = Object.assign(Object.create(HitEffect.prototype),    ed);
    if (ed.type === 'SplashEffect') obj = Object.assign(Object.create(SplashEffect.prototype), ed);
    if (ed.type === 'DeployEffect') obj = Object.assign(Object.create(DeployEffect.prototype), ed);
    if (obj) obj.draw(ctx);
  }

  // ── Solo/Host main loop ────────────────────────────────────────────────────
  _loop(ts) {
    if (this.gameOver) return;
    const dt = this.lastTs ? Math.min((ts - this.lastTs) / 1000, 0.05) : 0.016;
    this.lastTs = ts;
    this._update(dt);
    this._render();
    requestAnimationFrame(ts => this._loop(ts));
  }

  _update(dt) {
    // ── Timer / Overtime ──
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      if (!this.overtime) {
        const pC = this._crowns('enemy'), eC = this._crowns('player');
        if (pC !== eC) { this._endGame(pC > eC ? 'win' : 'lose'); return; }
        this.overtime = true;
        this.timeLeft = C.OVERTIME_DURATION;
      } else {
        const pC = this._crowns('enemy'), eC = this._crowns('player');
        this._endGame(pC >= eC ? 'win' : 'lose');
        return;
      }
    }

    // ── Elixir regen ──
    const regen = C.ELIXIR_REGEN * (this.overtime ? 2 : 1);
    this.playerElixir = Math.min(C.MAX_ELIXIR, this.playerElixir + regen * dt);
    this.enemyElixir  = Math.min(C.MAX_ELIXIR, this.enemyElixir  + regen * dt);

    // ── AI / incoming guest deploys ──
    if (this.mode === 'host') {
      this.netGuest.processIncoming();
    } else {
      this.ai.update(dt);
    }

    // ── Gather live units ──
    const pAlive = [
      ...Object.values(this.pTowers).filter(t => t.alive),
      ...this.troops.filter(t => t.team === 'player' && t.alive),
    ];
    const eAlive = [
      ...Object.values(this.eTowers).filter(t => t.alive),
      ...this.troops.filter(t => t.team === 'enemy'  && t.alive),
    ];
    const pTrOnly = this.troops.filter(t => t.team === 'player' && t.alive);
    const eTrOnly = this.troops.filter(t => t.team === 'enemy'  && t.alive);

    // ── Towers attack enemy troops only ──
    for (const t of Object.values(this.pTowers)) t.update(dt, eTrOnly, this.projectiles);
    for (const t of Object.values(this.eTowers)) t.update(dt, pTrOnly, this.projectiles);

    // ── Troops ──
    for (const troop of this.troops) {
      if (!troop.alive) continue;
      troop.update(dt, troop.team === 'player' ? eAlive : pAlive, this.projectiles);
    }

    // ── Projectiles & Effects ──
    for (const p of this.projectiles) p.update(dt, this.effects);
    for (const e of this.effects)     e.update(dt);

    // ── Purge dead entities ──
    this.troops      = this.troops.filter(t => t.alive);
    this.projectiles = this.projectiles.filter(p => p.alive);
    this.effects     = this.effects.filter(e => e.alive);

    // ── Win conditions ──
    if (!this.eTowers.king.alive) { this._endGame('win');  return; }
    if (!this.pTowers.king.alive) { this._endGame('lose'); return; }

    // ── HUD ──
    this._updateHUD();

    // ── Send state to guest (host mode) ──
    if (this.mode === 'host') this.netGuest.sendState();
  }

  // ── Render (solo / host) ──────────────────────────────────────────────────
  _render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, C.W, C.H);

    this._drawArena(ctx);

    for (const e of this.effects) e.draw(ctx);
    for (const t of Object.values(this.eTowers)) t.draw(ctx);
    for (const t of Object.values(this.pTowers)) t.draw(ctx);
    for (const t of this.troops)      t.draw(ctx);
    for (const p of this.projectiles) p.draw(ctx);

    if (this.selectedCard !== null) {
      this._drawDeployZone(ctx);
      this._drawGhost(ctx);
    }

    this._drawTimer(ctx);
  }

  // ── Arena ─────────────────────────────────────────────────────────────────
  _drawArena(ctx) {
    const { W, H, RIVER_Y, RIVER_H, LEFT_BRIDGE_X, RIGHT_BRIDGE_X, BRIDGE_W } = C;
    const hw = BRIDGE_W / 2;

    // Grass
    ctx.fillStyle = '#1a7a41';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.025)';
    for (let y = 0; y < H; y += 28) ctx.fillRect(0, y, W, 14);

    // Dirt paths
    ctx.fillStyle = '#6e5330';
    ctx.fillRect(LEFT_BRIDGE_X  - hw, 0, BRIDGE_W, H);
    ctx.fillRect(RIGHT_BRIDGE_X - hw, 0, BRIDGE_W, H);
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 1;
    for (let y = 10; y < H; y += 20) {
      ctx.beginPath(); ctx.moveTo(LEFT_BRIDGE_X  - hw, y); ctx.lineTo(LEFT_BRIDGE_X  + hw, y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(RIGHT_BRIDGE_X - hw, y); ctx.lineTo(RIGHT_BRIDGE_X + hw, y); ctx.stroke();
    }

    // River
    const rg = ctx.createLinearGradient(0, RIVER_Y, 0, RIVER_Y + RIVER_H);
    rg.addColorStop(0, '#1565c0'); rg.addColorStop(0.5, '#1e88e5'); rg.addColorStop(1, '#1565c0');
    ctx.fillStyle = rg;
    ctx.fillRect(0, RIVER_Y, W, RIVER_H);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    for (let x = -20; x < W + 20; x += 45) {
      ctx.beginPath();
      ctx.ellipse(x + 22, RIVER_Y + RIVER_H / 2, 18, 7, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Bridges
    ctx.fillStyle = '#7d5c2a';
    ctx.fillRect(LEFT_BRIDGE_X  - hw, RIVER_Y, BRIDGE_W, RIVER_H);
    ctx.fillRect(RIGHT_BRIDGE_X - hw, RIVER_Y, BRIDGE_W, RIVER_H);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    for (let y = RIVER_Y + 10; y < RIVER_Y + RIVER_H; y += 14) {
      ctx.beginPath(); ctx.moveTo(LEFT_BRIDGE_X  - hw + 3, y); ctx.lineTo(LEFT_BRIDGE_X  + hw - 3, y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(RIGHT_BRIDGE_X - hw + 3, y); ctx.lineTo(RIGHT_BRIDGE_X + hw - 3, y); ctx.stroke();
    }

    // Team tints — perspective-aware so each player sees their half in blue
    const topIsEnemy = !isMine('player'); // guest: myTeam='enemy', so isMine('player')=false → top is theirs
    ctx.fillStyle = topIsEnemy ? 'rgba(52,152,219,0.07)' : 'rgba(231,76,60,0.07)';
    ctx.fillRect(0, 0, W, RIVER_Y);
    ctx.fillStyle = topIsEnemy ? 'rgba(231,76,60,0.07)' : 'rgba(52,152,219,0.07)';
    ctx.fillRect(0, RIVER_Y + RIVER_H, W, H - RIVER_Y - RIVER_H);

    // Centre dashed line
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 9]);
    ctx.beginPath();
    ctx.moveTo(0, RIVER_Y + RIVER_H / 2);
    ctx.lineTo(W, RIVER_Y + RIVER_H / 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  _drawDeployZone(ctx) {
    const key  = this.playerQueue[this.selectedCard];
    const card = CARDS[key];
    const isSpell = card && card.type === 'spell';

    if (isSpell) {
      ctx.fillStyle = 'rgba(52,152,219,0.06)';
      ctx.fillRect(0, 0, C.W, C.H);
    } else {
      ctx.fillStyle = 'rgba(52,152,219,0.08)';
      ctx.fillRect(0, C.RIVER_Y + C.RIVER_H, C.W, C.H - C.RIVER_Y - C.RIVER_H);
      ctx.strokeStyle = 'rgba(93,173,226,0.5)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.strokeRect(2, C.RIVER_Y + C.RIVER_H + 2, C.W - 4, C.H - C.RIVER_Y - C.RIVER_H - 4);
      ctx.setLineDash([]);
    }
  }

  _drawGhost(ctx) {
    const key  = this.playerQueue[this.selectedCard];
    const card = CARDS[key];
    if (!card) return;
    const isSpell = card.type === 'spell';
    if (!isSpell && this.mouseY < C.RIVER_Y + C.RIVER_H) return;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(this.mouseX, this.mouseY, card.r || 20, 0, Math.PI * 2);
    ctx.fillStyle = card.bgColor || '#999';
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  _drawTimer(ctx) {
    const total = Math.max(0, Math.ceil(this.timeLeft));
    const m = Math.floor(total / 60);
    const s = total % 60;
    const text = `${m}:${String(s).padStart(2, '0')}`;

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    const _tx = C.W / 2 - 34, _ty = 6, _tw = 68, _th = 28, _tr = 8;
    ctx.moveTo(_tx + _tr, _ty);
    ctx.lineTo(_tx + _tw - _tr, _ty);
    ctx.quadraticCurveTo(_tx + _tw, _ty, _tx + _tw, _ty + _tr);
    ctx.lineTo(_tx + _tw, _ty + _th - _tr);
    ctx.quadraticCurveTo(_tx + _tw, _ty + _th, _tx + _tw - _tr, _ty + _th);
    ctx.lineTo(_tx + _tr, _ty + _th);
    ctx.quadraticCurveTo(_tx, _ty + _th, _tx, _ty + _th - _tr);
    ctx.lineTo(_tx, _ty + _tr);
    ctx.quadraticCurveTo(_tx, _ty, _tx + _tr, _ty);
    ctx.closePath();
    ctx.fill();

    ctx.font = '13px serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = this.overtime ? '#e74c3c' : '#f1c40f';
    ctx.fillText('⏱', C.W / 2 - 16, 20);

    ctx.fillStyle = this.overtime ? '#e74c3c' : '#fff';
    ctx.font = 'bold 15px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, C.W / 2 + 8, 20);
  }

  // ── HUD ───────────────────────────────────────────────────────────────────
  _updateHUD() {
    document.getElementById('elixir-fill').style.width   = `${(this.playerElixir / C.MAX_ELIXIR) * 100}%`;
    document.getElementById('elixir-count').textContent  = Math.floor(this.playerElixir);
    document.getElementById('player-crowns').textContent = `${this._crowns('enemy')}`;
    document.getElementById('enemy-crowns').textContent  = `${this._crowns('player')}`;
    document.querySelectorAll('.card').forEach((el, i) => {
      const key  = this.playerQueue[i];
      const card = CARDS[key];
      if (card) el.classList.toggle('disabled', this.playerElixir < card.cost);
    });
  }

  // ── Card UI ───────────────────────────────────────────────────────────────
  renderCards() {
    const handEl = document.getElementById('card-hand');
    handEl.innerHTML = '';

    for (let i = 0; i < 4; i++) {
      const key  = this.playerQueue[i];
      const card = CARDS[key];
      if (!card) continue;
      const canPlay = this.playerElixir >= card.cost;

      const el = document.createElement('div');
      el.className = ['card',
        this.selectedCard === i ? 'selected' : '',
        !canPlay ? 'disabled' : '',
      ].filter(Boolean).join(' ');
      el.style.setProperty('--card-color', card.bgColor);
      el.innerHTML = `
        <div class="card-cost">${card.cost}</div>
        <div class="card-emoji">${card.emoji}</div>
        <div class="card-name">${card.name}</div>
      `;
      el.addEventListener('click', () => this._selectCard(i));
      handEl.appendChild(el);
    }

    // Next card preview
    const nextKey  = this.playerQueue[4];
    const nextCard = nextKey ? CARDS[nextKey] : null;
    const nextEl   = document.getElementById('next-card');
    if (nextCard) {
      nextEl.style.setProperty('--card-color', nextCard.bgColor);
      nextEl.innerHTML = `
        <div class="card-cost">${nextCard.cost}</div>
        <div class="card-emoji">${nextCard.emoji}</div>
        <div class="next-label">Next</div>
      `;
    }
  }

  _selectCard(i) {
    if (this.selectedCard === i) {
      this.selectedCard = null;
    } else {
      const key  = this.playerQueue[i];
      const card = CARDS[key];
      this.selectedCard = (card && this.playerElixir >= card.cost) ? i : null;
    }
    this.renderCards();
  }

  // ── Card Deployment ───────────────────────────────────────────────────────
  deployCard(cardKey, x, y, team) {
    const card = CARDS[cardKey];
    if (!card) return;

    if (card.type === 'spell') {
      this._applySpell(card, cardKey, x, y, team);
    } else {
      const count = card.count || 1;
      for (let i = 0; i < count; i++) {
        const ox = count > 1 ? (Math.random() - 0.5) * 42 : 0;
        const oy = count > 1 ? (Math.random() - 0.5) * 42 : 0;
        const troop = new Troop(card, x + ox, y + oy, team);
        troop.cardKey = cardKey;
        this.troops.push(troop);
      }
      const col = isMine(team) ? '#5dade2' : '#ec7063';
      this.effects.push(new DeployEffect(x, y, col));
    }

    if (team === 'enemy') this.enemyElixir -= card.cost;
  }

  _applySpell(card, cardKey, x, y, team) {
    const targets = team === 'player'
      ? [...Object.values(this.eTowers), ...this.troops.filter(t => t.team === 'enemy')]
      : [...Object.values(this.pTowers), ...this.troops.filter(t => t.team === 'player')];

    for (const e of targets) {
      if (!e.alive) continue;
      if (Math.hypot(e.x - x, e.y - y) < card.splashR + (e.r || 15)) {
        e.takeDamage(card.dmg);
      }
    }
    const rgb = cardKey === 'fireball' ? '231,76,60' : '149,165,166';
    this.effects.push(new SplashEffect(x, y, card.splashR, rgb));
  }

  // ── Input ─────────────────────────────────────────────────────────────────
  _bindEvents() {
    this.canvas.addEventListener('mousemove', e => {
      const rect = this.canvas.getBoundingClientRect();
      const sx = C.W / rect.width, sy = C.H / rect.height;
      const cx = (e.clientX - rect.left) * sx;
      const cy = (e.clientY - rect.top)  * sy;
      this.mouseX = cx;
      this.mouseY = cy;
    });

    this.canvas.addEventListener('click', e => {
      const rect = this.canvas.getBoundingClientRect();
      const sx = C.W / rect.width, sy = C.H / rect.height;
      const cx = (e.clientX - rect.left) * sx;
      const cy = (e.clientY - rect.top)  * sy;
      this._onArenaClick(cx, cy);
    });
  }

  _onArenaClick(cx, cy) {
    if (this.selectedCard === null) return;

    const key  = this.playerQueue[this.selectedCard];
    const card = CARDS[key];
    if (!card) return;

    const isSpell = card.type === 'spell';

    if (this.mode === 'guest') {
      // No flip: guest sees server coords directly.
      // Guest's territory is the TOP half (y < RIVER_Y) — 'enemy' towers are at top.
      if (!isSpell && cy >= C.RIVER_Y) {
        this.selectedCard = null; this.renderCards(); return;
      }
      if (this.playerElixir < card.cost) {
        this.selectedCard = null; this.renderCards(); return;
      }

      // Optimistic local update
      this.playerElixir -= card.cost;
      this.playerQueue.push(this.playerQueue.splice(this.selectedCard, 1)[0]);
      this.selectedCard = null;
      this.renderCards();

      if (this.ws && this.ws.readyState === 1) {
        this.ws.send(JSON.stringify({ type: 'deploy', cardKey: key, x: cx, y: cy }));
      }
      return;
    }

    // Solo / Host: deploy in player's half (bottom)
    if (!isSpell && cy < C.RIVER_Y + C.RIVER_H) {
      this.selectedCard = null; this.renderCards(); return;
    }
    if (this.playerElixir < card.cost) {
      this.selectedCard = null; this.renderCards(); return;
    }

    this.playerElixir -= card.cost;
    this.deployCard(key, cx, cy, 'player');
    this.playerQueue.push(this.playerQueue.splice(this.selectedCard, 1)[0]);
    this.selectedCard = null;
    this.renderCards();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  _crowns(side) {
    const towers = side === 'enemy' ? this.eTowers : this.pTowers;
    return Object.values(towers).filter(t => !t.alive).length;
  }

  _endGame(result) {
    this.gameOver = true;
    this.result   = result;

    const pC = this.mode === 'guest'
      ? (this.guestState ? this.guestState.crowns.e : 0)
      : this._crowns('enemy');
    const eC = this.mode === 'guest'
      ? (this.guestState ? this.guestState.crowns.p : 0)
      : this._crowns('player');

    document.getElementById('result-text').textContent  = result === 'win' ? '🏆 Vitória!' : '💀 Derrota!';
    document.getElementById('result-text').style.color  = result === 'win' ? '#f1c40f' : '#e74c3c';
    document.getElementById('result-crowns').textContent = `${pC} – ${eC}`;
    document.getElementById('game-over').classList.remove('hidden');

    // Notify peer (host only — sends final state naturally via netGuest)
  }
}

// ── Boot ───────────────────────────────────────────────────────────────────────
window.addEventListener('load', () => { initLobby(); });
