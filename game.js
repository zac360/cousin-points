'use strict';
// ============================================================
// CONSTANTS
// ============================================================
const COLORS = {
  violet:'#8B5CF6', teal:'#14B8A6', coral:'#F97316', pink:'#EC4899',
  blue:'#3B82F6', green:'#22C55E', amber:'#F59E0B', slate:'#64748B'
};
const CURSE_CONFIG = {
  stupidity:   {cost:2, dur:3600000,    label:'Stupidity',    icon:'🧠'},
  illiteracy:  {cost:2, dur:3600000,    label:'Illiteracy',   icon:'📝'},
  invisibility:{cost:3, dur:7200000,    label:'Invisibility', icon:'👻'},
  tiny:        {cost:1, dur:7200000,    label:'Tiny',         icon:'🔬'},
  impostor:    {cost:3, dur:3600000,    label:'Impostor',     icon:'🎭'},
  silence:     {cost:3, dur:86400000,   label:'Silence',      icon:'🤐'},
  poke:        {cost:0, dur:0,          label:'Poke',         icon:'👉'},
};
// Tier keys: 'council' (1st), 'rank-N' (middle), 'peasant' (last)
function ordinalSuffix(n) {
  const v = n % 100;
  const s = ['th','st','nd','rd'];
  return n + (s[(v-20)%10] || s[v] || s[0]);
}
function getTierMeta(tier) {
  if (tier === 'council') return { icon:'👑', label:'Head Council', cls:'tier-council' };
  if (tier === 'peasant') return { icon:'💀', label:'Peasant',      cls:'tier-peasant' };
  const n = parseInt((tier+'').replace('rank-',''), 10);
  if (!isNaN(n)) return { icon:'', label: 'Cousin #' + n, cls:'tier-common' };
  return { icon:'', label:'Cousin', cls:'tier-common' };
}
// Keep TIER_META for any legacy references
const TIER_META = { council:{icon:'👑',label:'Head Council',cls:'tier-council'}, peasant:{icon:'💀',label:'Peasant',cls:'tier-peasant'} };
const DAILY_MS         = 86400000;
const DUEL_TIMEOUT_MS  = 86400000;
const DUEL_WAGER       = 2;
const BOUNTY_COST      = 3;
const BOUNTY_BONUS     = 3;
const BOUNTY_EXPIRE_MS = 259200000; // 72h
const STARTING_PTS     = 10;

// ============================================================
// STATE
// ============================================================
const S = {
  myId: null, me: null,
  players:{}, bets:{}, duels:{}, feed:[], votes:{}, bounties:{},
  tiers:{}, tab:'leaderboard', battleDuelId:null, lastFeedSeen:0,
};

// ============================================================
// DB HELPERS
// ============================================================
const pRef  = id => db.collection('players').doc(id);
const bRef  = id => db.collection('bets').doc(id);
const dRef  = id => db.collection('duels').doc(id);
const fRef  = id => db.collection('feed').doc(id);
const vRef  = id => db.collection('votes').doc(id);
const boRef = id => db.collection('bounties').doc(id);
const newId = col => db.collection(col).doc().id;
const ts    = ()  => firebase.firestore.Timestamp.now();
const INC   = n   => firebase.firestore.FieldValue.increment(n);

async function adjustPts(playerId, delta) {
  let actual = delta;
  await db.runTransaction(async tx => {
    const doc = await tx.get(pRef(playerId));
    if (!doc.exists) return;
    const cur = doc.data().points || 0;
    if (delta < 0 && cur + delta < 0) actual = -cur;
    if (actual === 0) return;
    tx.update(pRef(playerId), {points: cur + actual});
  });
  return actual;
}

// ============================================================
// UTILS
// ============================================================
function assignTiers(sorted) {
  const n = sorted.length, t = {};
  sorted.forEach((p, i) => {
    if (i === 0)        t[p.id] = 'council';
    else if (i === n-1) t[p.id] = 'peasant';
    else                t[p.id] = 'rank-' + (i + 1);
  });
  return t;
}
const sortedPlayers = () => Object.values(S.players).sort((a,b)=>(b.points||0)-(a.points||0));
const el  = id  => document.getElementById(id);
const esc = s   => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const medal = r => r===1?'👑':r===2?'🥈':'🥉';

// Hand-drawn font: render name as a row of PNG letter images.
// File mapping: A=1, a=2, B=3, b=4, ... Z=51, z=52, ?=53, !=54
const _HD_BASE = 'Font 01 hand drawn/Font-';
const _hdCharNum = c => {
  const code = c.charCodeAt(0);
  if (code >= 65 && code <= 90) return (code-65)*2+1;  // A-Z
  if (code >= 97 && code <= 122) return (code-97)*2+2; // a-z
  if (c==='?') return 53; if (c==='!') return 54;
  return null;
};
function hdName(text, height='20px') {
  const imgs = Array.from(String(text)).map(c => {
    if (c === ' ') return '<span class="hd-space"></span>';
    const n = _hdCharNum(c);
    if (!n) return `<span style="font-size:${height};font-weight:800;line-height:1">${esc(c)}</span>`;
    return `<img src="${encodeURI(_HD_BASE+n+'.png')}" style="height:${height};width:auto" />`;
  }).join('');
  return `<span class="hd-name" style="--hd-h:${height}">${imgs}</span>`;
}

function fmtLeft(ms) {
  if (ms<=0) return 'Ready';
  const h=Math.floor(ms/3600000), m=Math.floor((ms%3600000)/60000), s=Math.floor((ms%60000)/1000);
  if (h>0) return `${h}h ${m}m`; if (m>0) return `${m}m ${s}s`; return `${s}s`;
}
function fmtAgo(tsv) {
  const ms = typeof tsv==='number' ? tsv : (tsv?.toMillis?.() || 0);
  const d = Date.now()-ms;
  if (d<60000) return 'just now'; if (d<3600000) return `${Math.floor(d/60000)}m ago`;
  if (d<86400000) return `${Math.floor(d/3600000)}h ago`; return `${Math.floor(d/86400000)}d ago`;
}
function getDisplayName(id) {
  const p = S.players[id]; if (!p) return 'Unknown';
  const c = p.curseActive;
  if (!c || Date.now() > c.expiresAt) return p.name;
  if (c.type==='stupidity')  return p.name.split('').reverse().join('');
  if (c.type==='illiteracy') return gibberish(id, p.name.length);
  if (c.type==='impostor') {
    const others = Object.values(S.players).filter(x=>x.id!==id);
    if (!others.length) return p.name;
    const seed = id.split('').reduce((a,c2)=>a+c2.charCodeAt(0),0) + Math.floor((c.castAt||0)/3600000);
    return others[seed % others.length].name;
  }
  return p.name;
}
function gibberish(seed, len) {
  const ch='qwertyuiopasdfghjklzxcvbnm';
  const s=seed.split('').reduce((a,c)=>a+c.charCodeAt(0),0);
  return Array.from({length:len},(_,i)=>ch[(s*(i+1)*7)%ch.length]).join('');
}
// ---- Battle actions (swap icons/labels freely — logic uses the keys) ----
const ACTIONS = {
  rock:     { label:'Rock',     icon:'🪨', color:'#8b5cf6' },
  paper:    { label:'Paper',    icon:'📄', color:'#3b82f6' },
  scissors: { label:'Scissors', icon:'✂️',  color:'#e74c3c' },
};
// Rock beats Scissors, Scissors beat Paper, Paper beats Rock
// aHit = challenger loses round, bHit = challenged loses round
function resolveRoundOutcome(aAct, bAct) {
  if (aAct === bAct) return { aHit:false, bHit:false, txt:'🤝 Tie!' };
  const beats = { rock:'scissors', scissors:'paper', paper:'rock' };
  if (beats[aAct] === bAct)
    return { aHit:false, bHit:true,  txt:`${ACTIONS[aAct].icon} ${ACTIONS[aAct].label} beats ${ACTIONS[bAct].label}!` };
  return   { aHit:true,  bHit:false, txt:`${ACTIONS[bAct].icon} ${ACTIONS[bAct].label} beats ${ACTIONS[aAct].label}!` };
}
// ============================================================
// ASSET PATHS
// ============================================================
const _avbBody = f => encodeURI('APP ASSETS/Avatar build assets/' + f);
const _avbIcon = f => encodeURI('APP ASSETS/Icons (avatar)/' + f);

const AVB_BODY_FILES = {
  red:          'body red.png',
  blue:         'body blue.png',
  'dark blue':  'body dark blue.png',
  green:        'body green.png',
  'light blue': 'body light blue.png',
  pink:         'body pink.png',
  yellow:       'body yello.png',
};

const AVB_COLORS = [
  { id:'red',        f1:'blob red .png',       f2:'blob red 2.png'        },
  { id:'blue',       f1:'blob blue.png',        f2:'blob blue 2.png'       },
  { id:'dark blue',  f1:'blob dark blue.png',   f2:'blob dark blue 2.png'  },
  { id:'green',      f1:'bloob green.png',      f2:'blob green 2.png'      },
  { id:'light blue', f1:'blob light blue.png',  f2:'blob light blue 2.png' },
  { id:'pink',       f1:'blob pink.png',        f2:'blob pink 2.png'       },
  { id:'yellow',     f1:'blob yellow.png',      f2:'blob yellow 2.png'     },
];

const AVB_CATEGORIES = [
  {
    id: 'mouth', icon: 'icon mouth .png',
    items: [
      { id:'none', file:'mouth none.png', label:'None'    },
      { id:'1',    file:'mouth 1.png',    label:'Mouth 1' },
      { id:'2',    file:'mouth 2.png',    label:'Mouth 2' },
      { id:'3',    file:'mouth 3.png',    label:'Mouth 3' },
      { id:'4',    file:'mouth 4.png',    label:'Mouth 4' },
      { id:'5',    file:'mouth 5.png',    label:'Mouth 5' },
      { id:'6',    file:'mouth 6.png',    label:'Mouth 6' },
    ],
  },
  {
    id: 'brows', icon: 'icon eyebrow .png',
    items: [
      { id:'none', file:null,              label:'None'    },
      { id:'1',    file:'eyebrow 1.png',   label:'Brows 1' },
      { id:'2',    file:'eyebrow 2.png',   label:'Brows 2' },
      { id:'3',    file:'eyebrow 3.png',   label:'Brows 3' },
      { id:'4',    file:'eyebrow 4.png',   label:'Brows 4' },
      { id:'5',    file:'eyebrow 5.png',   label:'Brows 5' },
      { id:'6',    file:'eyebrow 6.png',   label:'Brows 6' },
    ],
  },
  {
    id: 'glasses', icon: 'icon glassis.png',
    items: [
      { id:'none', file:null,              label:'None'      },
      { id:'1',    file:' glasses 1.png',  label:'Glasses 1' },
      { id:'2',    file:'glasses 2.png',   label:'Glasses 2' },
    ],
  },
];

// ============================================================
// AVATAR RENDERING (PNG layer stack)
// ============================================================
function renderPlayer(p, size=60) {
  if (p?.avatar && AVB_BODY_FILES[p?.color]) return drawAvatarPNG(p.avatar, p.color, size);
  return drawCharacter(p?.character||'knight', p?.color||'#8B5CF6', S.tiers[p?.id]||'common', size);
}

// size = number → fixed-size wrapper div; size = null → img tags only (fills positioned parent)
function drawAvatarPNG(avatar, colorKey, size) {
  const bodyFile = AVB_BODY_FILES[colorKey] || 'body red.png';
  const srcs = [_avbBody(bodyFile)];

  if (avatar.mouth && avatar.mouth !== 'none')
    srcs.push(_avbBody(`mouth ${avatar.mouth}.png`));

  if (avatar.brows && avatar.brows !== 'none') {
    srcs.push(_avbBody(`eyebrow ${avatar.brows}.png`));
  }
  if (avatar.glasses && avatar.glasses !== 'none') {
    srcs.push(_avbBody(avatar.glasses === '1' ? ' glasses 1.png' : 'glasses 2.png'));
  }

  const imgs = srcs.map((s, i) => {
    const blend = i > 0 ? 'mix-blend-mode:multiply;' : '';
    return typeof size === 'number'
      ? `<img src="${s}" style="position:absolute;top:0;left:0;width:${size}px;height:${size}px;object-fit:contain;pointer-events:none;${blend}" />`
      : `<img src="${s}" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain;pointer-events:none;${blend}" />`;
  }).join('');

  if (typeof size === 'number') {
    return `<div style="position:relative;width:${size}px;height:${size}px;display:inline-block;flex-shrink:0;isolation:isolate;">${imgs}</div>`;
  }
  return imgs; // caller's element must be position:relative with defined size + isolation:isolate
}

