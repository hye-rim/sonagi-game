'use strict';

// 소나기: 화면·입력·소리·진행. 규칙(타수·낙하 속도·간격·단어 고르기·점수·단계)은 logic.js (LOGIC_SONAGI) 에 있다.
const L = LOGIC_SONAGI;
const { HP_MAX, START_Y, SPECIALS, FREEZE_TIME, strokes, spawnGap, levelFor: levelAt } = L;
const W = 480;
const H_FULL = 600, H_MIN = 420;   // 판 높이: 보통은 600. 폰 키보드가 올라오면 보이는 높이에 맞춰 H_MIN 까지 줄어든다
let H = H_FULL;
let GROUND = H - 44;           // 단어가 여기 닿으면 땅이 깎인다
const DISPLAY = '"Jua", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
const FONT = `21px ${DISPLAY}`;
const PAD = 13, ICON_W = 24;   // 단어 이름표 안쪽 여백, 특수 단어 아이콘 자리

// ---------- Canvas ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const input = document.getElementById('typing');
const $ = (id) => document.getElementById(id);

// 판 높이를 바꾼다. 떨어지는 단어는 땅까지 남은 비율을 그대로 유지해서, 바뀌는 순간에 갑자기 땅에 닿지 않는다
// (바닥까지 걸리는 시간은 fallTime 으로 정해져 있어서 난이도는 그대로다)
function setBoardHeight(h) {
  if (h === H) return;
  const oldG = GROUND;
  H = h; GROUND = H - 44;
  for (const w of words) w.y = w.y <= START_Y ? w.y : START_Y + (w.y - START_Y) * (GROUND - START_Y) / (oldG - START_Y);
}

// 키보드가 열리기 전의 화면 높이를 기억해 둔다. iOS 에 따라 키보드가 올라올 때 '보이는 영역'만 줄기도 하고 페이지 높이(innerHeight)까지
// 같이 줄기도 해서, 둘 중 어느 쪽이든 키보드를 알아보도록 '입력칸을 누르기 전의 높이'와 비교한다.
// 입력칸에 포커스가 없을 때(또는 화면을 돌렸을 때)는 지금 높이로 갱신한다.
let baseH = Math.max(innerHeight, window.visualViewport ? window.visualViewport.height : 0), baseW = innerWidth;
function keyboardUp(vh) {
  if (innerWidth !== baseW) { baseW = innerWidth; baseH = Math.max(innerHeight, vh); }
  else if (document.activeElement !== input) baseH = Math.max(innerHeight, vh);
  return baseH - vh > 120;
}

function fit(forceH, forceTop) {                // 인자는 시험에서만 쓴다 (키보드가 올라온 높이를 흉내)
  // 폰은 키보드가 올라오면 '보이는 영역'(visualViewport)만 줄고 페이지는 그대로다. 사파리는 입력칸이 보이게 페이지를 위로
  // 밀어 올려서 위쪽 점수판과 판이 잘렸다. 그래서 키보드가 올라온 동안은 앱을 보이는 영역에 붙이고(.kb),
  // 판을 위아래로만 줄여서(가로는 꽉 채워서) 글자가 작아지지 않게 한다.
  const vv = window.visualViewport;
  const vh = typeof forceH === 'number' ? forceH : vv ? vv.height : innerHeight;
  const kb = keyboardUp(vh);
  document.documentElement.classList.toggle('kb', kb);
  const st = $('stage');
  if (kb) Object.assign(st.style, { position: 'fixed', left: '0', top: (typeof forceTop === 'number' ? forceTop : vv ? vv.offsetTop : 0) + 'px', height: vh + 'px' });
  else Object.assign(st.style, { position: '', left: '', top: '', height: '' });

  const hudH = kb ? 42 : 58, inputH = kb ? 60 : 78, gap = kb ? 14 : 28;   // 위 점수판, 아래 입력칸 (테두리·그림자 포함)
  const availW = innerWidth - gap, availH = vh - gap - hudH - inputH;
  let scale = Math.min(availW / W, availH / H_FULL);
  if (kb) {
    scale = Math.min(availW / W, availH / H_MIN);
    setBoardHeight(Math.max(H_MIN, Math.min(H_FULL, Math.floor(availH / scale))));
  } else setBoardHeight(H_FULL);
  const cssW = Math.floor(W * scale), cssH = Math.floor(H * scale);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  $('col').style.width = Math.min(innerWidth - 16, Math.max(cssW, 300)) + 'px';
}
addEventListener('resize', () => fit());
if (window.visualViewport) { visualViewport.addEventListener('resize', () => fit()); visualViewport.addEventListener('scroll', () => fit()); }
window.__kbFit = fit;

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
const avgCache = {};
function avgStrokes(lv) {
  const k = lang + ':' + lv;
  if (!(k in avgCache)) avgCache[k] = L.avgStrokes(WORDS[lang], lv);
  return avgCache[k];
}

const pickWord = () => L.pickWord(WORDS[lang], level, words.map((w) => w.text));

function spawn() {
  const text = pickWord();
  const special = L.pickSpecial(level);
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

function levelFor(n) { return levelAt(startLevel, n); }

function submit(raw) {
  const v = raw.trim();
  if (!v || state !== 'play') return;
  // 같은 단어가 여럿이면 땅에 가장 가까운 것부터
  const hit = L.findHit(words, v);
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
  typed += strokes(hit.text);
  const gain = L.scoreFor(hit.text, level, combo);
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
      const g = L.bombScoreFor(w.text, level);
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

  const v = L.fallSpeed(level, GROUND);
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
