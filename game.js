'use strict';

// ---------- Rules ----------
const W = 480, H = 600;
const GROUND = H - 44;         // 단어가 여기 닿으면 땅이 깎인다
const HP_MAX = 10;
const PER_LEVEL = 12;          // 이만큼 맞히면 다음 단계
const DISPLAY = '"Jua", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
const FONT = `21px ${DISPLAY}`;
const PAD = 13, ICON_W = 24;   // 단어 이름표 안쪽 여백, 특수 단어 아이콘 자리

const START_Y = 62;            // 단어가 나타나는 높이 (구름 아래)
// 바닥까지 걸리는 시간으로 정한다: 1단계 약 19초, 단계마다 빨라짐 (봇 테스트로 맞춘 값)
const fallTime = (lv) => 540 / (22 + lv * 7);
const fallSpeed = (lv) => (GROUND - START_Y) / fallTime(lv);   // px/s
// 단계마다 '이 속도로 치면 따라잡는다'는 목표 타/분을 정하고, 그 단계에 나오는 단어의 평균 타수로
// 나오는 간격을 거꾸로 계산한다. 1단계 95, 4단계 170, 8단계 270, 12단계 370타/분.
const targetTpm = (lv) => 70 + lv * 25;
const REACTION = 0.3;                                          // 단어를 보고 치기 시작할 때까지
function spawnGap(lv, avgStrokes) {
  return Math.max(0.5, (avgStrokes * 60) / targetTpm(lv) + REACTION);
}
// 단계별 단어 묶음(짧은 → 긴) 비율
function tierWeights(lv) {
  const w3 = Math.min(0.45, Math.max(0, (lv - 4) * 0.07));
  const w2 = Math.min(0.6, (lv - 1) * 0.1);
  return [Math.max(0.15, 1 - w2 - w3), w2, w3];
}

// 특수 단어: 맞히면 효과. 아이콘은 입력하지 않아도 된다.
const SPECIALS = {
  freeze: { icon: '❄️', color: '#2f8fe0', tag: '#bfe7ff', name: '얼리기', desc: '3초 동안 멈춤' },
  bomb: { icon: '💥', color: '#e0325a', tag: '#ffc4cf', name: '번개', desc: '화면의 단어 모두 없애기' },
  heal: { icon: '🌱', color: '#1f9e4a', tag: '#c6f7d3', name: '새싹', desc: '땅 1칸 회복' },
};
const SPECIAL_CHANCE = 0.08;
const FREEZE_TIME = 3;

// 타수: 한글은 자모를 친 횟수로 센다 (겹모음·겹받침은 두 번, 쌍자음은 한 번)
const DOUBLE_VOWEL = new Set([9, 10, 11, 14, 15, 16, 19]);          // ㅘ ㅙ ㅚ ㅝ ㅞ ㅟ ㅢ
const DOUBLE_FINAL = new Set([3, 5, 6, 9, 10, 11, 12, 13, 14, 15, 18]); // ㄳ ㄵ ㄶ ㄺ ㄻ ㄼ ㄽ ㄾ ㄿ ㅀ ㅄ
function strokes(word) {
  let n = 0;
  for (const ch of word) {
    const c = ch.charCodeAt(0) - 0xac00;
    if (c < 0 || c > 11171) { n++; continue; }
    const vowel = ((c / 28) | 0) % 21, final = c % 28;
    n += 1 + (DOUBLE_VOWEL.has(vowel) ? 2 : 1);
    if (final) n += DOUBLE_FINAL.has(final) ? 2 : 1;
  }
  return n;
}