// ============================================================
// AVATAR ANIMATOR — canvas-based PNG sequence for battle screen
// Source: APP ASSETS/Idel animation/  (20 frames per layer, 1–20 not zero-padded)
// ============================================================
const IDLE_BASE   = 'APP ASSETS/Idel animation/';
const IDLE_FRAMES = 20;

const IDLE_BODY = {
  'red':        { folder: 'BODY/Body red',      prefix: 'Body_red'        },
  'blue':       { folder: 'BODY/Body blue',      prefix: 'Body_Blue'       },
  'dark blue':  { folder: 'BODY/bady dark blue', prefix: 'Body_dark_blue'  },
  'green':      { folder: 'BODY/body green',     prefix: 'Body_green'      },
  'pink':       { folder: 'BODY/body pink',      prefix: 'Body_pink'       },
  'yellow':     { folder: 'BODY/Body yellow',    prefix: 'Body_dark_yellow'},
};
const IDLE_MOUTH = {
  '1': { folder: 'mouth/M 1',  prefix: 'mouth' },
  '2': { folder: 'mouth/M 2',  prefix: 'mouth' },
  '3': { folder: 'mouth/M3 ',  prefix: 'mouth' },
  '4': { folder: 'mouth/M4',   prefix: 'mouth' },
  '5': { folder: 'mouth/M5',   prefix: 'mouth' },
  '6': { folder: 'mouth/M6',   prefix: 'mouth' },
};
const IDLE_BROWS = {
  '1': { folder: 'eyebrow/eyerow 1', prefix: 'Eyebrow' },
  '2': { folder: 'eyebrow/eyerow 2', prefix: 'Eyebrow' },
  '3': { folder: 'eyebrow/eyerow 3', prefix: 'Eyebrow' },
  '4': { folder: 'eyebrow/eyerow 4', prefix: 'Eyebrow' },
  '5': { folder: 'eyebrow/eyerow 5', prefix: 'Eyebrow' },
  '6': { folder: 'eyebrow/eyerow 6', prefix: 'Eyebrow' },
};
const IDLE_GLASSES = {
  '1': { folder: 'Glassis/Glassis 1', prefix: 'mouth' },
  '2': { folder: 'Glassis/glassis 2', prefix: 'mouth' },
};

class AvatarAnimator {
  constructor(container, playerData) {
    this._raf  = null;
    this._last = 0;
    this._fi   = 0;
    this.layers = [];

    this._crop = { sx: 710, sy: 68, sw: 542, sh: 618 };

    this.canvas = document.createElement('canvas');
    this.canvas.width  = 130;
    this.canvas.height = 148;
    this.canvas.style.cssText = 'width:100%;height:100%;display:block;';
    this.ctx = this.canvas.getContext('2d');
    container.innerHTML = '';
    container.appendChild(this.canvas);

    this._loadAll(playerData);
  }

  _loadAll({ color, avatar = {} }) {
    const seqs = [];
    const body = IDLE_BODY[color];
    if (body) seqs.push(body);
    const mouth = IDLE_MOUTH[avatar.mouth];
    if (mouth) seqs.push(mouth);
    const brows = IDLE_BROWS[avatar.brows];
    if (brows) seqs.push(brows);
    const glasses = IDLE_GLASSES[avatar.glasses];
    if (glasses) seqs.push(glasses);

    Promise.all(seqs.map(s => this._loadSeq(s))).then(layers => {
      this.layers = layers.filter(l => l.length > 0);
      if (this.layers.length) this._loop(performance.now());
    });
  }

  _loadSeq({ folder, prefix }) {
    const ps = [];
    for (let i = 1; i <= IDLE_FRAMES; i++) {
      const img = new Image();
      img.src = encodeURI(`${IDLE_BASE}${folder}/${prefix}${i}.png`);
      ps.push(new Promise(res => { img.onload=()=>res(img); img.onerror=()=>res(null); }));
    }
    return Promise.all(ps).then(fs => fs.filter(Boolean));
  }

  _loop(ts) {
    if (ts - this._last >= 1000/24) {
      const ctx=this.ctx, w=this.canvas.width, h=this.canvas.height;
      const {sx,sy,sw,sh}=this._crop;
      ctx.clearRect(0,0,w,h);
      for (const layer of this.layers) {
        const f = layer[this._fi % layer.length];
        if (f) ctx.drawImage(f, sx,sy,sw,sh, 0,0,w,h);
      }
      this._fi++;
      this._last = ts;
    }
    this._raf = requestAnimationFrame(t => this._loop(t));
  }

  destroy() {
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
  }
}

let _btlAnimators  = [];
let _btlRevealing  = false;
let _btlRevealKey  = '';
let _battleUnsub   = null;
function destroyBattleAnimators() {
  _btlAnimators.forEach(a => a.destroy());
  _btlAnimators = [];
}
function initBattleAnimators(myId, oppId) {
  destroyBattleAnimators();
  const me = S.players[myId], opp = S.players[oppId];
  if (me?.avatar  && AVB_BODY_FILES[me.color])
    _btlAnimators.push(new AvatarAnimator(el('btl-avatar-right'), me));
  if (opp?.avatar && AVB_BODY_FILES[opp.color])
    _btlAnimators.push(new AvatarAnimator(el('btl-avatar-left'),  opp));
}

// ============================================================
// AVATAR BUILDER
// ============================================================
let joinState = { color:'red', mouth:'1', brows:'none', glasses:'none' };
let avbActiveCategory = 'mouth';
let _avbBlobInterval  = null;
let _avbBlobFrame     = 0;
let _wheelScrollTimer = null;
let _avbEditBackup    = null;

function renderAvatarBuilder() {
  renderAvatarPreview();
  renderCatCol();
  renderBlobCol();
  renderWheelForCategory(avbActiveCategory);
}

// Layer-based preview: body stays put, only feature layers swap src — no flash.
function renderAvatarPreview() {
  const prev = el('avb-preview'); if (!prev) return;
  const S_LAYER = 'position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain;pointer-events:none;';
  const S_FEAT  = S_LAYER + 'mix-blend-mode:multiply;transition:opacity 0.09s ease;';
  if (!el('avb-l-body')) {
    prev.innerHTML = `
      <img id="avb-l-body"    style="${S_LAYER}" />
      <img id="avb-l-mouth"   style="${S_FEAT}" />
      <img id="avb-l-brows"   style="${S_FEAT}" />
      <img id="avb-l-glasses" style="${S_FEAT}" />`;
  }
  el('avb-l-body').src = _avbBody(AVB_BODY_FILES[joinState.color] || 'body red.png');
  const mSrc = (joinState.mouth && joinState.mouth !== 'none') ? _avbBody(`mouth ${joinState.mouth}.png`) : null;
  let bSrc = null;
  if (joinState.brows && joinState.brows !== 'none')
    bSrc = _avbBody(`eyebrow ${joinState.brows}.png`);
  let gSrc = null;
  if (joinState.glasses && joinState.glasses !== 'none')
    gSrc = joinState.glasses === '1' ? _avbBody(' glasses 1.png') : _avbBody('glasses 2.png');
  _setPreviewLayer('avb-l-mouth',   mSrc);
  _setPreviewLayer('avb-l-brows',   bSrc);
  _setPreviewLayer('avb-l-glasses', gSrc);
}
function _setPreviewLayer(id, src) {
  const img = el(id); if (!img) return;
  if (src) { img.src = src; img.style.opacity = '1'; }
  else      { img.style.opacity = '0'; }
}

function renderCatCol() {
  const col = el('avb-cat-col'); if (!col) return;
  col.innerHTML = AVB_CATEGORIES.map(cat => `
    <div class="avb-cat-btn${cat.id === avbActiveCategory ? ' active' : ''}"
         onclick="avbSetCategory('${cat.id}')">
      <img src="${_avbIcon(cat.icon)}" />
    </div>`).join('');
}

function renderBlobCol() {
  const col = el('avb-blob-col'); if (!col) return;
  col.innerHTML = AVB_COLORS.map(c => `
    <div class="avb-blob-btn${c.id === joinState.color ? ' selected' : ''}"
         data-color="${c.id}" onclick="avbSetColor('${c.id}')">
      <img src="${_avbIcon(c.f1)}" class="avb-bf0" />
      <img src="${_avbIcon(c.f2)}" class="avb-bf1" style="display:none" />
    </div>`).join('');

  // Line boil animation at 4fps
  if (_avbBlobInterval) clearInterval(_avbBlobInterval);
  _avbBlobFrame = 0;
  _avbBlobInterval = setInterval(() => {
    _avbBlobFrame = 1 - _avbBlobFrame;
    col.querySelectorAll('.avb-blob-btn').forEach(btn => {
      btn.querySelector('.avb-bf0').style.display = _avbBlobFrame === 0 ? '' : 'none';
      btn.querySelector('.avb-bf1').style.display = _avbBlobFrame === 1 ? '' : 'none';
    });
  }, 250);
}

function renderWheelForCategory(catId) {
  const wheel = el('avb-wheel'); if (!wheel) return;
  const cat = AVB_CATEGORIES.find(c => c.id === catId); if (!cat) return;
  const selected = joinState[catId];

  wheel.onscroll = null; // prevent spurious scroll events during innerHTML swap

  wheel.innerHTML = cat.items.map(item => {
    const mini = drawAvatarPNG({ ...joinState, [catId]: item.id }, joinState.color, 70);
    return `<div class="avb-wheel-tile${item.id === selected ? ' selected' : ''}"
         data-id="${item.id}" onclick="avbSelectTile('${catId}','${item.id}')">${mini}</div>`;
  }).join('');

  // Scroll to selected, then re-attach handler and apply arc
  requestAnimationFrame(() => {
    const idx = cat.items.findIndex(i => i.id === selected);
    const tiles = wheel.querySelectorAll('.avb-wheel-tile');
    if (tiles[idx]) tiles[idx].scrollIntoView({ behavior:'auto', block:'nearest', inline:'center' });
    requestAnimationFrame(() => {
      wheel.onscroll = onWheelScroll;
      updateWheelArc();
    });
  });
}

let _wheelRafId = null;
function onWheelScroll() {
  if (_wheelRafId) cancelAnimationFrame(_wheelRafId);
  _wheelRafId = requestAnimationFrame(updateWheelArc);
}

// Real-time arc effect: scales + fades tiles based on distance from center.
// The center tile = top of the arc = auto-selected as you scroll.
function updateWheelArc() {
  _wheelRafId = null;
  const wheel = el('avb-wheel'); if (!wheel) return;
  const cx = wheel.scrollLeft + wheel.clientWidth / 2;
  let closest = null, minDist = Infinity;

  wheel.querySelectorAll('.avb-wheel-tile').forEach(tile => {
    const tileCx = tile.offsetLeft + tile.offsetWidth / 2;
    const dist = Math.abs(tileCx - cx);
    // Normalize: 0 = center, 1 = half the visible width away
    const t = Math.min(1, dist / (wheel.clientWidth * 0.42));
    tile.style.transform = `scale(${(1 - t * 0.3).toFixed(3)})`;
    tile.style.opacity   = (Math.max(0.2, 1 - t * 0.72)).toFixed(3);
    if (dist < minDist) { minDist = dist; closest = tile; }
  });

  if (closest) {
    const id = closest.dataset.id;
    if (joinState[avbActiveCategory] !== id) {
      joinState[avbActiveCategory] = id;
      wheel.querySelectorAll('.avb-wheel-tile').forEach(t =>
        t.classList.toggle('selected', t.dataset.id === id));
      renderAvatarPreview();
    }
  }
}

