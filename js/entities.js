'use strict';

// isMine(team) → true if `team` is the LOCAL player's team.
// window.myTeam is set by game.js before any drawing happens:
//   'player' for solo / host,  'enemy' for guest.
function isMine(team) {
  return team === (window.myTeam || 'player');
}

// ─── Tower ────────────────────────────────────────────────────────────────────
class Tower {
  constructor(cfg, team) {
    this.x = cfg.x; this.y = cfg.y;
    this.r = cfg.r;
    this.maxHp = cfg.hp; this.hp = cfg.hp;
    this.isKing = cfg.isKing || false;
    this.team = team;
    this.alive = true;
    this.atkRange = cfg.isKing ? C.KING_RANGE + cfg.r : C.TOWER_RANGE + cfg.r;
    this.atkSpd   = cfg.isKing ? C.KING_ATK_SPD       : C.TOWER_ATK_SPD;
    this.dmg      = cfg.isKing ? C.KING_DMG            : C.TOWER_DMG;
    this.atkTimer  = 0;
    this.flashTimer = 0;
  }

  dist(e) { return Math.hypot(e.x - this.x, e.y - this.y); }

  update(dt, enemyTroops, projs) {
    if (!this.alive) return;
    this.atkTimer   = Math.max(0, this.atkTimer   - dt);
    this.flashTimer = Math.max(0, this.flashTimer - dt);
    if (this.atkTimer > 0) return;

    let target = null, minD = Infinity;
    for (const e of enemyTroops) {
      if (!e.alive) continue;
      const d = this.dist(e);
      if (d < this.atkRange && d < minD) { minD = d; target = e; }
    }

    if (target) {
      const col = isMine(this.team) ? '#5dade2' : '#ec7063';
      projs.push(new Projectile(this, target, this.dmg, col, 400, 7));
      this.atkTimer = 1 / this.atkSpd;
    }
  }

  takeDamage(dmg) {
    this.hp = Math.max(0, this.hp - dmg);
    this.flashTimer = 0.12;
    if (this.hp === 0) this.alive = false;
  }

  serialize() {
    return {
      x: this.x, y: this.y, r: this.r,
      team: this.team, isKing: this.isKing,
      hp: this.hp, maxHp: this.maxHp,
      alive: this.alive, flashTimer: this.flashTimer,
    };
  }

  draw(ctx) {
    if (!this.alive) return;
    const { x, y, r, team, isKing, hp, maxHp, flashTimer } = this;
    const mine = isMine(team);

    // Shadow
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.85, r * 0.75, r * 0.22, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fill();

    // Body
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = flashTimer > 0
      ? '#fff'
      : (mine ? (isKing ? '#154360' : '#1a5276') : (isKing ? '#641e16' : '#922b21'));
    ctx.fill();

    // Battlements
    const numBatt = isKing ? 8 : 5;
    for (let i = 0; i < numBatt; i++) {
      const a = (i / numBatt) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, isKing ? 4 : 3, 0, Math.PI * 2);
      ctx.fillStyle = flashTimer > 0 ? '#fff' : (mine ? '#1f618d' : '#7b241c');
      ctx.fill();
    }

    // Outline
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = mine ? '#5dade2' : '#ec7063';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Icon
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = `${isKing ? 20 : 16}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isKing ? '♛' : '♜', x, y);

    // HP bar
    const bw = r * 2 + 12, bh = 6;
    const bx = x - bw / 2, by = y + r + 5;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
    ctx.fillStyle = '#111';
    ctx.fillRect(bx, by, bw, bh);
    const pct = hp / maxHp;
    ctx.fillStyle = pct > 0.55 ? '#2ecc71' : pct > 0.28 ? '#f39c12' : '#e74c3c';
    ctx.fillRect(bx, by, bw * pct, bh);
    ctx.fillStyle = '#fff';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(Math.ceil(hp), x, by + bh / 2);
  }
}

// ─── Troop ────────────────────────────────────────────────────────────────────
class Troop {
  constructor(cardDef, x, y, team) {
    Object.assign(this, cardDef);
    this.x = x; this.y = y;
    this.team = team;
    this.hp = cardDef.hp; this.maxHp = cardDef.hp;
    this.atkTimer   = 0;
    this.flashTimer = 0;
    this.alive  = true;
    this.target = null;
    this.moving = true;
    // cardKey must be set after construction: troop.cardKey = key
  }

  dist(e) { return Math.hypot(e.x - this.x, e.y - this.y); }

  findTarget(allEnemies) {
    const aliveTroops = allEnemies.filter(e => e instanceof Troop && e.alive);
    const aliveTowers = allEnemies.filter(e => e instanceof Tower && e.alive);

    if (this.targetsBuildings) {
      return aliveTowers.reduce((best, t) =>
        !best || this.dist(t) < this.dist(best) ? t : best, null);
    }

    // Nearest enemy troop if within 200px
    const nearTroop = aliveTroops
      .filter(t => this.dist(t) < 200)
      .reduce((best, t) =>
        !best || this.dist(t) < this.dist(best) ? t : best, null);
    if (nearTroop) return nearTroop;

    return aliveTowers.reduce((best, t) =>
      !best || this.dist(t) < this.dist(best) ? t : best, null);
  }

  update(dt, allEnemies, projs) {
    if (!this.alive) return;
    this.atkTimer   = Math.max(0, this.atkTimer   - dt);
    this.flashTimer = Math.max(0, this.flashTimer - dt);

    if (!this.target || !this.target.alive) {
      this.target = this.findTarget(allEnemies);
    }
    if (!this.target) return;

    const d       = this.dist(this.target);
    const stopDist = this.atkRange + (this.target.r || 10);

    if (d > stopDist) {
      this.moving = true;
      const dx = this.target.x - this.x;
      const dy = this.target.y - this.y;
      const len = Math.hypot(dx, dy);
      this.x += (dx / len) * this.spd * dt;
      this.y += (dy / len) * this.spd * dt;
    } else {
      this.moving = false;
      if (this.atkTimer === 0) {
        const ranged = this.atkRange > 55;
        if (ranged) {
          const col = isMine(this.team) ? '#a9cce3' : '#f1948a';
          projs.push(new Projectile(this, this.target, this.dmg, col, 290, 5));
        } else {
          this.target.takeDamage(this.dmg);
        }
        this.atkTimer = 1 / this.atkSpd;
      }
    }
  }

  takeDamage(dmg) {
    this.hp = Math.max(0, this.hp - dmg);
    this.flashTimer = 0.1;
    if (this.hp === 0) this.alive = false;
  }

  serialize() {
    return {
      x: this.x, y: this.y, r: this.r,
      team: this.team,
      hp: this.hp, maxHp: this.maxHp,
      alive: this.alive, flashTimer: this.flashTimer,
      isFlying: this.isFlying || false,
      emoji: this.emoji, bgColor: this.bgColor,
      cardKey: this.cardKey || 'knight',
    };
  }

  draw(ctx) {
    if (!this.alive) return;
    const { x, y, r, team, hp, maxHp, flashTimer, isFlying, emoji, bgColor } = this;
    const mine = isMine(team);

    // Flying shadow
    if (isFlying) {
      ctx.beginPath();
      ctx.ellipse(x, y + r + 8, r * 0.7, r * 0.2, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fill();
    }

    // Body
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = flashTimer > 0 ? '#fff' : (bgColor || (mine ? '#2980b9' : '#c0392b'));
    ctx.fill();
    ctx.strokeStyle = mine ? '#7fb3d3' : '#e59866';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Emoji
    ctx.font = `${Math.max(r, 10)}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji || '⚔', x, y);

    // HP bar
    const bw = r * 2 + 6, bh = 4;
    const bx = x - bw / 2, by = y - r - 8;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
    ctx.fillStyle = '#222';
    ctx.fillRect(bx, by, bw, bh);
    const pct = hp / maxHp;
    ctx.fillStyle = pct > 0.55 ? '#2ecc71' : pct > 0.28 ? '#f39c12' : '#e74c3c';
    ctx.fillRect(bx, by, bw * pct, bh);
  }
}