if (typeof document === 'undefined') {
  module.exports = { strokes, fallSpeed, spawnGap, targetTpm, tierWeights, GROUND };
} else {
// ---------- Canvas ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const input = document.getElementById('typing');
const $ = (id) => document.getElementById(id);

function fit() {
  // 모바일은 키보드가 올라오면 보이는 높이가 줄어든다
  const vh = window.visualViewport ? window.visualViewport.height : innerHeight;
  const hudH = 58, inputH = 78;   // 위 점수판, 아래 입력칸 (테두리·그림자 포함)
  const scale = Math.min((innerWidth - 28) / W, (vh - 28 - hudH - inputH) / H);
  const cssW = Math.floor(W * scale), cssH = Math.floor(H * scale);
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  $('col').style.width = Math.min(innerWidth - 16, Math.max(cssW, 300)) + 'px';
}
addEventListener('resize', fit);
if (window.visualViewport) visualViewport.addEventListener('resize', fit);

// ---------- Storage ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};
const BEST_KEY = 'sonagiBest';     // 최고 점수 (로비 카드)
const TPM_KEY = 'sonagiTpm';       // 언어별 최고 타/분 { ko, en }
function loadTpm() { try { return JSON.parse(store.get(TPM_KEY)) || {}; } catch (_) { return {}; } }

// ---------- Sound ----------
let audio = null;
let muted = store.get('sonagiMuted') === '1';
function tone(freq, dur, type = 'sine', vol = 0.12, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + dur);
  } catch (_) {}
}
const sfx = {
  hit: (combo) => tone(660 + Math.min(combo, 12) * 40, 0.08, 'sine', 0.12, 300),
  wrong: () => tone(180, 0.12, 'square', 0.06, -60),
  miss: () => tone(140, 0.25, 'triangle', 0.14, -70),
  level: () => [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.14, 'square', 0.06), i * 90)),
  freeze: () => tone(1200, 0.4, 'sine', 0.08, -600),
  bomb: () => tone(90, 0.5, 'sawtooth', 0.12, -40),
  heal: () => [700, 900].forEach((f, i) => setTimeout(() => tone(f, 0.12, 'sine', 0.1), i * 80)),
  over: () => [392, 330, 262, 196].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'triangle', 0.1), i * 180)),
};

// ---------- Game state ----------
let state = 'title';           // title | play | paused | over
let lang = store.get('sonagiLang') || 'ko';
let startLevel = Number(store.get('sonagiStart')) || 1;
let words = [];                // { text, x, y, w, special }
let score = 0, level = 1, hp = HP_MAX;
let cleared = 0, combo = 0, maxCombo = 0, wrongs = 0, missed = 0;
let typed = 0, playTime = 0;   // 맞힌 단어의 타수, 실제로 플레이한 시간
let spawnIn = 0, frozen = 0;
let splashes = [], texts = [], banner = null;
let best = Number(store.get(BEST_KEY)) || 0;

const rain = Array.from({ length: 90 }, () => ({ x: Math.random() * W, y: Math.random() * H, v: 500 + Math.random() * 300, l: 8 + Math.random() * 10 }));

// 지금 단계에서 나올 단어의 평균 타수 (언어·묶음 비율에 따라 다르다)
const tierAvg = {};
function avgStrokes(lv) {
  if (!tierAvg[lang]) tierAvg[lang] = WORDS[lang].map((t) => t.reduce((a, w) => a + strokes(w), 0) / t.length);
  const ws = tierWeights(lv);
  const sum = ws.reduce((a, b) => a + b, 0);
  return ws.reduce((a, w, i) => a + w * tierAvg[lang][i], 0) / sum;
}

