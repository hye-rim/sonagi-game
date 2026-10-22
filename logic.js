'use strict';

// 소나기: 규칙만 모아 둔 파일 (그리기·입력·소리 없음). 브라우저와 테스트(Node)가 같이 쓴다.
//
// - 하늘에서 단어가 떨어진다. 똑같이 쳐서 맞히면 사라지고, 땅에 닿으면 땅이 한 칸 잠긴다(10칸이 다 잠기면 끝)
// - 12개 맞힐 때마다 다음 단계: 더 빨리 떨어지고, 더 자주, 더 긴 단어가 나온다
// - 특수 단어(2단계부터 8%): ❄️ 3초 멈춤 · 💥 화면의 단어 모두 없애기 · 🌱 땅 1칸 회복
// - 점수: 타수 × (5 + 단계) + 콤보 5마다 +10
const LOGIC_SONAGI = (() => {
const HP_MAX = 10;
const PER_LEVEL = 12;          // 이만큼 맞히면 다음 단계
const START_Y = 62;            // 단어가 나타나는 높이 (구름 아래)

// 바닥까지 걸리는 시간으로 정한다: 1단계 약 19초, 단계마다 빨라짐 (봇 테스트로 맞춘 값)
const fallTime = (lv) => 540 / (22 + lv * 7);
// 판 높이(땅 높이)가 폰 키보드에 따라 바뀌어도 바닥까지 걸리는 시간은 같다
const fallSpeed = (lv, ground) => (ground - START_Y) / fallTime(lv);   // px/s
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

// 단어 묶음들(tiers)에서 이 단계에 나올 단어의 평균 타수
function avgStrokes(tiers, lv) {
  const avg = tiers.map((t) => t.reduce((a, w) => a + strokes(w), 0) / t.length);
  const ws = tierWeights(lv);
  const sum = ws.reduce((a, b) => a + b, 0);
  return ws.reduce((a, w, i) => a + w * avg[i], 0) / sum;
}

// 다음 단어: 단계별 비율로 묶음을 고르고, 화면에 이미 떠 있는 단어는 피한다 (같은 단어 두 개면 헷갈린다)
function pickWord(tiers, lv, onScreen = [], rand = Math.random) {
  const ws = tierWeights(lv);
  let r = rand() * ws.reduce((a, b) => a + b, 0), tier = 0;
  while (tier < ws.length - 1 && (r -= ws[tier]) > 0) tier++;
  const pool = tiers[tier];
  for (let k = 0; k < 10; k++) {
    const w = pool[Math.floor(rand() * pool.length)];
    if (!onScreen.includes(w)) return w;
  }
  return pool[Math.floor(rand() * pool.length)];
}
// 특수 단어인가 (2단계부터)
const pickSpecial = (lv, rand = Math.random) => (lv >= 2 && rand() < SPECIAL_CHANCE ? ['freeze', 'bomb', 'heal'][Math.floor(rand() * 3)] : null);

// 맞힌 단어 점수, 번개로 같이 없어진 단어 점수
const scoreFor = (word, lv, combo) => strokes(word) * (5 + lv) + (combo >= 5 ? Math.floor(combo / 5) * 10 : 0);
const bombScoreFor = (word, lv) => strokes(word) * (5 + lv);
const levelFor = (startLevel, cleared) => startLevel + Math.floor(cleared / PER_LEVEL);

// 친 글자와 맞는 단어: 같은 단어가 여럿이면 땅에 가장 가까운 것부터 (없으면 null)
function findHit(words, raw) {
  const v = raw.trim();
  let hit = null;
  for (const w of words) if (w.text === v && (!hit || w.y > hit.y)) hit = w;
  return hit;
}

return { HP_MAX, PER_LEVEL, START_Y, REACTION, SPECIALS, SPECIAL_CHANCE, FREEZE_TIME, fallTime, fallSpeed, targetTpm, spawnGap, tierWeights, strokes, avgStrokes, pickWord, pickSpecial, scoreFor, bombScoreFor, levelFor, findHit };
})();
if (typeof module !== 'undefined') module.exports = LOGIC_SONAGI;
