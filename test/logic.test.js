'use strict';
// 소나기 규칙 시험. 실행: node test/logic.test.js
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');
const { WORDS } = require('../words.js');

function rng(seed) {                                   // mulberry32 (시험용 고정 난수)
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('keystrokes: Korean counts jamo (double vowels and finals twice), other letters once', () => {
  assert.strictEqual(L.strokes('사과'), 2 + 3);           // ㅅㅏ + ㄱㅗㅏ
  assert.strictEqual(L.strokes('닭'), 1 + 1 + 2);         // ㄷ ㅏ ㄺ
  assert.strictEqual(L.strokes('까치'), 2 + 2, 'double consonants are one stroke (shift)');
  assert.strictEqual(L.strokes('의자'), 3 + 2);
  assert.strictEqual(L.strokes('apple'), 5);
});

test('word lists: three tiers per language, no blanks, tiers get longer', () => {
  for (const lang of Object.keys(WORDS)) {
    const tiers = WORDS[lang];
    assert.strictEqual(tiers.length, 3, lang);
    const avg = tiers.map((t) => t.reduce((a, w) => a + L.strokes(w), 0) / t.length);
    assert.ok(avg[0] < avg[1] && avg[1] < avg[2], `${lang}: ${avg.map((x) => x.toFixed(1))}`);
    for (const t of tiers) { assert.ok(t.length >= 30); for (const w of t) assert.ok(w.length > 0 && !/\s/.test(w)); }
  }
});

test('difficulty: faster falls, longer words and shorter gaps level by level', () => {
  for (let lv = 1; lv < 20; lv++) {
    assert.ok(L.fallTime(lv + 1) < L.fallTime(lv));
    const w = L.tierWeights(lv);
    assert.ok(Math.abs(w.reduce((a, b) => a + b, 0) - 1) < 1e-9 || w[0] === 0.15, 'weights add up');
    assert.ok(w.every((x) => x >= 0) && w[0] >= 0.15);
    assert.ok(L.spawnGap(lv, L.avgStrokes(WORDS.ko, lv)) >= 0.5);
  }
  assert.ok(Math.abs(L.fallTime(1) - 540 / 29) < 1e-9);
  assert.deepStrictEqual(L.tierWeights(1), [1, 0, 0], 'level 1 only has short words');
  // 판 높이가 바뀌어도 바닥까지 걸리는 시간은 같다
  for (const g of [556, 376]) assert.ok(Math.abs((g - L.START_Y) / L.fallSpeed(4, g) - L.fallTime(4)) < 1e-9);
});

test('the spawn gap matches the target typing speed', () => {
  for (const lang of ['ko', 'en']) {
    for (let lv = 1; lv <= 12; lv++) {
      const avg = L.avgStrokes(WORDS[lang], lv), gap = L.spawnGap(lv, avg);
      if (gap > 0.5) assert.ok(Math.abs((avg * 60) / (gap - L.REACTION) - L.targetTpm(lv)) < 1e-6);
    }
  }
});

test('picking words: avoids words already on screen, follows the level mix', () => {
  const r = rng(1);
  const tiers = WORDS.ko;
  const onScreen = tiers[0].slice(0, tiers[0].length - 3);         // 짧은 단어 거의 전부가 떠 있다
  for (let k = 0; k < 200; k++) {
    const w = L.pickWord(tiers, 1, onScreen, r);
    assert.ok(tiers[0].includes(w));
  }
  let fromLong = 0;
  for (let k = 0; k < 2000; k++) if (tiers[2].includes(L.pickWord(tiers, 10, [], r))) fromLong++;
  assert.ok(fromLong / 2000 > 0.3, 'level 10 often picks long words: ' + fromLong);
  let specials = 0;
  for (let k = 0; k < 5000; k++) { assert.strictEqual(L.pickSpecial(1, r), null); if (L.pickSpecial(3, r)) specials++; }
  assert.ok(specials / 5000 > 0.06 && specials / 5000 < 0.1);
});

test('score, combo bonus and level steps', () => {
  assert.strictEqual(L.scoreFor('사과', 1, 1), 5 * 6);
  assert.strictEqual(L.scoreFor('사과', 1, 5), 5 * 6 + 10);
  assert.strictEqual(L.scoreFor('사과', 3, 12), 5 * 8 + 20);
  assert.strictEqual(L.bombScoreFor('사과', 3), 40);
  assert.strictEqual(L.levelFor(1, 11), 1);
  assert.strictEqual(L.levelFor(1, 12), 2);
  assert.strictEqual(L.levelFor(4, 25), 6);
});

test('typing matches the lowest copy of a word, ignoring spaces around it', () => {
  const words = [{ text: '바다', y: 100 }, { text: '바다', y: 300 }, { text: '하늘', y: 400 }];
  assert.strictEqual(L.findHit(words, ' 바다 '), words[1]);
  assert.strictEqual(L.findHit(words, '바닥'), null);
  assert.strictEqual(L.findHit(words, ''), null);
});

// 목표 타/분으로 치는 봇이 단계마다 버티는지: 단어가 나오고 떨어지고, 봇은 한 번에 한 단어씩 친다
function simulate(tpm, lang, levels, seed) {
  const r = rng(seed), ground = 556;
  let level = 1, cleared = 0, hp = L.HP_MAX, words = [], spawnIn = 0.3, busy = 0, typing = null;
  for (let t = 0; t < 60 * 30; t += 0.05) {
    spawnIn -= 0.05;
    if (spawnIn <= 0) { words.push({ text: L.pickWord(WORDS[lang], level, words.map((w) => w.text), r), y: L.START_Y }); spawnIn = L.spawnGap(level, L.avgStrokes(WORDS[lang], level)); }
    for (const w of words) w.y += L.fallSpeed(level, ground) * 0.05;
    const landed = words.filter((w) => w.y >= ground);
    hp -= landed.length;
    words = words.filter((w) => w.y < ground);
    if (typing && !words.includes(typing)) typing = null;
    if (!typing && words.length) { typing = words.reduce((a, b) => (b.y > a.y ? b : a)); busy = L.REACTION + (L.strokes(typing.text) * 60) / tpm; }
    if (typing && (busy -= 0.05) <= 0) {
      words = words.filter((w) => w !== L.findHit(words, typing.text));
      typing = null; cleared++;
      level = L.levelFor(1, cleared);
    }
    if (hp <= 0 || level > levels) break;
  }
  return { level, hp };
}

test('a typist at the level\'s target speed keeps up; a much slower one sinks', () => {
  for (const lang of ['ko', 'en']) {
    const fast = simulate(L.targetTpm(6) * 1.15, lang, 6, 3);
    assert.ok(fast.level > 6 && fast.hp > 0, `${lang} fast typist reached level ${fast.level} with ${fast.hp} ground left`);
    const slow = simulate(60, lang, 6, 3);
    assert.ok(slow.hp <= 0 && slow.level <= 3, `${lang} slow typist sank at level ${slow.level}`);
  }
});
