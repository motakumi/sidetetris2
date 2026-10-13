"use strict";

// ============================================================
//  サウンド（WebAudio）
//  script.js より先に読み込むこと。
//  公開するもの: initAudio() / sfx
// ============================================================
let actx = null;

// ブラウザの仕様上、最初のユーザー操作（キー入力・タップ）の後に初期化する
function initAudio() {
  if (!actx) {
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      /* 非対応環境では無音で動作 */
    }
  }
  if (actx && actx.state === "suspended") actx.resume();
}

// 単音を鳴らす
//   freq : 周波数(Hz)   dur : 長さ(秒)   type : 波形
//   vol  : 音量         slide : 周波数の変化量(Hz)   delay : 開始の遅れ(秒)
function tone(freq, dur, type = "square", vol = 0.05, slide = 0, delay = 0) {
  if (!actx) return;
  const t = actx.currentTime + delay;
  const o = actx.createOscillator();
  const g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) {
    o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  }
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(actx.destination);
  o.start(t);
  o.stop(t + dur);
}

// 効果音
const sfx = {
  move:   () => tone(220, 0.04, "square", 0.03),
  rotate: () => tone(440, 0.07, "triangle", 0.06, 220),
  lock:   () => tone(120, 0.1, "square", 0.07, -50),
  drop:   () => tone(170, 0.15, "sawtooth", 0.06, -120),
  clear:  (n) =>
    [523, 659, 784, 1047].slice(0, Math.min(4, n + 1))
      .forEach((f, i) => tone(f, 0.18, "square", 0.06, 0, i * 0.07)),
  over:   () =>
    [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, "sawtooth", 0.06, 0, i * 0.18)),
};