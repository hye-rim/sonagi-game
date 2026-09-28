'use strict';

// ---------- Rules ----------
const W = 480, H = 600;
const GROUND = H - 44;         // 단어가 여기 닿으면 땅이 깎인다
const HP_MAX = 10;
const PER_LEVEL = 12;          // 이만큼 맞히면 다음 단계
const FONT = '800 20px -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

const fallSpeed = (lv) => 22 + lv * 7;                       // px/s. 1단계는 바닥까지 약 19초
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
  freeze: { icon: '❄️', color: '#7fd3ff', name: '얼리기', desc: '3초 동안 멈춤' },
  bomb: { icon: '💥', color: '#ff7a7a', name: '번개', desc: '화면의 단어 모두 없애기' },
  heal: { icon: '🌱', color: '#7ee39a', name: '새싹', desc: '땅 1칸 회복' },
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
  const hudH = 52, inputH = 64;
  const scale = Math.min((innerWidth - 16) / W, (vh - 16 - hudH - inputH) / H);
  const cssW = Math.floor(W * scale), cssH = Math.floor(H * scale);
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  $('col').style.width = Math.max(cssW, 300) + 'px';
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
  const w = ctx.measureText(text).width + (special ? 26 : 0);
  // 막 나온 단어들과 겹치지 않는 자리를 몇 번 찾아본다
  let x = 0;
  for (let k = 0; k < 8; k++) {
    x = 12 + Math.random() * (W - 24 - w);
    if (!words.some((o) => o.y < 70 && x < o.x + o.w + 10 && o.x < x + w + 10)) break;
  }
  words.push({ text, x, y: 16, w, special });   // 먹구름 아래에서 전부 보이게 시작
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
      <h2>땅이 다 잠겼어요</h2>
      <div class="big">${score.toLocaleString()}</div>
      <span class="record">${score >= best && score > 0 ? '🏆 최고 점수!' : `최고 점수 ${best.toLocaleString()}`}</span>
      <dl class="stats">
        <dt>단계</dt><dd>${level}</dd>
        <dt>맞힌 단어</dt><dd>${cleared}개</dd>
        <dt>타/분</dt><dd>${speed}${newTpm && speed ? ' 🏆' : ''}</dd>
        <dt>정확도</dt><dd>${acc}%</dd>
        <dt>최대 콤보</dt><dd>${maxCombo}</dd>
      </dl>
      <button class="main" data-act="start">다시 하기</button>
      <button class="main" data-act="menu" style="background:rgba(255,255,255,.12);color:#c9dcf8;box-shadow:none">처음으로</button>`);
  }, 600);
}

// ---------- Draw ----------
function draw() {
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#26395c');
  sky.addColorStop(1, '#3d5d8a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // 먹구름
  ctx.fillStyle = 'rgba(20,30,50,.55)';
  for (let k = 0; k < 7; k++) {
    ctx.beginPath();
    ctx.ellipse(k * 80 - 10, 6 + (k % 2) * 8, 70, 30, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 빗줄기
  ctx.strokeStyle = 'rgba(190,220,255,.28)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (const d of rain) { ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + d.l * 0.12, d.y - d.l); }
  ctx.stroke();

  // 땅: 남은 칸만큼 초록, 잠긴 칸은 물
  const cw = W / HP_MAX;
  for (let i = 0; i < HP_MAX; i++) {
    const alive = i < hp;
    ctx.fillStyle = alive ? '#4f8a3c' : '#2c5f9e';
    ctx.fillRect(i * cw, GROUND + 6, cw, H - GROUND - 6);
    ctx.fillStyle = alive ? '#6fbf4f' : '#4d8fe0';
    ctx.fillRect(i * cw, GROUND + 6, cw, 6);
    if (i) { ctx.fillStyle = 'rgba(0,0,0,.15)'; ctx.fillRect(i * cw - 1, GROUND + 6, 2, H - GROUND - 6); }
  }

  // 단어
  ctx.font = FONT;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const cur = input.value.trim();
  for (const w of words) {
    let x = w.x;
    if (w.special) {
      ctx.font = '18px sans-serif';
      ctx.fillText(SPECIALS[w.special].icon, x, w.y);
      ctx.font = FONT;
      x += 26;
    }
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(8,16,32,.85)';
    ctx.strokeText(w.text, x, w.y);
    ctx.fillStyle = w.special ? SPECIALS[w.special].color : '#ffffff';
    ctx.fillText(w.text, x, w.y);
    // 지금 치고 있는 글자와 앞부분이 같으면 노랗게
    if (cur && w.text.startsWith(cur)) {
      ctx.fillStyle = '#ffd966';
      ctx.fillText(cur, x, w.y);
    }
  }

  // 얼음 효과
  if (frozen > 0) {
    ctx.fillStyle = `rgba(160,220,255,${0.12 + 0.06 * Math.sin(performance.now() / 120)})`;
    ctx.fillRect(0, 0, W, GROUND);
  }

  for (const s of splashes) {
    ctx.globalAlpha = Math.min(1, s.life * 2);
    ctx.fillStyle = s.color;
    ctx.beginPath(); ctx.arc(s.x, s.y, 2.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.textAlign = 'center';
  for (const t of texts) {
    ctx.globalAlpha = Math.min(1, (0.9 - t.t) * 3);
    ctx.font = '900 15px sans-serif';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(8,16,32,.9)';
    ctx.strokeText(t.text, t.x, t.y - 16);
    ctx.fillStyle = '#ffd966';
    ctx.fillText(t.text, t.x, t.y - 16);
  }
  ctx.globalAlpha = 1;

  if (banner && state === 'play') {
    const a = Math.min(1, (1.4 - banner.t) * 2.5);
    ctx.globalAlpha = a;
    ctx.font = '900 38px sans-serif';
    ctx.lineWidth = 7;
    ctx.strokeStyle = '#0b1a33';
    ctx.strokeText(banner.text, W / 2, H * 0.42);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(banner.text, W / 2, H * 0.42);
    ctx.globalAlpha = 1;
  }
}

function updateHud() {
  $('score').textContent = score.toLocaleString();
  $('level').textContent = level;
  $('tpm').textContent = tpm();
  $('hp').innerHTML = `<span style="color:#7ee39a">${'■'.repeat(hp)}</span><span style="color:#2c5f9e">${'■'.repeat(HP_MAX - hp)}</span>`;
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
    <h1>소나기</h1>
    <p>하늘에서 떨어지는 단어를 <b>바닥에 닿기 전에</b> 입력하세요!<br>단어가 바닥에 닿을 때마다 땅이 한 칸씩 잠겨요.</p>
    <div class="group">
      <span class="label">언어</span>
      ${segHtml('lang', [['ko', '한글'], ['en', 'English']], lang)}
    </div>
    <div class="group">
      <span class="label">시작 단계</span>
      ${segHtml('start', [[1, '1단계'], [4, '4단계'], [8, '8단계']], startLevel)}
    </div>
    <div class="legend">
      ${Object.values(SPECIALS).map((s) => `<div><b style="color:${s.color}">${s.icon} ${s.name}</b> ${s.desc}</div>`).join('')}
    </div>
    <span class="record">${best ? `최고 점수 ${best.toLocaleString()}` : ''}${t[lang] ? ` · 최고 ${t[lang]}타/분` : ''}</span>
    <button class="main" data-act="start">시작하기</button>
    <div class="help">입력하고 Enter · Esc 일시정지</div>`);
}

function pause() {
  if (state !== 'play') return;
  state = 'paused';
  showOverlay(`<h2>일시정지</h2><p>점수 ${score.toLocaleString()} · ${level}단계</p>
    <button class="main" data-act="resume">계속하기</button>
    <button class="main" data-act="menu" style="background:rgba(255,255,255,.12);color:#c9dcf8;box-shadow:none">처음으로</button>`);
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

showMenu();
updateHud();
fit();
requestAnimationFrame(frame);
}