function avbSetColor(colorId) {
  joinState.color = colorId;
  el('avb-blob-col')?.querySelectorAll('.avb-blob-btn').forEach(b =>
    b.classList.toggle('selected', b.dataset.color === colorId));
  renderAvatarPreview();
  renderWheelForCategory(avbActiveCategory); // update mini-avatar thumbnails
}

function avbSetCategory(catId) {
  avbActiveCategory = catId;
  renderCatCol();
  renderWheelForCategory(catId);
}

function avbSelectTile(catId, itemId) {
  joinState[catId] = itemId;
  const wheel = el('avb-wheel');
  wheel?.querySelectorAll('.avb-wheel-tile').forEach(t =>
    t.classList.toggle('selected', t.dataset.id === itemId));
  renderAvatarPreview();
  // Instant scroll — smooth scroll causes intermediate tiles to trigger preview flicker
  const tile = wheel?.querySelector(`[data-id="${itemId}"]`);
  if (tile) tile.scrollIntoView({ behavior:'auto', block:'nearest', inline:'center' });
}

// ============================================================
// IN-GAME AVATAR EDITING
// ============================================================
function openAvatarEdit() {
  if (!S.me) return;
  _avbEditBackup = { ...joinState };
  const a = S.me.avatar || {};
  // Validate IDs against new schema; old players may have 'm1'/'b1' style IDs
  const validMouths  = new Set(['none','1','2','3','4','5','6']);
  const validBrows   = new Set(['none','1','2','3','4','5','6']);
  const validGlasses = new Set(['none','1','2']);
  joinState.color   = AVB_BODY_FILES[S.me.color] ? S.me.color : 'red';
  joinState.mouth   = validMouths.has(a.mouth)    ? a.mouth   : '1';
  joinState.brows   = validBrows.has(a.brows)      ? a.brows   : '1';
  joinState.glasses = validGlasses.has(a.glasses)  ? a.glasses : 'none';
  avbActiveCategory = 'mouth';

  el('main-game').style.display   = 'none';
  el('join-screen').style.display = 'flex';
  el('join-screen').classList.add('edit-mode');
  el('join-btn').textContent = '✓ Save Changes';
  el('name-input').value = S.me.name || '';
  el('name-input').placeholder = 'Your name…';
  el('victory-input').value = S.me.victoryPhrase || '';

  renderAvatarBuilder();
}

function cancelAvatarEdit() {
  if (_avbEditBackup) { Object.assign(joinState, _avbEditBackup); _avbEditBackup = null; }
  if (_avbBlobInterval) { clearInterval(_avbBlobInterval); _avbBlobInterval = null; }
  el('name-input').value = '';
  el('victory-input').value = '';
  el('join-screen').style.display = 'none';
  el('join-screen').classList.remove('edit-mode');
  el('main-game').style.display   = 'flex';
  el('join-btn').textContent = 'Done — Join the Game!';
}

async function saveAvatarEdit() {
  const btn = el('join-btn');
  btn.disabled = true; btn.textContent = 'Saving…';
  const avatar = { mouth:joinState.mouth, brows:joinState.brows, glasses:joinState.glasses };
  const newName = el('name-input').value.trim();
  const oldName = S.me.name;
  const nameChanged = newName.length >= 2 && newName !== oldName;
  const victoryPhrase = el('victory-input').value.trim().slice(0, 40);
  const updates = { avatar, color: joinState.color, victoryPhrase };
  if (nameChanged) updates.name = newName;
  try {
    await pRef(S.myId).update(updates);
    S.me = { ...S.me, ...updates };
    S.players[S.myId] = { ...S.players[S.myId], ...updates };
    if (nameChanged) {
      await addFeed(`${oldName} changed their name to ${newName} ✏️`, '📝');
    } else {
      await addFeed(`${S.me.name} has changed appearance 👀`, '🪞');
    }
    if (_avbBlobInterval) { clearInterval(_avbBlobInterval); _avbBlobInterval = null; }
    el('name-input').value = '';
    el('victory-input').value = '';
    el('join-screen').style.display = 'none';
    el('join-screen').classList.remove('edit-mode');
    el('main-game').style.display   = 'flex';
    btn.textContent = 'Done — Join the Game!';
    btn.disabled = false;
    _avbEditBackup = null;
    renderTopBar();
    toast(nameChanged ? `Name changed to ${newName}!` : 'Avatar updated!', 'success');
  } catch(e) {
    toast('Failed: ' + e.message, 'error');
    btn.disabled = false; btn.textContent = '✓ Save Changes';
  }
}

async function handleJoin() {
  const name = el('name-input').value.trim();
  if (!name || name.length<2) { toast('Enter a name (at least 2 chars)', 'error'); return; }
  const btn = el('join-btn');
  btn.disabled=true; btn.textContent='Joining…';
  const id = db.collection('players').doc().id;
  const avatar = { mouth:joinState.mouth, brows:joinState.brows, glasses:joinState.glasses };
  const victoryPhrase = el('victory-input').value.trim().slice(0, 40);
  const data = {
    name, color:joinState.color, avatar, victoryPhrase,
    character:'custom',
    points:STARTING_PTS, joinedAt:ts(),
    lastDaily:null, lastPeasantPenalty:null, lastTaxCollected:null,
    curseActive:null, nemesis:null,
    exiledUntil:null, taxBlockedUntil:null, dictatorPower:null,
  };
  try {
    await pRef(id).set(data);
    localStorage.setItem('cp_player_id', id);
    S.myId=id; S.me={id,...data};
    await addFeed(`${name} joined!`, '✨');
    startGame();
  } catch(e) {
    toast('Failed: '+e.message, 'error');
    btn.disabled=false; btn.textContent='Done — Join the Game!';
  }
}

// ============================================================
// INIT
// ============================================================
let _postLandingAction = null;
let _logoBoilInterval  = null;

async function init() {
  S.myId = localStorage.getItem('cp_player_id');
  S.lastFeedSeen = parseInt(localStorage.getItem('cp_last_feed')||'0',10);

  renderAvatarBuilder();
  if (S.myId) {
    try {
      const doc = await pRef(S.myId).get();
      if (doc.exists) {
        S.me={id:S.myId,...doc.data()};
        _postLandingAction = startGame;
        showLanding(); return;
      }
    } catch(e) {}
    localStorage.removeItem('cp_player_id'); S.myId=null;
  }
  _postLandingAction = () => { el('join-screen').style.display='flex'; };
  showLanding();
}

function showLanding() {
  el('loading-screen').style.display='none';
  el('landing-screen').style.display='flex';
  startLogoBoil();
}

function startLogoBoil() {
  // Two pre-loaded <img> tags — toggle opacity to avoid src-swap flash
  const img0 = el('landing-logo-0'), img1 = el('landing-logo-1');
  if (!img0 || !img1) return;
  let frame = 0;
  if (_logoBoilInterval) clearInterval(_logoBoilInterval);
  _logoBoilInterval = setInterval(() => {
    frame = 1 - frame;
    img0.style.opacity = frame === 0 ? '1' : '0';
    img1.style.opacity = frame === 1 ? '1' : '0';
  }, 250); // 4 fps
}

function stopLogoBoil() {
  if (_logoBoilInterval) { clearInterval(_logoBoilInterval); _logoBoilInterval = null; }
}

function startFromLanding() {
  stopLogoBoil();
  el('landing-screen').style.display='none';
  if (_postLandingAction) _postLandingAction();
}

function startGame() {
  el('loading-screen').style.display='none';
  el('join-screen').style.display='none';
  el('main-game').style.display='flex';
  requestNotifPermission();
  attachListeners();
  setInterval(()=>{updateDailyBtn();updateTaxBtn();updatePenaltyBtn();}, 1000);
  setInterval(checkVoteClosures, 30000);
}

// ============================================================
// REALTIME LISTENERS
// ============================================================
function attachListeners() {
  db.collection('players').onSnapshot(snap=>{
    const seen={};
    snap.forEach(d=>{seen[d.id]=true; S.players[d.id]={id:d.id,...d.data()};});
    Object.keys(S.players).forEach(id=>{ if(!seen[id]) delete S.players[id]; });
    S.me = S.players[S.myId]||S.me;
    const sorted = sortedPlayers();
    S.tiers = sorted.length ? assignTiers(sorted) : {};
    renderTopBar(); renderLeaderboard(); renderDuelPlayersList(); updateCurseSelect();
    checkExpiredCurses(); checkForIncomingCurse();
  });

  db.collection('bets').orderBy('createdAt','desc').limit(50).onSnapshot(snap=>{
    S.bets={};
    snap.forEach(d=>S.bets[d.id]={id:d.id,...d.data()});
    if(S.tab==='bets') renderBets();
    updateTabDots();
  });

  db.collection('duels').orderBy('createdAt','desc').limit(100).onSnapshot(snap=>{
    S.duels={};
    snap.forEach(d=>S.duels[d.id]={id:d.id,...d.data()});
    if(S.tab==='duels') { renderDuels(); renderDuelPlayersList(); }
    checkAvoided();
    updateTabDots();
    checkAutoOpenBattle();
  });

  db.collection('feed').orderBy('timestamp','desc').limit(100).onSnapshot(snap=>{
    S.feed=[];
    snap.forEach(d=>S.feed.push({id:d.id,...d.data()}));
    if(S.tab==='feed') renderFeed();
    updateNotifBadge();
    updateTabDots();
    pruneFeed();
  });

  db.collection('votes').where('status','==','open').onSnapshot(snap=>{
    S.votes={};
    snap.forEach(d=>S.votes[d.id]={id:d.id,...d.data()});
    if(S.tab==='feed') renderFeed();
    checkVoteClosures();
  });

  db.collection('bounties').where('status','==','active').onSnapshot(snap=>{
    S.bounties={};
    snap.forEach(d=>S.bounties[d.id]={id:d.id,...d.data()});
    renderLeaderboard();
  });

}

// ============================================================
// TOP BAR
// ============================================================
function renderTopBar() {
  if(!S.me) return;
  const tier=S.tiers[S.myId]||'common', tm=getTierMeta(tier);
  const avatarEl = el('top-bar-avatar');
  avatarEl.innerHTML = renderPlayer(S.me,36);
  avatarEl.onclick = openAvatarEdit;
  el('top-bar-name').textContent = getDisplayName(S.myId);
  el('top-bar-tier').textContent = `${tm.icon} ${tm.label}`;
}