function pickWord() {
  const tiers = WORDS[lang];
  const ws = tierWeights(level);
  let r = Math.random() * ws.reduce((a, b) => a + b, 0), tier = 0;
  while (tier < ws.length - 1 && (r -= ws[tier]) > 0) tier++;
  const pool = tiers[tier];
  // 화면에 이미 떠 있는 단어는 피한다 (같은 단어 두 개면 헷갈린다)
  for (let k = 0; k < 10; k++) {
    const w = pool[Math.floor(Math.random() * pool.length)];
    if (!words.some((x) => x.text === w)) return w;
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

function spawn() {
  const text = pickWord();
  const special = level >= 2 && Math.random() < SPECIAL_CHANCE
    ? ['freeze', 'bomb', 'heal'][Math.floor(Math.random() * 3)] : null;
  ctx.font = FONT;
  const w = ctx.measureText(text).width + PAD * 2 + (special ? ICON_W : 0);
  // 막 나온 단어들과 겹치지 않는 자리를 몇 번 찾아본다
  let x = 0;
  for (let k = 0; k < 8; k++) {
    x = 10 + Math.random() * (W - 20 - w);
    if (!words.some((o) => o.y < 110 && x < o.x + o.w + 10 && o.x < x + w + 10)) break;
  }
  words.push({ text, x, y: START_Y, w, special });
}

function startGame() {
  words = [];
  score = 0;
  level = startLevel;
  hp = HP_MAX;
  cleared = combo = maxCombo = wrongs = missed = 0;
  typed = 0;
  playTime = 0;
  spawnIn = 0.3;
  frozen = 0;
  splashes = [];
  texts = [];
  banner = { text: `LEVEL ${level}`, t: 0 };
  state = 'play';
  input.value = '';
  hideOverlay();
  updateHud();
  input.focus();
}

function levelFor(n) { return startLevel + Math.floor(n / PER_LEVEL); }

function submit(raw) {
  const v = raw.trim();
  if (!v || state !== 'play') return;
  // 같은 단어가 여럿이면 땅에 가장 가까운 것부터
  let hit = null;
  for (const w of words) if (w.text === v && (!hit || w.y > hit.y)) hit = w;
  if (!hit) {
    wrongs++;
    combo = 0;
    sfx.wrong();
    flashInput('wrong');
    updateHud();
    return;
  }
  words = words.filter((w) => w !== hit);
  cleared++;
  combo++;
  maxCombo = Math.max(maxCombo, combo);
  const st = strokes(hit.text);
  typed += st;
  const gain = st * (5 + level) + (combo >= 5 ? Math.floor(combo / 5) * 10 : 0);
  addScore(gain);
  texts.push({ text: `+${gain}${combo >= 5 ? ` · ${combo}콤보` : ''}`, x: hit.x + hit.w / 2, y: hit.y, t: 0 });
  pop(hit.x + hit.w / 2, hit.y, hit.special ? SPECIALS[hit.special].color : '#bfe3ff', 14);
  sfx.hit(combo);
  flashInput('right');

  if (hit.special === 'freeze') { frozen = FREEZE_TIME; sfx.freeze(); banner = { text: '❄️ 얼음!', t: 0 }; }
  if (hit.special === 'heal') { hp = Math.min(HP_MAX, hp + 1); sfx.heal(); banner = { text: '🌱 땅 회복', t: 0 }; }
  if (hit.special === 'bomb') {
    sfx.bomb();
    banner = { text: '💥 번개!', t: 0 };
    for (const w of words) {
      const g = strokes(w.text) * (5 + level);
      addScore(g);
      pop(w.x + w.w / 2, w.y, '#ffe27a', 8);
      cleared++;
    }
    words = [];
  }

  const lv = levelFor(cleared);
  if (lv > level) {
    level = lv;
    banner = { text: `LEVEL ${level}`, t: 0 };
    sfx.level();
  }
  updateHud();
}

function addScore(n) {
  score += n;
  if (score > best) { best = score; store.set(BEST_KEY, String(best)); }
}

function pop(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = 60 + Math.random() * 120;
    splashes.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, life: 0.5 + Math.random() * 0.3, color });
  }
}

let flashTimer = 0;
function flashInput(kind) {
  input.classList.remove('wrong', 'right');
  void input.offsetWidth;   // 같은 애니메이션을 다시 재생하려면 한 번 레이아웃을 거쳐야 한다
  input.classList.add(kind);
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => input.classList.remove(kind), 300);
}

function tpm() {
  return playTime > 3 ? Math.round(typed / (playTime / 60)) : 0;
}

function update(dt) {
  for (const d of rain) {
    d.y += d.v * dt * (frozen > 0 ? 0.15 : 1);
    d.x -= d.v * dt * 0.12 * (frozen > 0 ? 0.15 : 1);
    if (d.y > H) { d.y = -d.l; d.x = Math.random() * (W + 60); }
  }
  for (const s of splashes) { s.life -= dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 400 * dt; }
  splashes = splashes.filter((s) => s.life > 0);
  for (const t of texts) { t.t += dt; t.y -= 26 * dt; }
  texts = texts.filter((t) => t.t < 0.9);
  if (banner) { banner.t += dt; if (banner.t > 1.4) banner = null; }
  if (state !== 'play') return;

  playTime += dt;
  if (frozen > 0) { frozen -= dt; return; }

  spawnIn -= dt;
  if (spawnIn <= 0) { spawn(); spawnIn = spawnGap(level, avgStrokes(level)); }

  const v = fallSpeed(level);
  for (const w of words) w.y += v * dt;
  const landed = words.filter((w) => w.y >= GROUND);
  if (landed.length) {
    words = words.filter((w) => w.y < GROUND);
    for (const w of landed) {
      hp--;
      missed++;
      combo = 0;
      pop(w.x + w.w / 2, GROUND, '#6fa8ff', 16);
      sfx.miss();
    }
    if (hp <= 0) { hp = 0; gameOver(); }
    updateHud();
  }
}

