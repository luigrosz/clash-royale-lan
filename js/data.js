'use strict';

// ─── Constants ───────────────────────────────────────────────────────────────
const C = {
  W: 390, H: 600,

  RIVER_Y: 265, RIVER_H: 70,
  LEFT_BRIDGE_X: 80,  RIGHT_BRIDGE_X: 310, BRIDGE_W: 72,

  // Tower configs: x, y, r (radius), hp, isKing
  P_KING:  { x: 195, y: 558, r: 38, hp: 2400, isKing: true  },
  P_LEFT:  { x:  78, y: 470, r: 28, hp: 1400, isKing: false },
  P_RIGHT: { x: 312, y: 470, r: 28, hp: 1400, isKing: false },
  E_KING:  { x: 195, y:  42, r: 38, hp: 2400, isKing: true  },
  E_LEFT:  { x:  78, y: 130, r: 28, hp: 1400, isKing: false },
  E_RIGHT: { x: 312, y: 130, r: 28, hp: 1400, isKing: false },

  TOWER_RANGE: 128, KING_RANGE: 105,
  TOWER_ATK_SPD: 0.8, KING_ATK_SPD: 0.65,
  TOWER_DMG: 90,    KING_DMG: 140,

  ELIXIR_REGEN: 1.4, MAX_ELIXIR: 10,
  GAME_DURATION: 180,   // seconds
  OVERTIME_DURATION: 60,
};

// ─── Card Definitions ─────────────────────────────────────────────────────────
const CARDS = {
  knight: {
    name: 'Knight', cost: 3, emoji: '⚔️', bgColor: '#922b21',
    type: 'troop',
    hp: 660, dmg: 75, spd: 70, atkRange: 38, atkSpd: 1.1, r: 15,
  },
  archers: {
    name: 'Archers', cost: 3, emoji: '🏹', bgColor: '#196f3d',
    type: 'troop', count: 2,
    hp: 252, dmg: 60, spd: 65, atkRange: 130, atkSpd: 1.5, r: 12,
  },
  giant: {
    name: 'Giant', cost: 5, emoji: '🧌', bgColor: '#566573',
    type: 'troop',
    hp: 2000, dmg: 110, spd: 44, atkRange: 42, atkSpd: 1.4, r: 23,
    targetsBuildings: true,
  },
  musketeer: {
    name: 'Musketeer', cost: 4, emoji: '🔫', bgColor: '#6c3483',
    type: 'troop',
    hp: 380, dmg: 120, spd: 65, atkRange: 148, atkSpd: 1.8, r: 13,
  },
  minions: {
    name: 'Minions', cost: 3, emoji: '😈', bgColor: '#4a235a',
    type: 'troop', count: 3,
    hp: 190, dmg: 55, spd: 90, atkRange: 90, atkSpd: 1.2, r: 10,
    isFlying: true,
  },
  barbarians: {
    name: 'Barbarians', cost: 5, emoji: '🪓', bgColor: '#784212',
    type: 'troop', count: 4,
    hp: 420, dmg: 85, spd: 65, atkRange: 38, atkSpd: 1.4, r: 13,
  },
  fireball: {
    name: 'Fireball', cost: 4, emoji: '🔥', bgColor: '#922b21',
    type: 'spell', dmg: 330, splashR: 130,
  },
  arrows: {
    name: 'Arrows', cost: 3, emoji: '🎯', bgColor: '#4d5656',
    type: 'spell', dmg: 120, splashR: 165,
  },
};

const DEFAULT_DECK = ['knight','archers','giant','musketeer','minions','barbarians','fireball','arrows'];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function randBetween(min, max) {
  return min + Math.random() * (max - min);
}