// ============================================================
// LEADERBOARD
// ============================================================
function renderLeaderboard() {
  if(!S.me) return;
  const sorted=sortedPlayers(), total=sorted.length, maxPts=sorted[0]?.points||1;
  const myIdx=sorted.findIndex(p=>p.id===S.myId), myRank=myIdx+1;
  const myTier=S.tiers[S.myId]||'common', tm=getTierMeta(myTier);

  const _st = (id,v) => { const e=el(id); if(e) e.textContent=v; };
  _st('mc-my-pts',   S.me?.points??'—');
  _st('mc-my-rank',  myRank||'—');
  _st('mc-my-tier',  `${tm.icon} ${tm.label}`);
  _st('mc-total-players', total);
  _st('mc-total-pts', sorted.reduce((a,p)=>a+(p.points||0),0));

  const councilBanner=el('council-banner'), peasantWarn=el('peasant-warning');
  if(myTier==='council'){
    councilBanner.style.display='';
    const blocked=S.me?.taxBlockedUntil&&Date.now()<S.me.taxBlockedUntil;
    councilBanner.innerHTML=blocked
      ? `👑 Tax power blocked — ${fmtLeft(S.me.taxBlockedUntil-Date.now())} remaining`
      : `👑 You are Head Council! Use the Collect Tax button below.`;
  } else councilBanner.style.display='none';
  peasantWarn.style.display = myTier==='peasant' ? '' : 'none';

  updateDailyBtn(); updateTaxBtn(); updatePenaltyBtn();

  const bountyTargets={};
  Object.values(S.bounties).forEach(b=>{ bountyTargets[b.target]=true; });

  // nemesis = the last person who beat you in battle

  const rows = sorted.map((p,i)=>{
    const tier=S.tiers[p.id]||'common', ptm=getTierMeta(tier);
    const c=p.curseActive, now=Date.now();
    const invisible=c&&c.type==='invisibility'&&now<c.expiresAt;
    if(invisible&&p.id!==S.myId) return '';
    const tiny=c&&c.type==='tiny'&&now<c.expiresAt;
    const isMe=p.id===S.myId, rank=i+1;
    const pct=maxPts>0?Math.round((p.points/maxPts)*100):0;
    const name=esc(getDisplayName(p.id));
    const exiled=p.exiledUntil&&now<p.exiledUntil;
    // Show nemesis pill on MY row only — who last beat me
    const isMyNemesis = isMe && S.me?.nemesis && S.players[S.me.nemesis];
    // Show "is nemesis of" pill on their row — if they are my nemesis
    const theyAreMyNem = !isMe && S.me?.nemesis === p.id;
    const hasBounty=bountyTargets[p.id];
    const curseTag = c && now < c.expiresAt
      ? `<div class="lb-pill lb-pill-curse">${CURSE_CONFIG[c.type]?.icon||''} ${CURSE_CONFIG[c.type]?.label} · ${fmtLeft(c.expiresAt-now)}</div>`
      : '';
    const avatarSize = rank === 1 ? 80 : 60;
    return `<div class="lb-row${isMe?' is-me':''}${rank===1?' rank-1-row':''}" data-id="${p.id}">
      <div class="lb-avatar-big${tiny?' tiny-curse':''}">
        ${renderPlayer(p, avatarSize)}
      </div>
      <div class="lb-score-block">
        <span class="lb-star">⭐</span>
        <span class="lb-pts-big">${p.points??0}</span>
      </div>
      <div class="lb-info-right">
        <div class="lb-name-row">
          <span class="lb-name-text${rank===1?' lb-name-first':''}">${name}</span>
          <span class="lb-rank-paren">${ptm.icon ? ptm.icon+' ' : ''}${ptm.label}</span>
          ${isMe?'<span class="lb-you-tag">you</span>':''}
        </div>
        <div class="lb-pills">
          ${curseTag}
          ${isMyNemesis?`<div class="lb-pill lb-pill-enemy">⚔️ nemesis: ${esc(getDisplayName(S.me.nemesis))}</div>`:''}
          ${theyAreMyNem?'<div class="lb-pill lb-pill-enemy">⚔️ your nemesis</div>':''}
          ${exiled?'<div class="lb-pill lb-pill-exile">🚫 exiled</div>':''}
          ${hasBounty?'<div class="lb-pill lb-pill-bounty">🎯 bounty</div>':''}
        </div>
      </div>
    </div>`;
  }).join('');

  el('leaderboard-list').innerHTML = rows || '<div class="empty-state"><div class="empty-icon">👻</div><p>No players yet</p></div>';
}

// ============================================================
// DAILY POINT
// ============================================================
function dailyLeft() {
  if(!S.me?.lastDaily) return 0;
  const last=S.me.lastDaily.toMillis?S.me.lastDaily.toMillis():S.me.lastDaily;
  return Math.max(0, DAILY_MS-(Date.now()-last));
}
function updateDailyBtn() {
  const btn=el('btn-daily'), cd=el('daily-countdown');
  if(!btn||!cd) return;
  const can=dailyLeft()===0;
  btn.style.display=can?'':'none'; cd.style.display=can?'none':'';
  if(!can) cd.textContent=`⭐ Daily in ${fmtLeft(dailyLeft())}`;
}
async function claimDaily() {
  if(dailyLeft()>0){toast('Not ready yet','error');return;}
  if(isExiled()){toast('You are Exiled','error');return;}
  await adjustPts(S.myId,1);
  await pRef(S.myId).update({lastDaily:ts()});
  await addFeed(`${S.me.name} claimed their daily point`,  '⭐');
  toast('+1 point claimed!','success'); showDelta('+1',true);
}

// ============================================================
// TAX
// ============================================================
function taxLeft() {
  if(!S.me?.lastTaxCollected) return 0;
  const last=S.me.lastTaxCollected.toMillis?S.me.lastTaxCollected.toMillis():S.me.lastTaxCollected;
  return Math.max(0, DAILY_MS-(Date.now()-last));
}
function canTax() {
  return S.tiers[S.myId]==='council' && taxLeft()===0 &&
    !(S.me?.taxBlockedUntil&&Date.now()<S.me.taxBlockedUntil);
}
function updateTaxBtn() {
  const btn=el('btn-tax'), cd=el('tax-countdown');
  if(!btn||!cd) return;
  const isC=S.tiers[S.myId]==='council';
  btn.style.display=isC&&canTax()?'':'none';
  cd.style.display=isC&&!canTax()?'':'none';
  if(isC&&!canTax()) {
    const blocked=S.me?.taxBlockedUntil&&Date.now()<S.me.taxBlockedUntil;
    cd.textContent=blocked?`👑 Blocked ${fmtLeft(S.me.taxBlockedUntil-Date.now())}`:`👑 Tax in ${fmtLeft(taxLeft())}`;
  }
}
async function collectTax() {
  if(!canTax()){toast('Not ready','error');return;}
  const others=Object.values(S.players).filter(p=>p.id!==S.myId&&(p.points||0)>=1);
  const batch=db.batch();
  others.forEach(p=>batch.update(pRef(p.id),{points:INC(-1)}));
  batch.update(pRef(S.myId),{points:INC(others.length),lastTaxCollected:ts()});
  await batch.commit();
  await addFeed(`👑 ${S.me.name} collected tax — everyone lost 1pt`,'👑');
  toast(`+${others.length}pts from tax!`,'success'); showDelta(`+${others.length}`,true);
}

// ============================================================
// PEASANT PENALTY
// ============================================================
function penaltyLeft() {
  if(!S.me?.lastPeasantPenalty) return 0;
  const last=S.me.lastPeasantPenalty.toMillis?S.me.lastPeasantPenalty.toMillis():S.me.lastPeasantPenalty;
  return Math.max(0, DAILY_MS-(Date.now()-last));
}
function updatePenaltyBtn() {
  const btn=el('btn-peasant-penalty'), cd=el('penalty-countdown');
  if(!btn||!cd) return;
  const isP=S.tiers[S.myId]==='peasant';
  btn.style.display=isP&&penaltyLeft()===0?'':'none';
  cd.style.display=isP&&penaltyLeft()>0?'':'none';
  if(isP&&penaltyLeft()>0) cd.textContent=`💀 Penalty in ${fmtLeft(penaltyLeft())}`;
}
async function applyPeasantPenalty() {
  if(penaltyLeft()>0) return;
  const cur=S.me?.points||0, lose=Math.min(3,cur);
  const others=Object.values(S.players).filter(p=>p.id!==S.myId);
  const per=others.length>0?Math.floor(lose/others.length):0;
  const batch=db.batch();
  batch.update(pRef(S.myId),{points:INC(-lose),lastPeasantPenalty:ts()});
  if(per>0) others.forEach(p=>batch.update(pRef(p.id),{points:INC(per)}));
  await batch.commit();
  await addFeed(`💀 ${S.me.name} (Peasant) lost ${lose}pts — split among others`,'💀');
  toast(`-${lose}pts (Peasant penalty)`,'error'); showDelta(`-${lose}`,false);
}

function isSilenced() {
  const c = S.me?.curseActive;
  return !!(c?.type === 'silence' && c.expiresAt && Date.now() < c.expiresAt);
}
function isExiled() {
  return !!(S.me?.exiledUntil && Date.now() < S.me.exiledUntil);
}

// ============================================================
// BETS
// ============================================================
function openCreateBetModal() {
  if(isSilenced()){toast('You are Silenced','error');return;}
  if(isExiled()){toast('You are Exiled','error');return;}
  const allPlayers=Object.values(S.players);
  openModal('Create a Bet',`
    <div class="form-group"><label class="form-label">Question</label>
      <input type="text" id="bq" placeholder="Will Jake eat the whole pizza?" maxlength="120"/></div>
    <div class="form-group"><label class="form-label">Subject (they self-report the outcome)</label>
      ${playerPickerHTML('bs', allPlayers, S.myId)}</div>
    <div class="form-group"><label class="form-label">Outcomes (comma-separated)</label>
      <input type="text" id="bo" placeholder="Yes, No, Maybe"/></div>
    <div class="form-group"><label class="form-label">Wager per vote (pts)</label>
      <input type="number" id="bw" value="1" min="1" max="10"/></div>
  `, async ()=>{
    const q=el('bq').value.trim(), sub=el('bs').value;
    const opts2=el('bo').value.split(',').map(s=>s.trim()).filter(Boolean);
    const w=parseInt(el('bw').value,10)||1;
    if(!q){toast('Enter a question','error');return false;}
    if(opts2.length<2){toast('Need 2+ outcomes','error');return false;}
    if((S.me?.points||0)<w){toast('Not enough points','error');return false;}
    await db.collection('bets').doc(newId('bets')).set({
      question:q, subject:sub, options:opts2, wager:w,
      status:'open', votes:{}, winner:null, createdBy:S.myId, createdAt:ts(),
    });
    await addFeed(`${S.me.name} created a bet: "${q}"`,'🎲');
    toast('Bet created!','success');
  });
}
async function voteOnBet(betId, option) {
  const bet=S.bets[betId];
  if(!bet||bet.status!=='open'){toast('Bet not open','error');return;}
  if(bet.subject===S.myId){toast("You're the subject — you can't vote, only report the outcome",'error');return;}
  if(bet.votes?.[S.myId]){toast('Already voted','error');return;}
  if(isExiled()){toast('You are Exiled','error');return;}
  if((S.me?.points||0)<bet.wager){toast(`Need ${bet.wager}pts`,'error');return;}
  await adjustPts(S.myId,-bet.wager);
  await bRef(betId).update({[`votes.${S.myId}`]:option});
  toast(`Voted "${option}"! -${bet.wager}pt`,'success');
}
async function lockBet(betId) {
  const bet=S.bets[betId];
  if(!bet||bet.status!=='open') return;
  if(Object.keys(bet.votes||{}).length<2){toast('Need 2+ votes to lock','error');return;}
  await bRef(betId).update({status:'locked'});
  await addFeed(`Bet locked: "${bet.question}"`,'🔒');
  toast('Bet locked!','success');
}
async function reportBetOutcome(betId, outcome) {
  const bet=S.bets[betId];
  if(!bet||bet.status!=='locked') return;
  if(bet.subject!==S.myId){toast('Only the subject can report','error');return;}
  const winners=Object.entries(bet.votes||{}).filter(([,v])=>v===outcome).map(([id])=>id);
  const pot=Object.keys(bet.votes||{}).length*(bet.wager||1);
  const payout=winners.length>0?Math.floor(pot/winners.length):0;
  const batch=db.batch();
  winners.forEach(id=>batch.update(pRef(id),{points:INC(payout)}));
  batch.update(bRef(betId),{status:'settled',winner:outcome});
  await batch.commit();
  await addFeed(`Bet settled! "${bet.question}" — ${outcome} wins (${payout}pts each)`,'🎲');
  toast(`Settled: ${outcome} wins`,'success');
}
function renderBets() {
  const list=el('bets-list'); if(!list) return;
  const bets=Object.values(S.bets);
  if(!bets.length){list.innerHTML='<div class="empty-state"><div class="empty-icon">🎲</div><p>No bets yet</p></div>';return;}
  list.innerHTML=bets.map(bet=>{
    const myVote=bet.votes?.[S.myId];
    const vCount=Object.keys(bet.votes||{}).length, pot=vCount*(bet.wager||1);
    const isSubject=bet.subject===S.myId;
    const optsHtml=bet.options.map(opt=>{
      const cls=myVote===opt?'voted':bet.winner===opt?'winner':'';
      const n=Object.values(bet.votes||{}).filter(v=>v===opt).length;
      const label=`${esc(opt)}${(myVote||bet.status==='settled')?` (${n})`:''}`;
      if(bet.status==='open'&&!myVote&&!isSubject)
        return `<button class="bet-option-btn ${cls}" onclick="voteOnBet('${bet.id}','${esc(opt)}')">${label}</button>`;
      return `<div class="bet-option-btn ${cls}">${label}</div>`;
    }).join('');
    const statusCls={open:'status-open',locked:'status-locked',awaiting:'status-awaiting',settled:'status-settled'}[bet.status]||'status-open';
    let actions='';
    if(bet.status==='open'&&vCount>=2)
      actions+=`<button class="btn-outline btn-sm" onclick="lockBet('${bet.id}')">🔒 Lock</button>`;
    if(bet.status==='locked'&&isSubject)
      actions+=bet.options.map(o=>`<button class="btn-gold btn-sm" onclick="reportBetOutcome('${bet.id}','${esc(o)}')">Report: ${esc(o)}</button>`).join('');
    const subName=esc(S.players[bet.subject]?.name||'Unknown');
    return `<div class="bet-card">
      <div class="bet-question">${esc(bet.question)}</div>
      <div class="bet-meta"><span class="bet-status-badge ${statusCls}">${bet.status}</span> • Subject: ${subName} • ${bet.wager}pt wager • Pot: ${pot}pt</div>
      <div class="bet-options">${optsHtml}</div>
      ${actions?`<div class="bet-actions">${actions}</div>`:''}
    </div>`;
  }).join('');
}