function gameOver() {
  state = 'over';
  sfx.over();
  const speed = tpm();
  const bestTpm = loadTpm();
  const newTpm = speed > (bestTpm[lang] || 0);
  if (newTpm) { bestTpm[lang] = speed; store.set(TPM_KEY, JSON.stringify(bestTpm)); }
  const acc = cleared + wrongs ? Math.round((cleared / (cleared + wrongs)) * 100) : 0;
  input.blur();
  setTimeout(() => {
    showOverlay(`
      <h2 class="inked">땅이 다 잠겼어요</h2>
      <div class="big inked">${score.toLocaleString()}</div>
      <span class="tag">${score >= best && score > 0 ? '🏆 최고 점수!' : `최고 점수 ${best.toLocaleString()}`}</span>
      <dl class="stats">
        <dt>단계</dt><dd>${level}</dd>
        <dt>맞힌 단어</dt><dd>${cleared}개</dd>
        <dt>타/분</dt><dd>${speed}${newTpm && speed ? ' 🏆' : ''}</dd>
        <dt>정확도</dt><dd>${acc}%</dd>
        <dt>최대 콤보</dt><dd>${maxCombo}</dd>
      </dl>
      <button class="main" data-act="start">다시 하기</button>
      <button class="sub" data-act="menu">← 처음으로</button>`);
  }, 600);
}