// ─── Projectile ───────────────────────────────────────────────────────────────
class Projectile {
  constructor(from, target, dmg, color, spd, r) {
    this.x = from.x; this.y = from.y;
    this.target = target;
    this.dmg = dmg; this.color = color;
    this.spd = spd; this.r = r;
    this.alive = true;
  }

  update(dt, effects) {
    if (!this.alive) return;
    if (!this.target.alive) { this.alive = false; return; }

    const dx = this.target.x - this.x;
    const dy = this.target.y - this.y;
    const d  = Math.hypot(dx, dy);

    if (d < this.spd * dt + this.r) {
      this.target.takeDamage(this.dmg);
      effects.push(new HitEffect(this.target.x, this.target.y, this.color));
      this.alive = false;
    } else {
      this.x += (dx / d) * this.spd * dt;
      this.y += (dy / d) * this.spd * dt;
    }
  }

  serialize() {
    return { x: this.x, y: this.y, r: this.r, color: this.color, alive: this.alive };
  }

  draw(ctx) {
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    ctx.fillStyle = this.color;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r + 2, 0, Math.PI * 2);
    ctx.strokeStyle = this.color;
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

// ─── Visual Effects ───────────────────────────────────────────────────────────
class HitEffect {
  constructor(x, y, color) {
    this.x = x; this.y = y; this.color = color;
    this.life = 0.25; this.maxLife = 0.25;
    this.alive = true;
  }
  update(dt) { this.life -= dt; if (this.life <= 0) this.alive = false; }
  serialize() {
    return { type: 'HitEffect', x: this.x, y: this.y, color: this.color, life: this.life, maxLife: this.maxLife, alive: this.alive };
  }
  draw(ctx) {
    const a = this.life / this.maxLife;
    ctx.beginPath();
    ctx.arc(this.x, this.y, 12 * (1 - a) + 4, 0, Math.PI * 2);
    ctx.strokeStyle = this.color;
    ctx.globalAlpha = a * 0.8;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

class SplashEffect {
  constructor(x, y, maxR, rgb) {
    this.x = x; this.y = y; this.maxR = maxR; this.rgb = rgb;
    this.life = 0.55; this.maxLife = 0.55;
    this.alive = true;
  }
  update(dt) { this.life -= dt; if (this.life <= 0) this.alive = false; }
  serialize() {
    return { type: 'SplashEffect', x: this.x, y: this.y, maxR: this.maxR, rgb: this.rgb, life: this.life, maxLife: this.maxLife, alive: this.alive };
  }
  draw(ctx) {
    const a = this.life / this.maxLife;
    const r = this.maxR * (1 - a);
    ctx.beginPath();
    ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${this.rgb},${a * 0.25})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(${this.rgb},${a * 0.8})`;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}

class DeployEffect {
  constructor(x, y, color) {
    this.x = x; this.y = y; this.color = color;
    this.life = 0.4; this.maxLife = 0.4;
    this.alive = true;
  }
  update(dt) { this.life -= dt; if (this.life <= 0) this.alive = false; }
  serialize() {
    return { type: 'DeployEffect', x: this.x, y: this.y, color: this.color, life: this.life, maxLife: this.maxLife, alive: this.alive };
  }
  draw(ctx) {
    const a = this.life / this.maxLife;
    const r = 35 * (1 - a);
    ctx.beginPath();
    ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = this.color;
    ctx.globalAlpha = a;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