// ============================================================
// DUELS
// ============================================================
function renderDuelPlayersList() {
  const list=el('duel-players-list'); if(!list) return;
  const others=Object.values(S.players).filter(p=>p.id!==S.myId);
  if(!others.length){list.innerHTML='<div class="empty-state" style="padding:16px"><p>No other players yet</p></div>';return;}
  list.innerHTML=others.map(p=>{
    const tier=S.tiers[p.id]||'common', tm=getTierMeta(tier);
    const canChallenge=(S.me?.points||0)>=DUEL_WAGER&&(p.points||0)>=DUEL_WAGER;
    const recent=Object.values(S.duels).find(d=>
      d.challenger===S.myId&&d.challenged===p.id&&
      ['pending','active'].includes(d.status)&&
      Date.now()-(d.createdAt?.toMillis?.()||0)<DUEL_TIMEOUT_MS
    );
    let btn='';
    if(recent?.status==='active')
      btn=`<button class="btn-gold btn-sm" onclick="openBattleScreen('${recent.id}')">⚔️ Battle!</button>`;
    else if(recent?.status==='pending')
      btn=`<button class="btn-outline btn-sm" disabled>Pending…</button>`;
    else if(isSilenced())
      btn=`<button class="btn-outline btn-sm" disabled>Silenced</button>`;
    else if(!canChallenge)
      btn=`<button class="btn-outline btn-sm" disabled>Need ${DUEL_WAGER}pts</button>`;
    else
      btn=`<button class="btn-outline btn-sm" onclick="challengeToDuel('${p.id}')">⚔️ Challenge</button>`;
    return `<div class="duel-player-btn">
      ${renderPlayer(p,36)}
      <div style="flex:1"><div style="font-weight:600">${esc(getDisplayName(p.id))}</div>
        <div style="font-size:11px;color:var(--text-dim)">${tm.icon} ${tm.label} · ${p.points}pts</div></div>
      ${btn}</div>`;
  }).join('');
}
async function challengeToDuel(targetId) {
  if(isSilenced()){toast('You are Silenced','error');return;}
  if((S.me?.points||0)<DUEL_WAGER){toast(`Need ${DUEL_WAGER}pts`,'error');return;}
  const target=S.players[targetId];
  if(!target||(target.points||0)<DUEL_WAGER){toast(`${target?.name||'Player'} needs ${DUEL_WAGER}pts`,'error');return;}
  const id=newId('duels');
  await dRef(id).set({challenger:S.myId,challenged:targetId,wager:DUEL_WAGER,status:'pending',choices:{},winner:null,createdAt:ts()});
  await addFeed(`⚔️ ${S.me.name} challenged ${getDisplayName(targetId)} to a duel!`,'⚔️');
  toast(`Challenge sent to ${target.name}!`,'success');
}
async function acceptDuel(duelId) {
  const d = S.duels[duelId]; if(!d) return;
  await dRef(duelId).update({
    status:'active',
    currentRound: 1,
    pendingChoices: {},
    usedActions: { [d.challenger]:[], [d.challenged]:[] },
    rounds: [],
  });
  await addFeed(`${S.me.name} accepted ${getDisplayName(d.challenger)}'s duel!`,'⚔️');
  openBattleScreen(duelId);
}
async function declineDuel(duelId) {
  await dRef(duelId).update({status:'declined'});
  await adjustPts(S.myId, -1);
  const d=S.duels[duelId];
  await addFeed(`${S.me.name} declined ${getDisplayName(d?.challenger)}'s challenge`,'🏳️');
  toast('Declined','info');
}
function checkAvoided() {
  Object.values(S.duels).forEach(async d=>{
    if(d.status!=='pending') return;
    const created=d.createdAt?.toMillis?.()||0;
    if(Date.now()-created<DUEL_TIMEOUT_MS) return;
    // Use transaction so only one client processes this — prevents double point deduction and double feed entry
    let didSet=false;
    try {
      await db.runTransaction(async tx=>{
        const snap=await tx.get(dRef(d.id));
        if(!snap.exists||snap.data().status!=='pending') return;
        tx.update(dRef(d.id),{status:'avoided'});
        didSet=true;
      });
    } catch(e){ return; }
    if(!didSet) return;
    await adjustPts(d.challenged,-1);
    await addFeed(`${getDisplayName(d.challenged)} avoided ${getDisplayName(d.challenger)}'s challenge — -1pt cowardice`,'🐔');
  });
}
function checkAutoOpenBattle() {
  if(el('battle-screen').style.display!=='none') return;
  const active=Object.values(S.duels).find(d=>d.status==='active'&&(d.challenger===S.myId||d.challenged===S.myId));
  if(active) openBattleScreen(active.id);
}
function renderDuels() {
  const list=el('duels-list'); if(!list) return;
  const mine=Object.values(S.duels)
    .filter(d=>d.challenger===S.myId||d.challenged===S.myId)
    .sort((a,b)=>{const o={pending:0,active:1,complete:2,declined:3,avoided:4};return (o[a.status]??5)-(o[b.status]??5);})
    .slice(0,20);
  if(!mine.length){list.innerHTML='<div class="empty-state" style="padding:20px"><div class="empty-icon">⚔️</div><p>No duels yet</p></div>';return;}
  list.innerHTML=mine.map(d=>{
    const isC=d.challenger===S.myId, oppId=isC?d.challenged:d.challenger;
    const opp=S.players[oppId]||{}, oppTier=S.tiers[oppId]||'common';
    let statusHtml='', actHtml='';
    if(d.status==='pending'&&!isC){
      statusHtml='<span class="bet-status-badge status-open">You were challenged!</span>';
      actHtml=`<button class="btn-gold btn-sm" onclick="acceptDuel('${d.id}')">⚔️ Accept</button>
               <button class="btn-outline btn-sm" onclick="declineDuel('${d.id}')">Decline</button>`;
    } else if(d.status==='pending'&&isC){
      const tl=DUEL_TIMEOUT_MS-(Date.now()-(d.createdAt?.toMillis?.()||Date.now()));
      statusHtml=`<span class="bet-status-badge status-locked">Pending (${fmtLeft(tl)})</span>`;
    } else if(d.status==='active'){
      statusHtml='<span class="bet-status-badge status-open">⚔️ Active!</span>';
      actHtml=`<button class="btn-gold btn-sm" onclick="openBattleScreen('${d.id}')">Enter Battle</button>`;
    } else if(d.status==='complete'){
      const w=d.winner===S.myId, t=d.winner==='tie';
      statusHtml=t?'<span class="bet-status-badge status-locked">Tie</span>'
        :w?'<span class="bet-status-badge status-settled">Victory!</span>'
          :'<span class="bet-status-badge status-awaiting">Defeated</span>';
    } else if(d.status==='avoided'){
      statusHtml='<span class="bet-status-badge" style="background:rgba(192,57,43,.15);color:#e74c3c">Avoided</span>';
    } else if(d.status==='declined'){
      statusHtml='<span class="bet-status-badge" style="background:rgba(100,100,100,.15);color:#aaa">Declined</span>';
    }
    return `<div class="duel-card">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        ${renderPlayer(opp,36)}
        <div style="flex:1">
          <div style="font-weight:600">${esc(getDisplayName(oppId))}</div>
          <div style="font-size:11px;color:var(--text-dim)">${fmtAgo(d.createdAt)} · ${d.wager}pt wager</div>
        </div>
        <div>${statusHtml}</div>
      </div>
      ${actHtml?`<div class="bet-actions">${actHtml}</div>`:''}
    </div>`;
  }).join('');
}

// ============================================================
// BATTLE SCREEN — Punch / Duck / Stand Firm (3 rounds, each action once)
// ============================================================
function openBattleScreen(duelId) {
  const d=S.duels[duelId]; if(!d) return;
  // Clean up any previous listener before creating a new one
  if(_battleUnsub){ _battleUnsub(); _battleUnsub=null; }
  S.battleDuelId=duelId;
  _btlRevealing=false; _btlRevealKey='';
  const myId=S.myId, oppId=d.challenger===myId?d.challenged:d.challenger;
  if(!S.players[myId]||!S.players[oppId]) return;

  el('battle-screen').style.display='flex';
  el('btl-over').style.display='none';
  renderBattleScreen(duelId, myId, oppId);
  initBattleAnimators(myId, oppId);

  // Live updates
  _battleUnsub=dRef(duelId).onSnapshot(snap=>{
    if(!snap.exists) return;
    const upd={id:snap.id,...snap.data()};
    S.duels[duelId]=upd;
    if(upd.status==='complete'){ clearActionTimer(); if(_battleUnsub){_battleUnsub();_battleUnsub=null;} renderBattleScreen(duelId,myId,oppId); showBattleEnd(upd,myId,oppId); return; }
    renderBattleScreen(duelId,myId,oppId);
    // Start timer if it's my turn to pick
    const pc=upd.pendingChoices||{};
    if(!pc[myId] && upd.status==='active') startActionTimer(duelId);
    else clearActionTimer();
    // Both choices in → show reveal then resolve
    if(pc[myId]&&pc[oppId]&&upd.status==='active'){
      const key=`${duelId}-${upd.currentRound||1}`;
      if(_btlRevealKey!==key){
        _btlRevealKey=key;
        clearActionTimer();
        showRevealSequence(duelId, myId, oppId, upd);
      }
    }
  });
}