// ---------- Draw ----------
// 스티커 느낌: 진한 남보라 테두리 + 아래로 떨어진 그림자
const INK = '#2b1d52';
function roundRect(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function label(text, x, y, size, fill = '#fff', align = 'center') {
  ctx.font = `${size}px ${DISPLAY}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(3, size * 0.2);
  ctx.strokeStyle = INK;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

// 뭉게구름: 동그라미 몇 개를 겹쳐 테두리까지
function cloud(cx, cy, s) {
  const bumps = [[-1.1, 0.25, 0.55], [-0.45, -0.15, 0.75], [0.35, -0.05, 0.7], [1.0, 0.3, 0.5]];
  for (const pass of [0, 1, 2]) {
    for (const [bx, by, br] of bumps) {
      ctx.beginPath();
      ctx.arc(cx + bx * s, cy + by * s + (pass === 0 ? 5 : 0), br * s + (pass === 1 ? 3 : 0), 0, Math.PI * 2);
      ctx.fillStyle = pass === 0 ? INK : pass === 1 ? INK : '#eef0ff';
      ctx.fill();
    }
  }
}

function draw() {
  const now = performance.now() / 1000;
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, frozen > 0 ? '#7fd3ff' : '#4f8cff');
  sky.addColorStop(1, frozen > 0 ? '#b3e6ff' : '#8a6cff');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-Math.PI / 6);
  ctx.fillStyle = 'rgba(255,255,255,.06)';
  for (let x = -H; x < H; x += 56) ctx.fillRect(x, -H, 26, H * 2);
  ctx.restore();

  // 빗줄기
  ctx.strokeStyle = 'rgba(255,255,255,.35)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const d of rain) { ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + d.l * 0.12, d.y - d.l); }
  ctx.stroke();
  ctx.lineCap = 'butt';

  // 구름: 천천히 흘러간다
  for (let k = 0; k < 4; k++) {
    const x = ((k * 150 + now * (6 + k * 2)) % (W + 160)) - 80;
    cloud(x, 10 + (k % 2) * 10, 30 + (k % 3) * 4);
  }

  // 땅: 남은 칸은 풀밭, 잠긴 칸은 물 (한 칸씩 테두리 두른 타일)
  const cw = (W - 8) / HP_MAX;
  for (let i = 0; i < HP_MAX; i++) {
    const x = 4 + i * cw, y = GROUND + 8, h = H - y + 10;
    const alive = i < hp;
    ctx.fillStyle = INK;
    roundRect(x + 1, y + 4, cw - 2, h, 8); ctx.fill();
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    if (alive) { g.addColorStop(0, '#7df08f'); g.addColorStop(1, '#2fb35a'); }
    else { g.addColorStop(0, '#7cc4ff'); g.addColorStop(1, '#2f6fe0'); }
    ctx.fillStyle = g;
    roundRect(x + 1, y, cw - 2, h, 8); ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = INK; ctx.stroke();
    if (alive) {
      // 풀잎
      ctx.fillStyle = '#b8ffc2';
      for (let b = 0; b < 3; b++) {
        const bx = x + 8 + b * (cw - 16) / 2;
        ctx.beginPath(); ctx.moveTo(bx - 3, y + 12); ctx.lineTo(bx, y + 4); ctx.lineTo(bx + 3, y + 12); ctx.fill();
      }
    } else {
      // 물결
      ctx.strokeStyle = 'rgba(255,255,255,.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let s = 0; s <= cw - 12; s += 2) {
        const yy = y + 12 + Math.sin(now * 4 + (x + s) / 6) * 2;
        s ? ctx.lineTo(x + 6 + s, yy) : ctx.moveTo(x + 6, yy);
      }
      ctx.stroke();
    }
  }

  // 단어: 테두리 두른 이름표. 치는 중인 앞부분은 분홍으로, 그 단어는 노란 테두리 빛
  const cur = input.value.trim();
  for (const w of words) {
    const sp = w.special ? SPECIALS[w.special] : null;
    const hot = cur && w.text.startsWith(cur);
    const h = 36, y = w.y - h / 2;
    if (hot) { ctx.fillStyle = 'rgba(255,230,80,.8)'; roundRect(w.x - 5, y - 5, w.w + 10, h + 10, 22); ctx.fill(); }
    ctx.fillStyle = INK;
    roundRect(w.x, y + 4, w.w, h, 18); ctx.fill();
    ctx.fillStyle = sp ? sp.tag : '#ffffff';
    roundRect(w.x, y, w.w, h, 18); ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke();
    let tx = w.x + PAD;
    if (sp) {
      ctx.font = '18px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(sp.icon, tx - 2, w.y + 1);
      tx += ICON_W;
    }
    ctx.font = FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = INK;
    ctx.fillText(w.text, tx, w.y + 1);
    if (hot) { ctx.fillStyle = '#ff3d8b'; ctx.fillText(cur, tx, w.y + 1); }
  }

  if (frozen > 0) {
    for (let k = 0; k < 6; k++) {
      ctx.globalAlpha = 0.5 + 0.3 * Math.sin(now * 3 + k);
      ctx.font = '26px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('❄️', 40 + k * 80, 80 + (k % 2) * 40 + Math.sin(now * 2 + k) * 6);
    }
    ctx.globalAlpha = 1;
  }

  for (const s of splashes) {
    ctx.globalAlpha = Math.min(1, s.life * 2);
    ctx.fillStyle = INK;
    ctx.beginPath(); ctx.arc(s.x, s.y + 1.5, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = s.color;
    ctx.beginPath(); ctx.arc(s.x, s.y, 3.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  for (const t of texts) {
    ctx.globalAlpha = Math.min(1, (0.9 - t.t) * 3);
    label(t.text, t.x, t.y - 30, 18, '#fff54f');
  }
  ctx.globalAlpha = 1;

  if (banner && state === 'play') {
    const a = Math.min(1, (1.4 - banner.t) * 2.5);
    const s = 1 + Math.max(0, 0.2 - banner.t);
    ctx.globalAlpha = a;
    ctx.save();
    ctx.translate(W / 2, H * 0.42);
    ctx.scale(s, s);
    label(banner.text, 0, 0, 40, '#fff54f');
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}

function updateHud() {
  $('score').textContent = score.toLocaleString();
  $('level').textContent = level;
  $('tpm').textContent = tpm();
}

// ---------- Loop ----------
let last = performance.now(), hudTick = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (state !== 'paused') update(dt);
  hudTick += dt;
  if (hudTick > 0.5) { hudTick = 0; if (state === 'play') $('tpm').textContent = tpm(); }
  draw();
  requestAnimationFrame(frame);
}

// ---------- Overlay ----------
function showOverlay(html) {
  const o = $('overlay');
  o.innerHTML = html;
  o.classList.remove('hidden');
}
function hideOverlay() { $('overlay').classList.add('hidden'); }
const overlayOpen = () => !$('overlay').classList.contains('hidden');

function segHtml(key, opts, value) {
  return `<div class="seg" data-key="${key}">${opts.map(([v, label]) =>
    `<button data-v="${v}" class="${String(v) === String(value) ? 'on' : ''}">${label}</button>`).join('')}</div>`;
}

function showMenu() {
  state = 'title';
  words = [];
  const t = loadTpm();
  showOverlay(`
    <h1 class="inked"><span class="drop">🌧️</span> 소나기</h1>
    <span class="tag">떨어지는 단어를 땅에 닿기 전에!</span>
    <p>단어가 땅에 닿을 때마다 풀밭이 한 칸씩 잠겨요</p>
    <div class="group">
      <span class="label">언어</span>
      ${segHtml('lang', [['ko', '한글'], ['en', 'English']], lang)}
    </div>
    <div class="group">
      <span class="label">시작 단계</span>
      ${segHtml('start', [[1, '1단계'], [4, '4단계'], [8, '8단계']], startLevel)}
    </div>
    <button class="main" data-act="start">시작하기</button>
    <div class="legend">
      ${Object.values(SPECIALS).map((s) => `<div>${s.icon} <b style="color:${s.color}">${s.name}</b> ${s.desc}</div>`).join('')}
    </div>
    ${best || t[lang] ? `<span class="tag" style="background:#ffd23f;color:#2b1d52">🏆 ${best ? `${best.toLocaleString()}점` : ''}${best && t[lang] ? ' · ' : ''}${t[lang] ? `${t[lang]}타/분` : ''}</span>` : ''}
    <div class="help"><span class="pc">입력하고 Enter · Esc 일시정지</span><span class="touch">입력하고 키보드의 완료(↵)·입력 버튼</span></div>`);
}

function pause() {
  if (state !== 'play') return;
  state = 'paused';
  showOverlay(`<h2 class="inked">일시정지</h2><span class="tag">점수 ${score.toLocaleString()} · ${level}단계</span>
    <button class="main" data-act="resume">계속하기</button>
    <button class="sub" data-act="menu">← 처음으로</button>`);
}
function resume() {
  if (state !== 'paused') return;
  state = 'play';
  hideOverlay();
  input.focus();
}

$('overlay').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const seg = btn.closest('.seg');
  if (seg) {
    const v = btn.dataset.v;
    if (seg.dataset.key === 'lang') { lang = v; store.set('sonagiLang', v); }
    if (seg.dataset.key === 'start') { startLevel = Number(v); store.set('sonagiStart', v); }
    showMenu();
    return;
  }
  const act = btn.dataset.act;
  if (act === 'start') startGame();
  else if (act === 'resume') resume();
  else if (act === 'menu') showMenu();
});

// ---------- Input ----------
// 한글 입력기는 Enter 로 마지막 글자를 확정하면서 입력 이벤트를 두 번 보내거나,
// 지운 칸에 확정된 글자를 다시 넣는 경우가 있다 (브라우저마다 다름).
// 빈 값은 무시하고, 제출 직후 마지막 글자 하나만 되살아나면 지운다.
let lastSubmit = { text: '', at: 0 };
$('typing-row').addEventListener('submit', (e) => {
  e.preventDefault();
  if (overlayOpen() && state !== 'play') {
    $('overlay').querySelector('.main')?.click();
    return;
  }
  const v = input.value;
  input.value = '';
  if (!v.trim()) return;
  lastSubmit = { text: v.trim(), at: performance.now() };
  submit(v);
});
input.addEventListener('input', () => {
  const since = performance.now() - lastSubmit.at;
  if (since < 150 && input.value.length === 1 && lastSubmit.text.endsWith(input.value)) input.value = '';
});
canvas.addEventListener('pointerdown', () => { if (state === 'play') input.focus(); });
// 입력 버튼을 눌러도 입력칸에서 포커스가 빠지지 않게 (모바일 키보드가 내려가지 않도록)
$('typing-row').querySelector('button').addEventListener('pointerdown', (e) => e.preventDefault());

addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { state === 'paused' ? resume() : pause(); return; }
  if (overlayOpen() && document.activeElement !== input && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    $('overlay').querySelector('.main')?.click();
  }
});
addEventListener('blur', () => pause());
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

function toggleMute() {
  muted = !muted;
  store.set('sonagiMuted', muted ? '1' : '0');
  $('muteBtn').textContent = muted ? '🔇' : '🔊';
}
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); input.focus(); };
$('pauseBtn').onclick = (e) => { e.currentTarget.blur(); state === 'paused' ? resume() : pause(); };
$('muteBtn').textContent = muted ? '🔇' : '🔊';

if (document.fonts) document.fonts.load(FONT).catch(() => {});
showMenu();
updateHud();
fit();
requestAnimationFrame(frame);
}