function renderBattleScreen(duelId, myId, oppId) {
  if (_btlRevealing) return; // don't interrupt reveal animation
  const d=S.duels[duelId]; if(!d) return;
  const me=S.players[myId], opp=S.players[oppId]; if(!me||!opp) return;
  const round=d.currentRound||1;
  const myPending=d.pendingChoices?.[myId];
  const oppPending=d.pendingChoices?.[oppId];
  const ro=el('btl-round-outcome'); if(ro) ro.textContent='';

  // Header
  el('btl-round-label').textContent=`Round ${round} / 3`;

  // Avatars — user on RIGHT, opponent on LEFT
  if (!_btlAnimators.length) {
    const ms = me.avatar  && AVB_BODY_FILES[me.color];
    const os = opp.avatar && AVB_BODY_FILES[opp.color];
    el('btl-avatar-right').innerHTML = ms ? drawAvatarPNG(me.avatar,  me.color,  null) : renderPlayer(me,  120);
    el('btl-avatar-left').innerHTML  = os ? drawAvatarPNG(opp.avatar, opp.color, null) : renderPlayer(opp, 120);
  }
  el('btl-fname-right').textContent = getDisplayName(myId);
  el('btl-fname-left').textContent  = getDisplayName(oppId);
  el('btl-fpts-right').textContent  = `${me.points}pts`;
  el('btl-fpts-left').textContent   = `${opp.points}pts`;

  // --- OPPONENT (left side — just show picked/waiting, hide their choice) ---
  el('btl-actions-left').innerHTML = d.status==='pending' ? '' : oppPending
    ? `<div style="text-align:center;padding:6px 0">
         <div style="font-size:26px">✅</div>
         <div style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:3px">Picked!</div>
       </div>`
    : `<div style="text-align:center;padding:6px 0">
         <div style="font-size:26px">⏳</div>
         <div style="font-size:10px;color:rgba(255,255,255,0.3);margin-top:3px">Choosing…</div>
       </div>`;

  // --- MY ACTIONS (right side — clickable buttons) ---
  if(d.status==='pending'){
    el('btl-actions-right').innerHTML = '<div style="font-size:12px;color:rgba(255,255,255,0.4);padding:8px 0;text-align:center">Waiting for<br>opponent to accept…</div>';
    el('btl-status-msg').textContent = 'Awaiting acceptance…';
  } else if(myPending){
    el('btl-actions-right').innerHTML = Object.entries(ACTIONS).map(([k,a])=>{
      const isChosen = k === myPending;
      return `<div class="btl-action-btn${isChosen?' chosen':''}" style="opacity:${isChosen?1:0.3}">
        <span class="btl-action-icon">${a.icon}</span>
        <span class="btl-action-label">${isChosen?'Chosen':a.label}</span>
      </div>`;
    }).join('');
    el('btl-status-msg').textContent = oppPending ? 'Both chosen…' : `Waiting for ${getDisplayName(oppId)}…`;
  } else {
    el('btl-actions-right').innerHTML = Object.entries(ACTIONS).map(([k,a])=>{
      return `<button class="btl-action-btn" data-action="${k}" onclick="submitBattleAction('${duelId}','${k}')">
        <span class="btl-action-icon">${a.icon}</span>
        <span class="btl-action-label">${a.label}</span>
      </button>`;
    }).join('');
    el('btl-status-msg').textContent = 'Choose your action!';
  }

  // --- ROUND LOG ---
  el('btl-log').innerHTML=(d.rounds||[]).map((r,i)=>{
    const myAct=r.choices?.[myId], oppAct=r.choices?.[oppId];
    const myWon=(myId===d.challenger&&r.bHit)||(myId===d.challenged&&r.aHit);
    const myLost=(myId===d.challenger&&r.aHit)||(myId===d.challenged&&r.bHit);
    const isTie=!r.aHit&&!r.bHit;
    return `<div class="btl-log-entry${myLost?' hit':''}">
      <span class="btl-log-round">Round ${i+1}</span>
      <span class="btl-log-actions">
        ${ACTIONS[myAct]?.icon||'?'}
        <span style="font-size:11px;color:rgba(255,255,255,0.3)">vs</span>
        ${ACTIONS[oppAct]?.icon||'?'}
      </span>
      <span class="btl-log-result">${r.txt||'—'}${myWon?' 🏆':myLost?' 💀':isTie?' 🤝':''}</span>
    </div>`;
  }).join('');
}

async function submitBattleAction(duelId, action) {
  const d=S.duels[duelId]; if(!d||d.status!=='active') return;
  if(d.pendingChoices?.[S.myId]){ toast('Already submitted!','error'); return; }
  clearActionTimer();
  await dRef(duelId).update({[`pendingChoices.${S.myId}`]:action});
  // The onSnapshot listener will trigger resolveRound() once both are in
}

async function resolveRound(duelId) {
  await db.runTransaction(async tx=>{
    const snap=await tx.get(dRef(duelId));
    const d=snap.data();
    if(d.status!=='active') return;
    const pc=d.pendingChoices||{};
    if(!pc[d.challenger]||!pc[d.challenged]) return;

    const aAct=pc[d.challenger], bAct=pc[d.challenged];
    const outcome=resolveRoundOutcome(aAct, bAct);

    // a = challenger, b = challenged
    const newRound={
      choices:{ [d.challenger]:aAct, [d.challenged]:bAct },
      txt:outcome.txt,
      aHit:outcome.aHit,
      bHit:outcome.bHit,
    };
    const newRounds=[...(d.rounds||[]), newRound];
    const newRound2=(d.currentRound||1)+1;

    // RPS best-of-3: first to 2 round wins takes the match
    const aWins=newRounds.filter(r=>r.bHit).length; // challenger wins = challenged lost
    const bWins=newRounds.filter(r=>r.aHit).length; // challenged wins = challenger lost
    let winner=null, newStatus='active';

    if(aWins>=2){ winner=d.challenger; newStatus='complete'; }
    else if(bWins>=2){ winner=d.challenged; newStatus='complete'; }
    else if(newRound2>3){
      if(aWins>bWins)      winner=d.challenger;
      else if(bWins>aWins) winner=d.challenged;
      else                 winner='tie';
      newStatus='complete';
    }

    // Winner gains, loser loses — 2pt transfer
    if(winner&&winner!=='tie'){
      const loserId=winner===d.challenger?d.challenged:d.challenger;
      const [wSnap,lSnap]=await Promise.all([tx.get(pRef(winner)),tx.get(pRef(loserId))]);
      const wPts=wSnap.data().points||0, lPts=lSnap.data().points||0;
      const lastLaugh=S.tiers[winner]==='peasant';
      const earned=lastLaugh?DUEL_WAGER*2:DUEL_WAGER;
      const lost=Math.min(DUEL_WAGER,lPts);
      tx.update(pRef(winner),  {points:wPts+earned});
      tx.update(pRef(loserId), {points:lPts-lost, nemesis:winner});
    }

    tx.update(dRef(duelId),{
      rounds:newRounds,
      pendingChoices:{},
      currentRound:Math.min(newRound2,3),
      winner,
      status:newStatus,
    });
  });
}

async function showRevealSequence(duelId, myId, oppId, upd) {
  _btlRevealing = true;
  const pc = upd.pendingChoices || {};
  const myAct  = pc[myId];
  const oppAct = pc[oppId];
  const myA  = ACTIONS[myAct]  || { icon:'?', label:'?' };
  const oppA = ACTIONS[oppAct] || { icon:'?', label:'?' };

  // Freeze both action areas — show "Locked in" state
  el('btl-actions-right').innerHTML = `<div class="btl-action-btn chosen">
    <span class="btl-action-icon">${myA.icon}</span>
    <span class="btl-action-label">${myA.label}</span>
  </div>`;
  el('btl-actions-left').innerHTML = `<div class="btl-action-btn chosen">
    <span class="btl-action-icon">?</span>
    <span class="btl-action-label">Hidden</span>
  </div>`;

  // 3-2-1 countdown in the impact zone
  const imp = el('btl-impact');
  const roundOutEl = el('btl-round-outcome');
  if (roundOutEl) roundOutEl.textContent = '';
  for (const num of ['3','2','1']) {
    imp.textContent = num;
    imp.classList.remove('pop'); void imp.offsetWidth; imp.classList.add('pop');
    el('btl-status-msg').textContent = `Revealing in ${num}…`;
    await delay(800);
  }

  // Reveal — show both choices
  imp.textContent = '⚡';
  imp.classList.remove('pop'); void imp.offsetWidth; imp.classList.add('pop');

  el('btl-actions-left').innerHTML = `<div class="btl-action-btn chosen">
    <span class="btl-action-icon">${oppA.icon}</span>
    <span class="btl-action-label">${oppA.label}</span>
  </div>`;

  el('btl-status-msg').textContent = `${myA.icon} ${myA.label}  vs  ${oppA.icon} ${oppA.label}`;
  await delay(900);

  // Determine round result locally for display
  const outcome = resolveRoundOutcome(
    myId===upd.challenger ? myAct : oppAct,
    myId===upd.challenger ? oppAct : myAct
  );
  // outcome from challenger/challenged perspective — translate to my perspective
  const iAmChallenger = myId === upd.challenger;
  const iWonRound  = iAmChallenger ? outcome.bHit : outcome.aHit;
  const iLostRound = iAmChallenger ? outcome.aHit : outcome.bHit;
  const isTie = !outcome.aHit && !outcome.bHit;

  if (isTie) {
    imp.textContent = '🤝';
    el('btl-status-msg').textContent = 'Tie!';
    if (roundOutEl) roundOutEl.textContent = '🤝 Tie — no points this round';
  } else if (iWonRound) {
    imp.textContent = '🏆';
    el('btl-status-msg').textContent = 'You win this round!';
    if (roundOutEl) roundOutEl.textContent = outcome.txt;
  } else {
    imp.textContent = '💀';
    el('btl-status-msg').textContent = 'They win this round!';
    if (roundOutEl) roundOutEl.textContent = outcome.txt;
  }
  imp.classList.remove('pop'); void imp.offsetWidth; imp.classList.add('pop');

  await delay(1200);

  // Resolve on server — this updates Firestore, which triggers onSnapshot
  await resolveRound(duelId);

  // Brief pause then hand control back to renderBattleScreen
  await delay(500);
  _btlRevealing = false;

  // Re-render to show the updated round / next round state
  const fresh = S.duels[duelId];
  if (fresh && fresh.status !== 'complete') {
    renderBattleScreen(duelId, myId, oppId);
    const nextRound = fresh.currentRound || 1;
    el('btl-status-msg').textContent = `Round ${nextRound} — Choose your action!`;
    const ro = el('btl-round-outcome'); if (ro) ro.textContent = '';
  }
}

async function showBattleEnd(d, myId, oppId) {
  // Brief dramatic pause then show result
  await delay(600);

  // Victory phrase speech bubble
  if (d.winner && d.winner !== 'tie') {
    const phrase = S.players[d.winner]?.victoryPhrase;
    if (phrase) {
      const bubbleId = d.winner === myId ? 'btl-bubble-right' : 'btl-bubble-left';
      const bubble = el(bubbleId);
      if (bubble) { bubble.textContent = phrase; bubble.classList.add('visible'); }
    }
  }

  el('btl-over').style.display='';
  const rt=el('btl-result-text'), pt=el('btl-pts-text');
  const myName = getDisplayName(myId), oppName = getDisplayName(oppId);

  // Show last round's outcome text
  const lastRound=d.rounds?.[d.rounds.length-1];
  const ro = el('btl-round-outcome');
  if (ro && lastRound) ro.textContent = lastRound.txt || '';

  if(d.winner===myId){
    const ll=S.tiers[myId]==='peasant', earned=ll?DUEL_WAGER*2:DUEL_WAGER;
    rt.textContent=`🎉 ${myName} wins!`; rt.className='btl-result-text result-win';
    pt.textContent=`+${earned}pts${ll?' — Last Laugh bonus!':''}`;
    showDelta(`+${earned}`,true);
    await checkBountyOnWin(myId,oppId);
    await addFeed(`${myName} beat ${oppName} at Rock Paper Scissors! (+${earned}pts)`,'✂️');
  } else if(d.winner===oppId){
    rt.textContent=`💀 ${oppName} wins!`; rt.className='btl-result-text result-lose';
    pt.textContent=`-${DUEL_WAGER}pts`;
  } else {
    rt.textContent='🤝 TIE'; rt.className='btl-result-text result-tie';
    pt.textContent='No points changed — it\'s a draw!';
    if(myId === d.challenger)
      await addFeed(`${myName} vs ${oppName} — Rock Paper Scissors tie!`,'🤝');
  }

  // Impact flash
  if(lastRound){
    const imp=el('btl-impact');
    imp.textContent = d.winner==='tie' ? '🤝' : lastRound.aHit||lastRound.bHit ? '🏆' : '🤝';
    imp.classList.remove('pop'); void imp.offsetWidth; imp.classList.add('pop');
  }
}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function closeBattleScreen(){
  if(_battleUnsub){ _battleUnsub(); _battleUnsub=null; }
  clearActionTimer();
  destroyBattleAnimators();
  _btlRevealing=false; _btlRevealKey='';
  el('btl-bubble-left').classList.remove('visible');
  el('btl-bubble-right').classList.remove('visible');
  el('battle-screen').style.display='none';
  S.battleDuelId=null;
}

// ---- Action timer ----
const BATTLE_ACTION_MS = 17000;
let _battleTimerInterval = null;

function startActionTimer(duelId) {
  clearActionTimer();
  const wrap=el('btl-timer-wrap'), bar=el('btl-timer-bar');
  if(!wrap||!bar) return;
  wrap.style.display='';
  bar.style.width='100%';
  bar.style.transition='none';
  void bar.offsetWidth;
  bar.style.transition='width 0.25s linear';
  const end=Date.now()+BATTLE_ACTION_MS;
  _battleTimerInterval=setInterval(()=>{
    const rem=Math.max(0,end-Date.now());
    bar.style.width=(rem/BATTLE_ACTION_MS*100)+'%';
    if(rem<=0){
      clearActionTimer();
      const d=S.duels[duelId];
      if(!d||d.pendingChoices?.[S.myId]||d.status!=='active') return;
      const avail=Object.keys(ACTIONS);
      const pick=avail[Math.floor(Math.random()*avail.length)];
      submitBattleAction(duelId,pick);
      toast(`Time's up! Auto-picked ${ACTIONS[pick].label}`,'info');
    }
  },80);
}

function clearActionTimer(){
  if(_battleTimerInterval){clearInterval(_battleTimerInterval);_battleTimerInterval=null;}
  const wrap=el('btl-timer-wrap');
  if(wrap) wrap.style.display='none';
}
async function rematchDuel(){
  const d=S.battleDuelId&&S.duels[S.battleDuelId]; if(!d) return;
  closeBattleScreen();
  await challengeToDuel(d.challenger===S.myId?d.challenged:d.challenger);
}

// ============================================================
// PLAYER AVATAR PICKER — replaces <select> dropdowns everywhere
// ============================================================
function playerPickerHTML(pickerId, players, selectedId='') {
  return `<div class="player-picker" id="picker-${pickerId}">
    ${players.map(p=>`
      <div class="player-pick-item${p.id===selectedId?' selected':''}" data-id="${p.id}" onclick="playerPickerSelect('${pickerId}','${p.id}')">
        <div class="ppi-avatar">${renderPlayer(p,36)}</div>
        <div class="ppi-name">${esc(getDisplayName(p.id))}</div>
        <div class="ppi-pts">${p.points??0}⭐</div>
      </div>`).join('')}
  </div>
  <input type="hidden" id="${pickerId}" value="${selectedId}"/>`;
}
const _pickerSelected={};
function playerPickerSelect(pickerId, playerId){
  _pickerSelected[pickerId]=playerId;
  const inp=el(pickerId); if(inp) inp.value=playerId;
  document.querySelectorAll(`#picker-${pickerId} .player-pick-item`).forEach(el2=>{
    el2.classList.toggle('selected', el2.dataset.id===playerId);
  });
}

// ============================================================
// CURSES
// ============================================================
let selectedCurse=null;
function updateCurseSelect(){
  const wrap=el('curse-target-wrap'); if(!wrap) return;
  const others=Object.values(S.players).filter(p=>p.id!==S.myId);
  wrap.innerHTML=playerPickerHTML('curse-target-select', others);
}
async function castCurse(targetId,type){
  const target=S.players[targetId]; if(!target){toast('Player not found','error');return;}
  if(S.tiers[targetId]==='peasant'){toast('Cannot curse the Peasant','error');return;}
  const cfg=CURSE_CONFIG[type]; if(!cfg) return;
  if((S.me?.points||0)<cfg.cost){toast(`Need ${cfg.cost}pts`,'error');return;}
  if(type==='poke'){
    // Write brief curseActive so the target's device shows the popup
    await pRef(targetId).update({curseActive:{type:'poke',castBy:S.myId,castAt:Date.now(),expiresAt:Date.now()+8000}});
    await addFeed(`${S.me.name} poked ${target.name}! 👉`,'👉',{poke:true,target:targetId});
    toast(`Poked ${target.name}!`,'success'); return;
  }
  const expiresAt=cfg.dur>0?Date.now()+cfg.dur:null;
  const batch=db.batch();
  if(cfg.cost>0) batch.update(pRef(S.myId),{points:INC(-cfg.cost)});
  batch.update(pRef(targetId),{curseActive:{type,castBy:S.myId,castAt:Date.now(),expiresAt}});
  await batch.commit();
  await addFeed(`${S.me.name} cast ${cfg.label} on ${target.name}!`,cfg.icon,{curse:type,target:targetId,caster:S.myId});
  toast(`${cfg.label} cast!`,'success');
  if(cfg.cost>0) showDelta(`-${cfg.cost}`,false);
}
function checkExpiredCurses(){
  Object.values(S.players).forEach(async p=>{
    if(p.curseActive?.expiresAt&&Date.now()>p.curseActive.expiresAt)
      await pRef(p.id).update({curseActive:null});
  });
}
function renderActiveCurses(){
  const list=el('active-curses-list'); if(!list) return;
  const cursed=Object.values(S.players).filter(p=>p.curseActive?.expiresAt&&Date.now()<p.curseActive.expiresAt);
  list.innerHTML=cursed.length?cursed.map(p=>{
    const c=p.curseActive, cfg=CURSE_CONFIG[c.type];
    return `<div class="card" style="margin-bottom:8px;display:flex;align-items:center;gap:10px">
      <span style="font-size:22px">${cfg?.icon||'🧿'}</span>
      <div><div style="font-weight:600">${esc(getDisplayName(p.id))}</div>
        <div style="font-size:12px;color:var(--text-dim)">${cfg?.label} — ${fmtLeft(c.expiresAt-Date.now())} left</div></div>
    </div>`;
  }).join(''):'<div class="empty-state" style="padding:20px"><p>No active curses</p></div>';
}

// ============================================================
// VOTING
// ============================================================
function openVoteModal(){
  const others=Object.values(S.players).filter(p=>p.id!==S.myId);
  openModal('Start a Vote',`
    <div class="form-group"><label class="form-label">Vote type</label>
      <select id="vtype">
        <option value="exile">🚫 Exile a player (3pt loss + 24h ban)</option>
        <option value="impeach">⚖️ Impeach Head Council (removes tax 48h)</option>
        <option value="dictator">👑 Elect a Dictator (special power)</option>
      </select></div>
    <div class="form-group" id="vtarget-wrap"><label class="form-label">Target (Exile only)</label>
      ${playerPickerHTML('vtarget', others)}
    </div>`,
  async()=>{
    const type=el('vtype').value, targetId=type==='exile'?el('vtarget').value:null;
    if(type==='exile'&&!targetId){toast('Select target','error');return false;}
    await startVote(type,targetId);
  });
}
async function startVote(type,targetId){
  const id=newId('votes');
  await vRef(id).set({type,target:targetId||null,initiatedBy:S.myId,
    initiators:{[S.myId]:true},votes:{},status:'open',result:null,createdAt:ts(),
    closesAt:Date.now()+DAILY_MS});
  const tName=targetId?` against ${getDisplayName(targetId)}`:'';
  await addFeed(`${S.me.name} started a ${type} vote${tName}!`,'🗳️');
  toast('Vote started!','success');
}
async function castVote(voteId,choice){
  const v=S.votes[voteId]; if(!v||v.status!=='open') return;
  if(v.votes[S.myId]!==undefined){toast('Already voted','error');return;}
  await vRef(voteId).update({[`votes.${S.myId}`]:choice});
  toast('Vote cast!','success'); checkVoteClosures();
}
async function checkVoteClosures(){
  for(const v of Object.values(S.votes)){
    if(v.status!=='open'||Date.now()<(v.closesAt||0)) continue;
    await resolveVote(v.id);
  }
}
async function resolveVote(voteId){
  const v=S.votes[voteId]; if(!v||v.status!=='open') return;
  const total=Object.keys(S.players).length;
  const vvals=Object.values(v.votes||{});
  const yes=vvals.filter(x=>x==='yes').length, no=vvals.filter(x=>x==='no').length;
  const majority=Math.floor(total/2)+1;
  let result='no_majority';
  const batch=db.batch();
  if(v.type==='exile'){
    if(yes>=majority&&yes>no){
      result='exiled';
      batch.update(pRef(v.target),{points:INC(-3),exiledUntil:Date.now()+DAILY_MS});
      await addFeed(`${getDisplayName(v.target)} was exiled! -3pts, 24h ban`,'🚫');
    } else await addFeed(`Exile vote against ${getDisplayName(v.target)} failed`,'🗳️');
  } else if(v.type==='impeach'){
    const initCount=Object.keys(v.initiators||{}).length;
    if(initCount>=3&&yes>=majority){
      result='impeached';
      const cId=Object.entries(S.tiers).find(([,t])=>t==='council')?.[0];
      if(cId){batch.update(pRef(cId),{taxBlockedUntil:Date.now()+172800000});
        await addFeed(`Head Council ${getDisplayName(cId)} was impeached! Tax blocked 48h`,'⚖️');}
    } else await addFeed('Impeachment failed — need 3+ initiators and majority','🗳️');
  } else if(v.type==='dictator'){
    const cands={};
    vvals.forEach(x=>{if(x&&x!=='yes'&&x!=='no') cands[x]=(cands[x]||0)+1;});
    const winner=Object.entries(cands).sort(([,a],[,b])=>b-a)[0];
    if(winner){result=winner[0];
      batch.update(pRef(winner[0]),{dictatorPower:{used:false,grantedAt:Date.now()}});
      await addFeed(`${getDisplayName(winner[0])} elected Dictator! They hold a special power.`,'👑');}
  }
  batch.update(vRef(voteId),{status:'closed',result});
  await batch.commit();
}

// ============================================================
// BOUNTIES
// ============================================================
function openBountyModal(){
  if((S.me?.points||0)<BOUNTY_COST){toast(`Need ${BOUNTY_COST}pts`,'error');return;}
  const others=Object.values(S.players).filter(p=>p.id!==S.myId);
  openModal('Place a Bounty',`
    <p style="font-size:13px;color:var(--text-dim);margin-bottom:12px">Spend ${BOUNTY_COST}pts. Next cousin to beat them in a duel gets +${BOUNTY_BONUS} bonus.</p>
    <div class="form-group"><label class="form-label">Target</label>
      ${playerPickerHTML('bt', others)}</div>`,
  async()=>{
    const tId=el('bt').value;
    if(Object.values(S.bounties).some(b=>b.target===tId)){toast('Bounty already exists','error');return false;}
    await adjustPts(S.myId,-BOUNTY_COST);
    const id=newId('bounties');
    await boRef(id).set({target:tId,placedBy:S.myId,bonusPoints:BOUNTY_BONUS,status:'active',claimedBy:null,createdAt:ts(),expiresAt:Date.now()+BOUNTY_EXPIRE_MS});
    await addFeed(`🎯 ${S.me.name} placed a bounty on ${getDisplayName(tId)}!`,'🎯');
    toast('Bounty placed!','success'); showDelta(`-${BOUNTY_COST}`,false);
  });
}
async function checkBountyOnWin(wId,lId){
  const b=Object.values(S.bounties).find(b2=>b2.target===lId&&b2.status==='active');
  if(!b) return;
  await boRef(b.id).update({status:'claimed',claimedBy:wId});
  await adjustPts(wId,b.bonusPoints);
  await addFeed(`🎯 ${getDisplayName(wId)} claimed the bounty on ${getDisplayName(lId)}! +${b.bonusPoints}pts`,'🎯');
  toast(`+${b.bonusPoints} bounty bonus!`,'success');
}

// ============================================================
// DICTATOR POWERS
// ============================================================
async function useDictatorPower(power){
  if(!S.me?.dictatorPower||S.me.dictatorPower.used){toast('No power available','error');return;}
  const others=Object.values(S.players).filter(p=>p.id!==S.myId);
  if(power==='steal5'){
    openModal('Steal 5 Points', playerPickerHTML('dpt', others),
    async()=>{
      const tId=el('dpt').value, tRef=pRef(tId);
      let stolen=0;
      await db.runTransaction(async tx=>{
        const [td,md]=await Promise.all([tx.get(tRef),tx.get(pRef(S.myId))]);
        stolen=Math.min(5,td.data().points||0);
        if(stolen>0){tx.update(tRef,{points:(td.data().points||0)-stolen});tx.update(pRef(S.myId),{points:(md.data().points||0)+stolen});}
      });
      await pRef(S.myId).update({dictatorPower:null});
      await addFeed(`👑 Dictator ${S.me.name} stole ${stolen}pts from ${getDisplayName(tId)}!`,'👑');
      toast(`Stolen ${stolen}pts!`,'success');
    });
  } else if(power==='point_freeze'){
    openModal('Freeze Points',`<p style="font-size:13px;color:var(--text-dim);margin-bottom:12px;font-weight:700">Target's points locked for 24h.</p>`+playerPickerHTML('dpt', others),
    async()=>{
      const tId=el('dpt').value;
      await pRef(tId).update({pointsFrozenUntil:Date.now()+DAILY_MS});
      await pRef(S.myId).update({dictatorPower:null});
      await addFeed(`👑 Dictator ${S.me.name} froze ${getDisplayName(tId)}'s points for 24h!`,'🧊');
      toast('Points frozen!','success');
    });
  } else if(power==='reverse_day'){
    if(!confirm('Declare a REVERSE DAY? Lowest score becomes #1 for 24h!')) return;
    await db.collection('meta').doc('settings').set({reverseDay:Date.now()+DAILY_MS},{merge:true});
    await pRef(S.myId).update({dictatorPower:null});
    await addFeed(`👑 Dictator ${S.me.name} declared REVERSE DAY! Lowest score = #1!`,'🔄');
    toast('Reverse Day!','success');
  }
}

// ============================================================
// CALL OUT
// ============================================================
// ============================================================
// FEED
// ============================================================
async function addFeed(text, icon, meta={}){
  try {
    const feedDoc = {text,icon:icon||'📜',comments:[],timestamp:ts(),...meta};
    await db.collection('feed').doc(newId('feed')).set(feedDoc);
  } catch(e){ console.error('feed',e); }
}

function showCurseAlert(type, casterName) {
  const cfg = CURSE_CONFIG[type];
  if(!cfg) return;
  const d = document.createElement('div');
  d.className = 'curse-alert-popup';
  d.innerHTML = `<div class="cap-icon">${cfg.icon}</div>
    <div class="cap-title">You've been cursed!</div>
    <div class="cap-desc"><b>${casterName}</b> cast <b>${cfg.label}</b> on you</div>
    <div class="cap-sub">${cfg.dur ? fmtLeft(cfg.dur)+' duration' : 'Instant'}</div>`;
  document.body.appendChild(d);
  setTimeout(()=>{ d.classList.add('cap-out'); setTimeout(()=>d.remove(),400); }, 3200);
}

function showPokeAlert(senderName) {
  const d = document.createElement('div');
  d.className = 'curse-alert-popup poke-popup';
  d.innerHTML = `<div class="cap-icon">👉</div>
    <div class="cap-title">You got poked!</div>
    <div class="cap-desc"><b>${senderName}</b> poked you</div>`;
  document.body.appendChild(d);
  setTimeout(()=>{ d.classList.add('cap-out'); setTimeout(()=>d.remove(),400); }, 2500);
}

// Track previous curse/poke state to detect changes
let _prevCurse = null;
function checkForIncomingCurse() {
  const me = S.me;
  if(!me) return;
  const c = me.curseActive;
  const castKey = c ? `${c.type}-${c.castAt}` : null;
  if(castKey && castKey !== _prevCurse) {
    _prevCurse = castKey;
    const casterName = c.castBy ? getDisplayName(c.castBy) : 'Someone';
    if(c.type === 'poke') showPokeAlert(casterName);
    else showCurseAlert(c.type, casterName);
  }
  if(!c) _prevCurse = null;
}
const FEED_TTL_MS = 43200000; // 12 hours


async function pruneFeed() {
  const cutoff = Date.now() - FEED_TTL_MS;
  const old = S.feed.filter(e => {
    const t = e.timestamp?.toMillis?.() || 0;
    return t < cutoff;
  });
  const batch = db.batch();
  old.forEach(e => batch.delete(fRef(e.id)));
  if(old.length) await batch.commit();
}
function renderFeed(){
  const list=el('feed-list'); if(!list) return;
  const pending=Object.values(S.duels).filter(d=>d.challenged===S.myId&&d.status==='pending');
  const openVotes=Object.values(S.votes).filter(v=>v.status==='open');
  let extra='';

  // Pending duel challenges
  extra+=pending.map(d=>`
    <div class="card card-gold" style="margin-bottom:10px">
      <div style="font-family:'Cinzel',serif;font-size:13px;margin-bottom:8px">⚔️ ${esc(getDisplayName(d.challenger))} challenges you to a duel!</div>
      <div class="bet-actions">
        <button class="btn-gold btn-sm" onclick="acceptDuel('${d.id}')">Accept</button>
        <button class="btn-outline btn-sm" onclick="declineDuel('${d.id}')">Decline</button>
      </div></div>`).join('');

  // Open votes
  extra+=openVotes.filter(v=>v.votes[S.myId]===undefined).map(v=>{
    const tl=fmtLeft((v.closesAt||0)-Date.now());
    const tName=v.target?` vs ${esc(getDisplayName(v.target))}` :'';
    let opts='';
    if(v.type==='dictator'){
      opts=Object.values(S.players).filter(p=>p.id!==S.myId).map(p=>
        `<button class="btn-outline btn-sm" onclick="castVote('${v.id}','${p.id}')">${esc(p.name)}</button>`
      ).join('');
    } else {
      opts=`<button class="btn-green btn-sm" onclick="castVote('${v.id}','yes')">✓ Yes</button>
            <button class="btn-red btn-sm" onclick="castVote('${v.id}','no')">✗ No</button>`;
    }
    return `<div class="card" style="margin-bottom:10px;border-color:#8b5cf6">
      <div style="font-size:13px;color:var(--text-bright);margin-bottom:6px">🗳️ <b>${v.type.toUpperCase()}</b>${tName} — ${tl} left</div>
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px">${Object.keys(v.votes||{}).length} votes cast</div>
      <div class="bet-actions">${opts}</div></div>`;
  }).join('');

  // Dictator power banner
  if(S.me?.dictatorPower&&!S.me.dictatorPower.used){
    extra+=`<div class="card card-gold" style="margin-bottom:10px">
      <div style="font-family:'Cinzel',serif;color:var(--gold-bright);margin-bottom:8px">👑 You are Dictator — use your power!</div>
      <div class="bet-actions">
        <button class="btn-gold btn-sm" onclick="useDictatorPower('steal5')">Steal 5pts</button>
        <button class="btn-outline btn-sm" onclick="useDictatorPower('point_freeze')">Freeze Points</button>
        <button class="btn-outline btn-sm" onclick="useDictatorPower('reverse_day')">Reverse Day</button>
      </div></div>`;
  }

  const feedHtml=S.feed.map(e=>{
    const isCurse = e.curse && e.target === S.myId;
    const isPoke  = e.poke  && e.target === S.myId;
    return `<div class="feed-entry${isCurse?' feed-entry-curse':''}${isPoke?' feed-entry-poke':''}">
      <div class="feed-icon">${e.icon||'📜'}</div>
      <div class="feed-content">
        <div class="feed-text">${esc(e.text)}</div>
        <div class="feed-time">${fmtAgo(e.timestamp)}</div>
      </div></div>`;
  }).join('')||'<div class="empty-state"><div class="empty-icon">📜</div><p>Nothing yet…</p></div>';

  list.innerHTML=extra+feedHtml;
}

// ============================================================
// NOTIFICATIONS
// ============================================================
function updateNotifBadge(){
  const badge=el('notif-badge'); if(!badge) return;
  const myName=S.me?.name||'';
  const n=S.feed.filter(e=>{
    const t=e.timestamp?.toMillis?.()||0;
    return t>S.lastFeedSeen&&myName&&e.text?.includes(myName);
  }).length;
  badge.style.display=n>0?'flex':'none';
  if(n>0) badge.textContent=n;
}
function updateTabDots(){
  const hasPending=Object.values(S.duels).some(d=>d.challenged===S.myId&&d.status==='pending');
  const dd=el('dot-duels'); if(dd) dd.style.display=hasPending?'block':'none';
  const hasUnvotedBets=Object.values(S.bets).some(b=>b.status==='open'&&!b.votes?.[S.myId]&&b.subject!==S.myId);
  const db2=el('dot-bets'); if(db2) db2.style.display=hasUnvotedBets?'block':'none';
}
function markFeedSeen(){
  S.lastFeedSeen=Date.now();
  localStorage.setItem('cp_last_feed',String(S.lastFeedSeen));
  updateNotifBadge(); updateTabDots();
}

// ============================================================
// CHAT


// ============================================================
// MODAL & TOAST
// ============================================================
let _modalFn=null;
function openModal(title,bodyHTML,onConfirm){
  el('modal-title').textContent=title;
  el('modal-body').innerHTML=bodyHTML+`<div class="modal-actions">
    <button class="btn-gold" onclick="confirmModal()">Confirm</button>
    <button class="btn-outline" onclick="closeModal()">Cancel</button></div>`;
  _modalFn=onConfirm;
  el('modal-overlay').style.display='flex';
}
async function confirmModal(){
  if(!_modalFn) return closeModal();
  const r=await _modalFn();
  if(r!==false) closeModal();
}
function closeModal(){el('modal-overlay').style.display='none';_modalFn=null;}

function toast(msg,type='info'){
  const c=el('toast-container'), d=document.createElement('div');
  d.className=`toast ${type}`; d.textContent=msg;
  c.appendChild(d);
  setTimeout(()=>{d.style.opacity='0';d.style.transition='opacity .3s';setTimeout(()=>d.remove(),300);},3000);
}
function showDelta(label,pos){
  const d=document.createElement('div');
  d.className=`pt-delta ${pos?'pos':'neg'}`; d.textContent=label;
  d.style.cssText='left:50%;top:30%;transform:translateX(-50%);position:fixed;z-index:9999;pointer-events:none;font-family:Cinzel,serif;font-size:20px;font-weight:700;animation:ptFloat 1.2s ease forwards';
  d.style.color=pos?'var(--green-bright)':'var(--red-bright)';
  document.body.appendChild(d); setTimeout(()=>d.remove(),1300);
}

// ============================================================
// TABS
// ============================================================
function switchTab(name){
  S.tab=name;
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
  const panel=el(`tab-${name}`); if(panel) panel.classList.add('active');
  if(name==='bets')   renderBets();
  if(name==='duels')  {renderDuels();renderDuelPlayersList();}
  if(name==='curses') {renderActiveCurses();updateCurseSelect();}
  if(name==='feed')   {renderFeed();markFeedSeen();}

}

// ============================================================
// EVENT LISTENERS
// ============================================================
document.addEventListener('DOMContentLoaded',()=>{
  // Join screen / avatar edit
  el('join-btn')?.addEventListener('click',()=>{
    if(el('join-screen').classList.contains('edit-mode')) saveAvatarEdit();
    else handleJoin();
  });
  el('name-input')?.addEventListener('keydown',e=>{if(e.key==='Enter')handleJoin();});

  // Tabs
  document.querySelectorAll('.tab-btn').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));

  // Leaderboard actions
  el('btn-daily')?.addEventListener('click',claimDaily);
  el('btn-tax')?.addEventListener('click',collectTax);
  el('btn-peasant-penalty')?.addEventListener('click',applyPeasantPenalty);
  el('btn-place-bounty')?.addEventListener('click',openBountyModal);
  el('btn-start-vote')?.addEventListener('click',openVoteModal);

  // Bets
  el('btn-create-bet')?.addEventListener('click',openCreateBetModal);

  // Curses
  document.querySelectorAll('.curse-card').forEach(c=>c.addEventListener('click',()=>{
    document.querySelectorAll('.curse-card').forEach(x=>x.classList.remove('selected'));
    c.classList.add('selected'); selectedCurse=c.dataset.curse;
  }));
  el('btn-cast-curse')?.addEventListener('click',()=>{
    const t=el('curse-target-select').value;
    if(!t){toast('Select a target','error');return;}
    if(!selectedCurse){toast('Select a curse','error');return;}
    castCurse(t,selectedCurse);
  });

  // Feed
  el('notif-btn')?.addEventListener('click',()=>{switchTab('feed');markFeedSeen();});

  init();
});

// Expose for inline onclick handlers
Object.assign(window,{
  voteOnBet,lockBet,reportBetOutcome,acceptDuel,declineDuel,openBattleScreen,
  challengeToDuel,castVote,closeModal,confirmModal,useDictatorPower,
  submitBattleAction,closeBattleScreen,playerPickerSelect,
  avbSetColor,avbSetCategory,avbSelectTile,
  openAvatarEdit,cancelAvatarEdit,saveAvatarEdit,
  startFromLanding,
});
