// 起動したNode.jsサーバーに接続する
const socket = io("https://sidetetris2.onrender.com");

"use strict";

// ============================================================
//  定数・キャンバス設定
// ============================================================
const BLOCK_SIZE = 50;
const GAME_WIDTH = BLOCK_SIZE * 20;
const GAME_HEIGHT = BLOCK_SIZE * 10;
const TITLE_SPACE = 100;
const SIDE_PANEL = 250;
const WIDTH = GAME_WIDTH + SIDE_PANEL;
const HEIGHT = GAME_HEIGHT + TITLE_SPACE;
const COLS = GAME_WIDTH / BLOCK_SIZE;
const ROWS = GAME_HEIGHT / BLOCK_SIZE;
const TITLE_BUTTONS = {
  play: { x: WIDTH / 2 - 150, y: 340, width: 300, height: 64 },
  createRoom: { x: WIDTH / 2 - 250, y: 424, width: 238, height: 58 },
  joinRoom: { x: WIDTH / 2 + 12, y: 424, width: 238, height: 58 },
};
const PANEL_OFFSET = 54;
const PAUSE_MENU_BUTTON = {
  x: GAME_WIDTH + SIDE_PANEL - 58, y: 12, width: 42, height: 42,
};
const PAUSE_MENU_FRAME = {
  x: WIDTH / 2 - 220, y: 126, width: 440, height: 380,
};
const PAUSE_MENU_OPTIONS = {
  resume: { x: WIDTH / 2 - 160, y: 270, width: 320, height: 58 },
  restart: { x: WIDTH / 2 - 160, y: 344, width: 320, height: 58 },
  title: { x: WIDTH / 2 - 160, y: 418, width: 320, height: 58 },
};
const GAME_OVER_MENU_FRAME = {
  x: WIDTH / 2 - 220, y: 110, width: 440, height: 380,
};
const GAME_OVER_MENU_OPTIONS = {
  retry: { x: WIDTH / 2 - 160, y: 330, width: 320, height: 58 },
  title: { x: WIDTH / 2 - 160, y: 404, width: 320, height: 58 },
};
const ONLINE_RETURN_BUTTON = {
  x: WIDTH / 2 - 160, y: 350, width: 320, height: 58,
};
const ONLINE_BOARD = {
  layouts: [
    { cell: 29, y: 42, nextWidth: 340, nextHeight: 190 },
    { cell: 20, y: 380, nextWidth: 240, nextHeight: 140 },
  ],
  gap: 24,
};

const SCROLL_SPEED = 500; // ピースが1マス進む間隔(ms)

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const titlePointer = { x: -1, y: -1, downAction: null };

function getCanvasPoint(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * WIDTH / rect.width,
    y: (e.clientY - rect.top) * HEIGHT / rect.height,
  };
}

function isInside(bounds, point) {
  return point.x >= bounds.x && point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y && point.y <= bounds.y + bounds.height;
}

function getCanvasAction(point) {
  if (game.isTitle) {
    for (const [action, bounds] of Object.entries(TITLE_BUTTONS)) {
      if (isInside(bounds, point)) return action;
    }
    return null;
  }
  if (game.gameOver) {
    if (onlineMatchActive) {
      return onlineOutcome && isInside(ONLINE_RETURN_BUTTON, point) ? "returnRoom" : null;
    }
    for (const [action, bounds] of Object.entries(GAME_OVER_MENU_OPTIONS)) {
      if (isInside(bounds, point)) return action;
    }
    return null;
  }
  if (game.paused) {
    for (const [action, bounds] of Object.entries(PAUSE_MENU_OPTIONS)) {
      if (isInside(bounds, point)) return action;
    }
    return null;
  }
  return !onlineMatchActive && isInside(PAUSE_MENU_BUTTON, point) ? "pause" : null;
}

// 画面サイズに合わせて描画解像度を調整（ぼやけ防止）
let scaleK = 1;
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.getBoundingClientRect().width || WIDTH;
  scaleK = Math.min(3, Math.max(1, (w * dpr) / WIDTH));
  canvas.width = Math.round(WIDTH * scaleK);
  canvas.height = Math.round(HEIGHT * scaleK);
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// スマホ判定（style.css の表示条件と同じ）
const touchMQ = window.matchMedia(
  "(hover: none) and (pointer: coarse) and (max-width: 500px), " +
  "(hover: none) and (pointer: coarse) and (max-height: 500px)"
);
const isTouchUI = () => touchMQ.matches;

const FONT = "'Orbitron', Arial, 'Hiragino Kaku Gothic ProN', 'Yu Gothic', Meiryo, 'Noto Sans JP', 'MS Gothic', sans-serif";
const fontOf = (px, weight = 700) => `${weight} ${px}px ${FONT}`;
if (document.fonts && document.fonts.load) {
  document.fonts.load("700 20px Orbitron");
  document.fonts.load("900 20px Orbitron");
}

const BLOCK_COLORS = {
  0: [0, 0, 0],
  1: [0, 220, 240],  // I
  2: [30, 70, 255],  // J
  3: [255, 150, 0],  // L
  4: [250, 235, 0],  // O
  5: [0, 230, 60],   // S
  6: [170, 40, 250], // T
  7: [250, 30, 50],  // Z
  8: [155, 165, 180], // お邪魔ブロック
};

const RAW_SHAPES = [
  ["1111"],
  ["200", "222"],
  ["003", "333"],
  ["44", "44"],
  ["055", "550"],
  ["060", "666"],
  ["770", "077"],
];
const SHAPES = RAW_SHAPES.map((shape) =>
  shape.map((row) => [...row].map((ch) => (ch === "0" ? 0 : 1)))
);

// ============================================================
//  ユーティリティ
// ============================================================
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const shade = (c, d) => c.map((v) => Math.max(0, Math.min(255, v + d)));

function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function text(str, x, y, o = {}) {
  const {
    size = 20, weight = 700, color = "#fff", align = "left",
    base = "top", spacing = 0, glow = null, blur = 0,
  } = o;
  ctx.font = fontOf(size, weight);
  ctx.textAlign = align;
  ctx.textBaseline = base;
  ctx.fillStyle = color;
  if ("letterSpacing" in ctx) ctx.letterSpacing = spacing + "px";
  if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = blur; }
  ctx.fillText(str, x, y);
  ctx.shadowBlur = 0;
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
}

// 光沢つきブロック
function drawBlock(px, py, s, colorIdx, alpha = 1) {
  const base = BLOCK_COLORS[colorIdx] || BLOCK_COLORS[1];
  ctx.save();
  ctx.globalAlpha = alpha;

  const g = ctx.createLinearGradient(px, py, px, py + s);
  g.addColorStop(0, rgb(shade(base, 80)));
  g.addColorStop(0.5, rgb(base));
  g.addColorStop(1, rgb(shade(base, -80)));
  ctx.fillStyle = g;
  rr(px + 1, py + 1, s - 2, s - 2, s * 0.12);
  ctx.fill();

  const gl = ctx.createLinearGradient(px, py, px, py + s * 0.5);
  gl.addColorStop(0, "rgba(255,255,255,0.5)");
  gl.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gl;
  rr(px + 4, py + 4, s - 8, s * 0.38, s * 0.08);
  ctx.fill();

  ctx.strokeStyle = rgb(shade(base, -120), 0.9);
  ctx.lineWidth = 1.5;
  rr(px + 1, py + 1, s - 2, s - 2, s * 0.12);
  ctx.stroke();
  ctx.restore();
}

function drawShapeAt(shapeIdx, x, y, size, alpha = 1) {
  const shape = SHAPES[shapeIdx];
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (shape[r][c]) drawBlock(x + c * size, y + r * size, size, shapeIdx + 1, alpha);
    }
  }
}

function card(x, y, w, h) {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, "rgba(32,48,80,0.95)");
  g.addColorStop(1, "rgba(12,18,34,0.95)");
  ctx.fillStyle = g;
  rr(x, y, w, h, 10);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,200,255,0.35)";
  ctx.lineWidth = 1.5;
  rr(x, y, w, h, 10);
  ctx.stroke();
}

function drawTitleButton(bounds, caption, primary = false, hovered = false, pressed = false) {
  const { x, y, width, height } = bounds;
  const gradient = ctx.createLinearGradient(0, y, 0, y + height);
  const topColor = pressed ? "rgba(0,200,230,0.98)" :
    hovered ? "rgba(0,165,220,0.98)" : "rgba(0,130,190,0.95)";
  const bottomColor = pressed ? "rgba(0,105,160,0.98)" :
    hovered ? "rgba(0,90,150,0.98)" : "rgba(0,65,120,0.95)";
  gradient.addColorStop(0, primary ? topColor : "rgba(32,48,80,0.95)");
  gradient.addColorStop(1, primary ? bottomColor : "rgba(12,18,34,0.95)");
  ctx.fillStyle = gradient;
  rr(x, y, width, height, 12);
  ctx.fill();
  ctx.strokeStyle = primary && (hovered || pressed)
    ? "rgba(150,250,255,1)"
    : primary ? "rgba(80,235,255,0.9)" : "rgba(0,200,255,0.55)";
  ctx.lineWidth = primary && (hovered || pressed) ? 3 : 2;
  rr(x, y, width, height, 12);
  ctx.stroke();
  text(caption, x + width / 2, y + height / 2, {
    size: primary ? 26 : 20,
    color: "#d9fbff",
    align: "center",
    base: "middle",
    spacing: primary ? 3 : 1,
    glow: primary ? "rgba(0,220,255,0.65)" : null,
    blur: 10,
  });
}

const label = (str, x, y) =>
  text(str, x, y, { size: 12, color: "rgb(110,155,200)", spacing: 2 });

// ============================================================
//  ハイスコア
// ============================================================
const HI_KEY = "sidetetris_hiscore";
function loadHi() {
  try { return parseInt(localStorage.getItem(HI_KEY), 10) || 0; } catch (e) { return 0; }
}
function saveHi(v) {
  try { localStorage.setItem(HI_KEY, String(v)); } catch (e) { /* 無視 */ }
}

const PLAYER_NAME_KEY = "sidetetris_player_name";
function loadPlayerName() {
  try {
    return (localStorage.getItem(PLAYER_NAME_KEY) || "").trim();
  } catch (error) {
    console.warn("プレイヤー名を読み込めませんでした。", error);
    return "";
  }
}

// ============================================================
//  背景演出（星・流れるブロック）
// ============================================================
let bgTime = 0;
const stars = Array.from({ length: 80 }, () => ({
  x: Math.random() * WIDTH,
  y: Math.random() * HEIGHT,
  z: 0.2 + Math.random() * 0.8,
  tw: Math.random() * 6.28,
}));
const floaters = Array.from({ length: 12 }, () => ({
  shape: randInt(0, 6),
  x: Math.random() * WIDTH,
  y: Math.random() * HEIGHT,
  speed: 0.03 + Math.random() * 0.05,
  size: 24 + Math.random() * 28,
}));

function updateBackground(dt) {
  bgTime += dt;
  for (const s of stars) {
    s.x -= s.z * 0.05 * dt;
    if (s.x < 0) s.x += WIDTH;
  }
  for (const f of floaters) {
    f.x -= f.speed * dt;
    if (f.x < -f.size * 4) {
      f.x = WIDTH + Math.random() * 200;
      f.y = Math.random() * HEIGHT;
      f.shape = randInt(0, 6);
    }
  }
}

function drawStars(mul) {
  for (const s of stars) {
    const tw = 0.6 + 0.4 * Math.sin(s.tw + bgTime * 0.003);
    ctx.fillStyle = `rgba(180,220,255,${(0.25 + 0.6 * s.z) * tw * mul})`;
    ctx.fillRect(s.x, s.y, s.z * 2.2, s.z * 2.2);
  }
}

// ============================================================
//  ゲーム本体
// ============================================================
class SideTetris {
  constructor() {
    this.isTitle = true;
    this.titleTimer = 0;
    this.hiScore = loadHi();
    this.reset();
  }

  reset(seed = null) {
    this.grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
    this.shapeRandomState = Number.isInteger(seed) ? seed >>> 0 : null;
    this.gameOver = false;
    this.paused = false;
    this.score = 0;
    this.newRecord = false;
    this.piece = null;
    this.lockPending = false;
    this.colorIdx = 1;
    this.time = 0;
    this.shake = 0;
    this.shakeMag = 0;
    this.particles = [];
    this.popups = [];
    this.clearEffects = {};
    this.incomingGarbage = [];
    this.nextShapeIdx = this.randomShapeIndex();
    this.nextNextShapeIdx = this.randomShapeIndex();
    this.newPiece();

    this.keyLeftPressed = false; this.keyLeftTime = 0;
    this.keyUpPressed = false;   this.keyUpTime = 0;
    this.keyDownPressed = false; this.keyDownTime = 0;
  }

  randomShapeIndex() {
    if (this.shapeRandomState === null) return randInt(0, 6);
    this.shapeRandomState = (Math.imul(this.shapeRandomState, 1664525) + 1013904223) >>> 0;
    return Math.floor(this.shapeRandomState / 0x100000000 * 7);
  }

  newPiece() {
    const isFirstPiece = this.piece === null;
    this.shapeIdx = isFirstPiece ? this.randomShapeIndex() : this.nextShapeIdx;
    this.piece = SHAPES[this.shapeIdx];
    this.colorIdx = this.shapeIdx + 1;
    if (!isFirstPiece) {
      this.nextShapeIdx = this.nextNextShapeIdx;
      this.nextNextShapeIdx = this.randomShapeIndex();
    }

    this.pieceX = COLS - this.piece[0].length;
    this.pieceY = Math.floor(ROWS / 2) - Math.floor(this.piece.length / 2);

    if (this.checkBlockOverlap(this.piece, this.pieceX, this.pieceY)) {
      this.gameOver = true;
      saveHi(this.hiScore);
      sfx.over();
    }
  }

  checkBlockOverlap(piece, ox, oy) {
    for (let r = 0; r < piece.length; r++) {
      for (let c = 0; c < piece[r].length; c++) {
        if (piece[r][c]) {
          const nx = ox + c, ny = oy + r;
          if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS && this.grid[ny][nx]) return true;
        }
      }
    }
    return false;
  }

  checkCollision(piece, ox, oy) {
    for (let r = 0; r < piece.length; r++) {
      for (let c = 0; c < piece[r].length; c++) {
        if (piece[r][c]) {
          const nx = ox + c, ny = oy + r;
          if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) return true;
          if (this.grid[ny][nx]) return true;
        }
      }
    }
    return false;
  }

  lockPiece() {
    if (this.gameOver || this.lockPending || !this.piece) return;
    for (let r = 0; r < this.piece.length; r++) {
      for (let c = 0; c < this.piece[r].length; c++) {
        if (this.piece[r][c]) this.grid[this.pieceY + r][this.pieceX + c] = this.colorIdx;
      }
    }
    sfx.lock();
    const attackLines = this.clearColumns();
    if (onlineMatchActive && attackLines > 0) {
      this.lockPending = sendGarbageAttack(attackLines, (response) => {
        if (response && response.ok) this.queueIncomingGarbage(response.incoming);
        this.finishPieceLock();
      });
      if (this.lockPending) return;
    }
    this.finishPieceLock();
  }

  finishPieceLock() {
    this.lockPending = false;
    this.applyIncomingGarbage();
    if (this.gameOver) return;
    this.newPiece();
    emitMatchState();
  }

  clearColumns() {
    const cleared = [];
    for (let c = 0; c < COLS; c++) {
      let full = true;
      for (let r = 0; r < ROWS; r++) {
        if (this.grid[r][c] === 0) { full = false; break; }
      }
      if (full) cleared.push(c);
    }
    if (cleared.length === 0) return 0;

    const n = cleared.length;
    let scoreText = "";
    if (!onlineMatchActive) {
      const points = n === 1 ? 100 : n === 2 ? 300 : 600;
      this.score += points;
      scoreText = "+" + points;

      if (this.score > this.hiScore) {
        this.hiScore = this.score;
        this.newRecord = true;
        saveHi(this.hiScore);
      }
    }

    // エフェクト・パーティクル（消す前の色を使う）
    for (const c of cleared) {
      this.clearEffects[c] = 250;
      for (let r = 0; r < ROWS; r++) {
        const base = BLOCK_COLORS[this.grid[r][c]] || BLOCK_COLORS[1];
        for (let i = 0; i < 3; i++) {
          this.particles.push({
            x: c * BLOCK_SIZE + Math.random() * BLOCK_SIZE,
            y: TITLE_SPACE + r * BLOCK_SIZE + Math.random() * BLOCK_SIZE,
            vx: (Math.random() - 0.5) * 0.5,
            vy: (Math.random() - 0.5) * 0.6,
            life: 500 + Math.random() * 400,
            max: 900,
            size: 3 + Math.random() * 5,
            color: base,
          });
        }
      }
    }

    const avgCol = cleared.reduce((a, b) => a + b, 0) / n;
    this.popups.push({
      text: scoreText,
      sub: n === 2 ? "DOUBLE!" : n >= 3 ? "TRIPLE!!" : "",
      x: (avgCol + 0.5) * BLOCK_SIZE,
      y: TITLE_SPACE + GAME_HEIGHT / 2,
      life: 1100, max: 1100,
    });
    sfx.clear(n);

    // 画面の振動（控えめ）
    this.shake = 200;
    this.shakeMag = 2 + n * 0.8;

    // 右の列から順に消して左へ詰める
    for (const c of [...cleared].sort((a, b) => b - a)) {
      for (let r = 0; r < ROWS; r++) {
        this.grid[r].splice(c, 1);
        this.grid[r].push(0);
      }
    }
    return Math.min(3, Math.max(0, n - 1));
  }

  queueIncomingGarbage(holes) {
    if (!Array.isArray(holes)) return;
    const existingLines = new Map(this.incomingGarbage.map((line) => [line.id, line]));
    this.incomingGarbage = holes.map(({ id, hole }) => {
      const existing = existingLines.get(id);
      return existing || { id, hole, delay: 1500 };
    });
  }

  applyIncomingGarbage() {
    if (!onlineMatchActive || this.gameOver) return;
    const appliedIds = [];
    while (this.incomingGarbage.length > 0) {
      if (this.incomingGarbage[0].delay > 0) {
        acknowledgeIncomingGarbage(appliedIds);
        return;
      }
      const { id, hole } = this.incomingGarbage.shift();
      appliedIds.push(id);
      for (let row = 0; row < ROWS; row++) {
        if (this.grid[row][COLS - 1] !== 0) {
          this.gameOver = true;
          saveHi(this.hiScore);
          sfx.over();
          acknowledgeIncomingGarbage(appliedIds);
          return;
        }
      }
      for (let row = 0; row < ROWS; row++) {
        for (let col = COLS - 1; col > 0; col--) {
          this.grid[row][col] = this.grid[row][col - 1];
        }
        this.grid[row][0] = row === hole ? 0 : 8;
      }
    }
    acknowledgeIncomingGarbage(appliedIds);
  }

  moveY(dy) {
    if (this.gameOver || this.lockPending || !this.piece) return;
    if (!this.checkCollision(this.piece, this.pieceX, this.pieceY + dy)) this.pieceY += dy;
  }

  scrollLeft() {
    if (this.gameOver || this.lockPending || !this.piece) return;
    if (!this.checkCollision(this.piece, this.pieceX - 1, this.pieceY)) this.pieceX -= 1;
    else this.lockPiece();
  }

  rotate() {
    if (this.gameOver || this.lockPending || this.piece === null) return;
    const rows = this.piece.length, cols = this.piece[0].length;
    const rotated = [];
    for (let c = 0; c < cols; c++) {
      const row = [];
      for (let r = rows - 1; r >= 0; r--) row.push(this.piece[r][c]);
      rotated.push(row);
    }
    const offsets = [
      [0, 0], [0, -1], [0, 1], [-1, 0], [1, 0],
      [0, -2], [0, 2], [-2, 0], [2, 0],
    ];
    for (const [dx, dy] of offsets) {
      let tx = this.pieceX + dx, ty = this.pieceY + dy;
      if (!this.checkBlockOverlap(rotated, tx, ty)) {
        if (tx < 0) tx = 0;
        if (tx + rotated[0].length > COLS) tx = COLS - rotated[0].length;
        if (ty < 0) ty = 0;
        if (ty + rotated.length > ROWS) ty = ROWS - rotated.length;
        if (!this.checkCollision(rotated, tx, ty)) {
          this.piece = rotated;
          this.pieceX = tx;
          this.pieceY = ty;
          sfx.rotate();
          break;
        }
      }
    }
  }

  getGhostX() {
    if (this.piece === null) return this.pieceX;
    let gx = this.pieceX;
    while (!this.checkCollision(this.piece, gx - 1, this.pieceY)) gx--;
    return gx;
  }

  hardDrop() {
    if (this.gameOver || this.lockPending || !this.piece) return;
    const gx = this.getGhostX();
    // 着地位置に火花
    const base = BLOCK_COLORS[this.colorIdx];
    for (let r = 0; r < this.piece.length; r++) {
      for (let c = 0; c < this.piece[r].length; c++) {
        if (this.piece[r][c]) {
          for (let i = 0; i < 4; i++) {
            this.particles.push({
              x: (gx + c) * BLOCK_SIZE + 4,
              y: TITLE_SPACE + (this.pieceY + r) * BLOCK_SIZE + Math.random() * BLOCK_SIZE,
              vx: -Math.random() * 0.3,
              vy: (Math.random() - 0.5) * 0.4,
              life: 300 + Math.random() * 200, max: 500,
              size: 2 + Math.random() * 3, color: base,
            });
          }
        }
      }
    }
    this.pieceX = gx;
    // 画面の振動（控えめ）
    this.shake = 100;
    this.shakeMag = 2;
    sfx.drop();
    this.lockPiece();
  }

  update(dt) {
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt);
    this.incomingGarbage.forEach((line) => {
      line.delay = Math.max(0, line.delay - dt);
    });

    for (const col of Object.keys(this.clearEffects)) {
      this.clearEffects[col] -= dt;
      if (this.clearEffects[col] <= 0) delete this.clearEffects[col];
    }
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 0.0008 * dt;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const p of this.popups) {
      p.y -= 0.04 * dt;
      p.life -= dt;
    }
    this.popups = this.popups.filter((p) => p.life > 0);
  }

  // ---------------- 描画 ----------------
  draw() {
    ctx.setTransform(scaleK, 0, 0, scaleK, 0, 0);
    ctx.fillStyle = "#02040a";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    if (this.isTitle) {
      this.drawTitle();
      return;
    }

    ctx.save();
    if (this.shake > 0) {
      const m = this.shakeMag * (this.shake / 250);
      ctx.translate((Math.random() - 0.5) * 2 * m, (Math.random() - 0.5) * 2 * m);
    }
    if (onlineMatchActive) this.drawOnlineGameLayout();
    else this.drawGame();
    ctx.restore();

    if (this.paused) this.drawPauseMenu();
    else if (this.gameOver) this.drawGameOver();
  }

  drawTitle() {
    const t = this.titleTimer;
    const bg = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, 50, WIDTH / 2, HEIGHT / 2, WIDTH * 0.7);
    bg.addColorStop(0, "#0d1b3a");
    bg.addColorStop(1, "#02040a");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    drawStars(1);
    for (const f of floaters) drawShapeAt(f.shape, f.x, f.y, f.size, 0.13);

    if (roomScreenVisible) return;

    const cy = HEIGHT / 2 - 125;
    const pulse = 0.5 + 0.5 * Math.sin(t * 0.003);

    const grad = ctx.createLinearGradient(0, cy - 50, 0, cy + 50);
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.5, "#7df3ff");
    grad.addColorStop(1, "#1e90ff");
    text("SIDE TETRIS", WIDTH / 2, cy, {
      size: 96, weight: 900, color: grad, align: "center", base: "middle", spacing: 6,
      glow: `rgba(0,200,255,${0.6 + 0.4 * pulse})`, blur: 20 + 20 * pulse,
    });

    // 装飾ライン
    const lg = ctx.createLinearGradient(WIDTH / 2 - 300, 0, WIDTH / 2 + 300, 0);
    lg.addColorStop(0, "rgba(0,200,255,0)");
    lg.addColorStop(0.5, "rgba(0,220,255,0.9)");
    lg.addColorStop(1, "rgba(0,200,255,0)");
    ctx.fillStyle = lg;
    ctx.fillRect(WIDTH / 2 - 300, cy + 66, 600, 3);

    text("HI-SCORE  " + this.hiScore, WIDTH / 2, cy + 112, {
      size: 20, color: "#ffd34d", align: "center", base: "middle", spacing: 3,
    });

    const playHovered = isInside(TITLE_BUTTONS.play, titlePointer);
    drawTitleButton(
      TITLE_BUTTONS.play,
      "プレイ",
      true,
      playHovered,
      playHovered && titlePointer.downAction === "play",
    );
    for (const [action, caption] of [["createRoom", "部屋を作成"], ["joinRoom", "部屋に入る"]]) {
      const bounds = TITLE_BUTTONS[action];
      const hovered = isInside(bounds, titlePointer);
      drawTitleButton(bounds, caption, true, hovered, hovered && titlePointer.downAction === action);
    }

    if (!isTouchUI()) {
      text("W / S: 上下移動　　SPACE: 回転　　A: ソフトドロップ　　J: ハードドロップ",
        WIDTH / 2, HEIGHT - 34, {
          size: 14, color: "rgb(100,140,180)", align: "center", base: "middle", spacing: 1,
        });
    }
  }

  drawGame() {
    const tSp = TITLE_SPACE, gW = GAME_WIDTH, gH = GAME_HEIGHT, b = BLOCK_SIZE;

    // ---- ヘッダー ----
    const hg = ctx.createLinearGradient(0, 0, 0, tSp);
    hg.addColorStop(0, "#0c1630");
    hg.addColorStop(1, "#060a16");
    ctx.fillStyle = hg;
    ctx.fillRect(0, 0, gW, tSp);

    const tg = ctx.createLinearGradient(0, 22, 0, 78);
    tg.addColorStop(0, "#ffffff");
    tg.addColorStop(0.5, "#7df3ff");
    tg.addColorStop(1, "#1e90ff");
    text("SIDE TETRIS", gW / 2, tSp / 2, {
      size: 46, weight: 900, color: tg, align: "center", base: "middle", spacing: 4,
      glow: "rgba(0,200,255,0.7)", blur: 16,
    });
    ctx.font = fontOf(46, 900);
    const tw = ctx.measureText("SIDE TETRIS").width;
    const lx = gW / 2 - tw / 2 - 28, rx = gW / 2 + tw / 2 + 28;
    const l1 = ctx.createLinearGradient(40, 0, lx, 0);
    l1.addColorStop(0, "rgba(0,200,255,0)");
    l1.addColorStop(1, "rgba(0,220,255,0.8)");
    ctx.fillStyle = l1;
    ctx.fillRect(40, tSp / 2 - 1, lx - 40, 3);
    const l2 = ctx.createLinearGradient(rx, 0, gW - 40, 0);
    l2.addColorStop(0, "rgba(0,220,255,0.8)");
    l2.addColorStop(1, "rgba(0,200,255,0)");
    ctx.fillStyle = l2;
    ctx.fillRect(rx, tSp / 2 - 1, gW - 40 - rx, 3);

    // ---- ボード ----
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, tSp, gW, gH);
    ctx.clip();

    const bgG = ctx.createLinearGradient(0, tSp, 0, tSp + gH);
    bgG.addColorStop(0, "#0b1428");
    bgG.addColorStop(0.5, "#070c1a");
    bgG.addColorStop(1, "#0b1428");
    ctx.fillStyle = bgG;
    ctx.fillRect(0, tSp, gW, gH);

    drawStars(0.8);

    // 横縞 + グリッド線
    ctx.fillStyle = "rgba(255,255,255,0.018)";
    for (let r = 0; r < ROWS; r += 2) ctx.fillRect(0, tSp + r * b, gW, b);
    ctx.strokeStyle = "rgba(80,130,200,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 0; c <= COLS; c++) {
      ctx.moveTo(c * b + 0.5, tSp);
      ctx.lineTo(c * b + 0.5, tSp + gH);
    }
    for (let r = 0; r <= ROWS; r++) {
      ctx.moveTo(0, tSp + r * b + 0.5);
      ctx.lineTo(gW, tSp + r * b + 0.5);
    }
    ctx.stroke();

    // 危険警告（出現位置の近くまで積まれたとき）
    let danger = false;
    for (let r = 0; r < ROWS && !danger; r++) {
      for (let c = COLS - 6; c < COLS; c++) {
        if (this.grid[r][c]) { danger = true; break; }
      }
    }
    if (danger) {
      const a = 0.08 + 0.025 * Math.sin(this.time * 0.004);
      const dg = ctx.createLinearGradient(gW - b * 6, 0, gW, 0);
      dg.addColorStop(0, "rgba(255,30,60,0)");
      dg.addColorStop(1, `rgba(255,30,60,${a})`);
      ctx.fillStyle = dg;
      ctx.fillRect(gW - b * 6, tSp, b * 6, gH);
    }

    // 固定ブロック
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.grid[r][c]) drawBlock(c * b, tSp + r * b, b, this.grid[r][c]);
      }
    }

    // 列消去フラッシュ
    for (const col of Object.keys(this.clearEffects)) {
      const a = this.clearEffects[col] / 250;
      const x = Number(col) * b;
      const fg = ctx.createLinearGradient(x, 0, x + b, 0);
      fg.addColorStop(0, `rgba(120,230,255,${a * 0.6})`);
      fg.addColorStop(0.5, `rgba(255,255,255,${a})`);
      fg.addColorStop(1, `rgba(120,230,255,${a * 0.6})`);
      ctx.fillStyle = fg;
      ctx.fillRect(x, tSp, b, gH);
    }

    // ゴースト & 操作中ピース
    if (!this.gameOver && this.piece !== null) {
      const gx = this.getGhostX();
      const base = BLOCK_COLORS[this.colorIdx] || BLOCK_COLORS[1];

      if (gx !== this.pieceX) {
        // 軌跡
        ctx.fillStyle = rgb(base, 0.06);
        for (let r = 0; r < this.piece.length; r++) {
          let minC = 99, maxC = -1;
          for (let c = 0; c < this.piece[r].length; c++) {
            if (this.piece[r][c]) { minC = Math.min(minC, c); maxC = Math.max(maxC, c); }
          }
          if (maxC >= 0) {
            ctx.fillRect(
              (gx + minC) * b, tSp + (this.pieceY + r) * b,
              (this.pieceX - gx) * b + (maxC - minC + 1) * b, b
            );
          }
        }
        // ゴースト本体
        ctx.save();
        ctx.shadowColor = rgb(base, 0.9);
        ctx.shadowBlur = 10;
        ctx.lineWidth = 2;
        for (let r = 0; r < this.piece.length; r++) {
          for (let c = 0; c < this.piece[r].length; c++) {
            if (this.piece[r][c]) {
              const x = (gx + c) * b, y = tSp + (this.pieceY + r) * b;
              ctx.fillStyle = rgb(base, 0.16);
              ctx.strokeStyle = rgb(base, 0.9);
              rr(x + 3, y + 3, b - 6, b - 6, 6);
              ctx.fill();
              ctx.stroke();
            }
          }
        }
        ctx.restore();
      }

      ctx.save();
      ctx.shadowColor = rgb(base, 0.9);
      ctx.shadowBlur = 20;
      for (let r = 0; r < this.piece.length; r++) {
        for (let c = 0; c < this.piece[r].length; c++) {
          if (this.piece[r][c]) {
            drawBlock((this.pieceX + c) * b, tSp + (this.pieceY + r) * b, b, this.colorIdx);
          }
        }
      }
      ctx.restore();
    }
    ctx.restore(); // clip解除

    // パーティクル（加算合成）
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.particles) {
      ctx.fillStyle = rgb(p.color, Math.max(0, p.life / p.max));
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.restore();

    // スコアポップアップ
    for (const p of this.popups) {
      const a = Math.min(1, p.life / 400);
      ctx.globalAlpha = a;
      if (p.text) {
        text(p.text, p.x, p.y, {
          size: 38, weight: 900, color: "#fff", align: "center", base: "middle",
          glow: "rgba(0,220,255,0.9)", blur: 14,
        });
      }
      if (p.sub) {
        text(p.sub, p.x, p.y + 38, {
          size: 22, weight: 900, color: "#ffd34d", align: "center", base: "middle", spacing: 3,
          glow: "rgba(255,170,0,0.9)", blur: 10,
        });
      }
      ctx.globalAlpha = 1;
    }

    // ボード枠（発光）
    ctx.save();
    ctx.shadowColor = "rgba(0,200,255,0.9)";
    ctx.shadowBlur = 16;
    ctx.strokeStyle = "rgb(60,150,220)";
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, tSp + 1.5, gW - 3, gH - 3);
    ctx.restore();

    this.drawPanel();
  }

  drawOnlineGameLayout() {
    const players = [playerName || "あなた", onlineOpponentName || "相手"];
    const localNextShapes = [this.nextShapeIdx, this.nextNextShapeIdx];

    const background = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    background.addColorStop(0, "#0d1b3a");
    background.addColorStop(1, "#02040a");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    drawStars(0.8);

    const widestBoard = Math.max(...ONLINE_BOARD.layouts.map(({ cell }) => COLS * cell));
    const widestNext = Math.max(...ONLINE_BOARD.layouts.map(({ nextWidth }) => nextWidth));
    const groupWidth = widestBoard + ONLINE_BOARD.gap + widestNext;
    const boardRight = (WIDTH + groupWidth) / 2 - widestNext - ONLINE_BOARD.gap;
    const nextX = boardRight + ONLINE_BOARD.gap;

    for (let index = 0; index < ONLINE_BOARD.layouts.length; index++) {
      const layout = ONLINE_BOARD.layouts[index];
      const isLocalBoard = index === 0;
      const cell = layout.cell;
      const boardWidth = COLS * cell;
      const boardHeight = ROWS * cell;
      const boardX = boardRight - boardWidth;
      const boardY = layout.y;
      const nameY = boardY - 23;

      text(players[index], boardX, nameY, {
        size: 18, color: "#7df3ff", glow: "rgba(0,200,255,0.55)", blur: 8,
      });

      const boardGradient = ctx.createLinearGradient(0, boardY, 0, boardY + boardHeight);
      boardGradient.addColorStop(0, "#0b1428");
      boardGradient.addColorStop(1, "#070c1a");
      ctx.fillStyle = boardGradient;
      ctx.fillRect(boardX, boardY, boardWidth, boardHeight);

      ctx.strokeStyle = "rgba(80,130,200,0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let col = 0; col <= COLS; col++) {
        const x = boardX + col * cell + 0.5;
        ctx.moveTo(x, boardY);
        ctx.lineTo(x, boardY + boardHeight);
      }
      for (let row = 0; row <= ROWS; row++) {
        const y = boardY + row * cell + 0.5;
        ctx.moveTo(boardX, y);
        ctx.lineTo(boardX + boardWidth, y);
      }
      ctx.stroke();

      const boardState = isLocalBoard ? {
        grid: this.grid,
        piece: this.lockPending || !this.piece
          ? null
          : { shapeIdx: this.shapeIdx, x: this.pieceX, y: this.pieceY },
      } : onlineRemoteState;
      if (boardState) {
        for (let row = 0; row < ROWS; row++) {
          for (let col = 0; col < COLS; col++) {
            const color = boardState.grid[row][col];
            if (color) drawBlock(boardX + col * cell, boardY + row * cell, cell, color);
          }
        }

        if (isLocalBoard && !this.gameOver && !this.lockPending && this.piece) {
          const ghostX = this.getGhostX();
          if (ghostX !== this.pieceX) {
            const color = BLOCK_COLORS[this.colorIdx] || BLOCK_COLORS[1];
            ctx.save();
            ctx.shadowColor = rgb(color, 0.8);
            ctx.shadowBlur = 8;
            ctx.lineWidth = 1.5;
            for (let row = 0; row < this.piece.length; row++) {
              for (let col = 0; col < this.piece[row].length; col++) {
                if (!this.piece[row][col]) continue;
                const x = boardX + (ghostX + col) * cell;
                const y = boardY + (this.pieceY + row) * cell;
                ctx.fillStyle = rgb(color, 0.12);
                ctx.strokeStyle = rgb(color, 0.85);
                rr(x + 2, y + 2, cell - 4, cell - 4, 4);
                ctx.fill();
                ctx.stroke();
              }
            }
            ctx.restore();
          }

          for (let row = 0; row < this.piece.length; row++) {
            for (let col = 0; col < this.piece[row].length; col++) {
              if (this.piece[row][col]) {
                drawBlock(
                  boardX + (this.pieceX + col) * cell,
                  boardY + (this.pieceY + row) * cell,
                  cell,
                  this.colorIdx,
                );
              }
            }
          }
        }

        if (!isLocalBoard && boardState.piece) {
          const { shapeIdx, shape, x, y } = boardState.piece;
          for (let row = 0; row < shape.length; row++) {
            for (let col = 0; col < shape[row].length; col++) {
              if (shape[row][col]) {
                drawBlock(
                  boardX + (x + col) * cell,
                  boardY + (y + row) * cell,
                  cell,
                  shapeIdx + 1,
                );
              }
            }
          }
        }

        if (isLocalBoard) {
          for (const [column, remaining] of Object.entries(this.clearEffects)) {
            const x = boardX + Number(column) * cell;
            const alpha = remaining / 250;
            const flash = ctx.createLinearGradient(x, 0, x + cell, 0);
            flash.addColorStop(0, `rgba(120,230,255,${alpha * 0.6})`);
            flash.addColorStop(0.5, `rgba(255,255,255,${alpha})`);
            flash.addColorStop(1, `rgba(120,230,255,${alpha * 0.6})`);
            ctx.fillStyle = flash;
            ctx.fillRect(x, boardY, cell, boardHeight);
          }
        }

        if (isLocalBoard) {
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          for (const particle of this.particles) {
            const x = boardX + particle.x / BLOCK_SIZE * cell;
            const y = boardY + (particle.y - TITLE_SPACE) / BLOCK_SIZE * cell;
            ctx.fillStyle = rgb(particle.color, Math.max(0, particle.life / particle.max));
            ctx.fillRect(
              x - particle.size / 2,
              y - particle.size / 2,
              particle.size * cell / BLOCK_SIZE,
              particle.size * cell / BLOCK_SIZE,
            );
          }
          ctx.restore();

          for (const popup of this.popups) {
            const alpha = Math.min(1, popup.life / 400);
            ctx.globalAlpha = alpha;
            if (popup.text) {
              text(popup.text, boardX + popup.x / BLOCK_SIZE * cell, boardY + boardHeight / 2, {
                size: 25, weight: 900, color: "#fff", align: "center", base: "middle",
                glow: "rgba(0,220,255,0.9)", blur: 12,
              });
            }
            if (popup.sub) {
              text(popup.sub, boardX + popup.x / BLOCK_SIZE * cell, boardY + boardHeight / 2 + 28, {
                size: 12, color: "#7df3ff", align: "center", base: "middle",
              });
            }
            ctx.globalAlpha = 1;
          }
        }
      }

      ctx.strokeStyle = "rgba(0,200,255,0.8)";
      ctx.lineWidth = 2;
      ctx.strokeRect(boardX, boardY, boardWidth, boardHeight);

      if (isLocalBoard && this.incomingGarbage.length > 0 &&
          Math.sin(bgTime * 0.012) > -0.1) {
        const severity = Math.min(3, this.incomingGarbage.length);
        const alertColor = severity === 1 ? "#ffffff" : severity === 2 ? "#ffe34d" : "#ff394d";
        text("!", boardRight + ONLINE_BOARD.gap / 2, boardY + boardHeight / 2, {
          size: 42,
          weight: 900,
          color: alertColor,
          align: "center",
          base: "middle",
          glow: alertColor,
          blur: 16,
        });
      }

      const nextY = boardY + (boardHeight - layout.nextHeight) / 2;
      card(nextX, nextY, layout.nextWidth, layout.nextHeight);
      label("NEXT", nextX + 16, nextY + 12);
      const previewCenters = [
        nextX + layout.nextWidth * 0.32,
        nextX + layout.nextWidth * 0.72,
      ];
      const previewSizes = isLocalBoard ? [32, 24] : [25, 18];
      const nextShapes = isLocalBoard
        ? localNextShapes
        : onlineRemoteState ? onlineRemoteState.next : localNextShapes;
      for (let nextIndex = 0; nextIndex < nextShapes.length; nextIndex++) {
        const shapeIndex = nextShapes[nextIndex];
        const shape = SHAPES[shapeIndex];
        const size = previewSizes[nextIndex];
        const x = previewCenters[nextIndex] - shape[0].length * size / 2;
        const y = nextY + 24 + (layout.nextHeight - 32 - shape.length * size) / 2;
        ctx.save();
        ctx.shadowColor = rgb(BLOCK_COLORS[shapeIndex + 1], 0.8);
        ctx.shadowBlur = 10;
        drawShapeAt(shapeIndex, x, y, size);
        ctx.restore();
      }
    }

  }

  drawPanel() {
    const px = GAME_WIDTH;
    const x0 = px + 20;

    const pg = ctx.createLinearGradient(px, 0, px + SIDE_PANEL, HEIGHT);
    pg.addColorStop(0, "#0c1426");
    pg.addColorStop(1, "#060a14");
    ctx.fillStyle = pg;
    ctx.fillRect(px, 0, SIDE_PANEL, HEIGHT);
    ctx.fillStyle = "rgb(60,150,220)";
    ctx.fillRect(px, 0, 3, HEIGHT);

    const menuHovered = isInside(PAUSE_MENU_BUTTON, titlePointer);
    ctx.fillStyle = menuHovered ? "rgba(0,165,220,0.45)" : "rgba(10,25,50,0.75)";
    rr(PAUSE_MENU_BUTTON.x, PAUSE_MENU_BUTTON.y, PAUSE_MENU_BUTTON.width, PAUSE_MENU_BUTTON.height, 8);
    ctx.fill();
    ctx.strokeStyle = menuHovered ? "rgba(150,250,255,0.95)" : "rgba(0,200,255,0.55)";
    ctx.lineWidth = menuHovered ? 2 : 1.5;
    rr(PAUSE_MENU_BUTTON.x, PAUSE_MENU_BUTTON.y, PAUSE_MENU_BUTTON.width, PAUSE_MENU_BUTTON.height, 8);
    ctx.stroke();
    ctx.strokeStyle = "#bff6ff";
    ctx.lineWidth = 3;
    ctx.save();
    ctx.lineCap = "round";
    for (let i = 0; i < 3; i++) {
      const y = PAUSE_MENU_BUTTON.y + 13 + i * 8;
      ctx.beginPath();
      ctx.moveTo(PAUSE_MENU_BUTTON.x + 11, y);
      ctx.lineTo(PAUSE_MENU_BUTTON.x + PAUSE_MENU_BUTTON.width - 11, y);
      ctx.stroke();
    }
    ctx.restore();

    // SCORE
    card(x0, 14 + PANEL_OFFSET, 210, 76);
    label("SCORE", x0 + 14, 24 + PANEL_OFFSET);
    text(String(this.score), x0 + 196, 46 + PANEL_OFFSET, {
      size: 34, weight: 900, color: "#fff", align: "right",
      glow: "rgba(0,220,255,0.8)", blur: 10,
    });

    // BEST
    card(x0, 100 + PANEL_OFFSET, 210, 58);
    label("BEST", x0 + 14, 108 + PANEL_OFFSET);
    text(String(this.hiScore), x0 + 196, 128 + PANEL_OFFSET, { size: 24, color: "#ffd34d", align: "right" });

    // NEXT
    card(x0, 168 + PANEL_OFFSET, 210, 150);
    label("NEXT", x0 + 14, 178 + PANEL_OFFSET);
    const previewShapeIndices = [this.nextShapeIdx, this.nextNextShapeIdx];
    const previewSizes = [26, 16];
    const previewCenters = [x0 + 72, x0 + 166];
    for (let i = 0; i < previewShapeIndices.length; i++) {
      const shapeIdx = previewShapeIndices[i];
      const shape = SHAPES[shapeIdx];
      const previewSize = previewSizes[i];
      const shapeWidth = shape[0].length * previewSize;
      const shapeHeight = shape.length * previewSize;
      const x = previewCenters[i] - shapeWidth / 2;
      const y = 168 + PANEL_OFFSET + 16 + (134 - shapeHeight) / 2;
      ctx.save();
      ctx.shadowColor = rgb(BLOCK_COLORS[shapeIdx + 1], 0.8);
      ctx.shadowBlur = 14;
      drawShapeAt(shapeIdx, x, y, previewSize);
      ctx.restore();
    }

    // CONTROLS（スマホでは非表示）
    if (!isTouchUI()) {
      card(x0, 332 + PANEL_OFFSET, 210, 138);
      label("CONTROLS", x0 + 14, 342 + PANEL_OFFSET);
      const keys = [
        ["W / S", "上下移動"],
        ["SPACE", "回転"],
        ["A", "ソフトドロップ"],
        ["J", "ハードドロップ"],
      ];
      keys.forEach(([k, v], i) => {
        const y = 372 + PANEL_OFFSET + i * 24;
        text(k, x0 + 14, y, { size: 13, color: "rgb(0,225,255)" });
        text(v, x0 + 196, y, { size: 13, color: "rgb(150,175,205)", align: "right" });
      });
    }
  }

  drawGameOver() {
    ctx.fillStyle = "rgba(2,6,16,0.72)";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    card(GAME_OVER_MENU_FRAME.x, GAME_OVER_MENU_FRAME.y, GAME_OVER_MENU_FRAME.width, GAME_OVER_MENU_FRAME.height);
    const centerX = WIDTH / 2;
    if (onlineMatchActive) {
      const result = onlineOutcome === "win"
        ? { text: "YOU WIN！", color: "#7dffb2", glow: "rgba(30,255,150,0.65)" }
        : onlineOutcome === "lose"
          ? { text: "YOU LOSE", color: "#ff7180", glow: "rgba(255,70,90,0.65)" }
          : { text: "決着を確認中...", color: "#bff6ff", glow: "rgba(0,200,255,0.65)" };
      text(result.text, centerX, 220, {
        size: onlineOutcome ? 48 : 30,
        weight: 900,
        color: result.color,
        align: "center",
        base: "middle",
        spacing: onlineOutcome ? 4 : 1,
        glow: result.glow,
        blur: 14,
      });
      if (onlineOutcome) {
        const bounds = ONLINE_RETURN_BUTTON;
        const hovered = isInside(bounds, titlePointer);
        drawTitleButton(
          bounds,
          "部屋に戻る",
          true,
          hovered,
          hovered && titlePointer.downAction === "returnRoom",
        );
      }
      if (onlineReturnError) {
        text(onlineReturnError, centerX, 430, {
          size: 14, color: "#ffb0b8", align: "center", base: "middle",
        });
      }
      return;
    }

    text("GAME OVER", centerX, 168, {
      size: 48, weight: 900, color: "#ff7180", align: "center", base: "middle", spacing: 4,
      glow: "rgba(255,70,90,0.55)", blur: 14,
    });
    text("SCORE  " + this.score, centerX, 220, {
      size: 26, color: "#fff", align: "center", base: "middle", spacing: 3,
    });
    if (this.newRecord) {
      text("NEW RECORD!", centerX, 264, {
        size: 20, weight: 900, color: "#ffd34d", align: "center", base: "middle", spacing: 4,
        glow: "rgba(255,190,0,0.65)", blur: 9,
      });
    }
    for (const [action, caption] of [["retry", "リトライ"], ["title", "タイトルに戻る"]]) {
      const bounds = GAME_OVER_MENU_OPTIONS[action];
      const hovered = isInside(bounds, titlePointer);
      drawTitleButton(bounds, caption, true, hovered, hovered && titlePointer.downAction === action);
    }
  }

  drawPauseMenu() {
    ctx.fillStyle = "rgba(2,6,16,0.72)";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    card(PAUSE_MENU_FRAME.x, PAUSE_MENU_FRAME.y, PAUSE_MENU_FRAME.width, PAUSE_MENU_FRAME.height);
    const centerX = WIDTH / 2;
    const centerY = HEIGHT / 2;
    text("PAUSE", centerX, centerY - 102, {
      size: 58, weight: 900, color: "#bff6ff", align: "center", base: "middle", spacing: 6,
      glow: "rgba(0,200,255,0.8)", blur: 20,
    });

    const options = [
      ["resume", "つづける"],
      ["restart", "最初からやり直す"],
      ["title", "タイトルに戻る"],
    ];
    for (const [action, caption] of options) {
      const bounds = PAUSE_MENU_OPTIONS[action];
      const hovered = isInside(bounds, titlePointer);
      drawTitleButton(bounds, caption, true, hovered, hovered && titlePointer.downAction === action);
    }
  }
}

// ============================================================
//  メインループ
// ============================================================
const game = new SideTetris();
let playerName = loadPlayerName();
const playerNameBadge = document.getElementById("player-name-badge");
const playerNameDialog = document.getElementById("player-name-dialog");
const playerNameForm = document.getElementById("player-name-form");
const playerNameInput = document.getElementById("player-name-input");
const playerNameError = document.getElementById("player-name-error");
const roomScreen = document.getElementById("room-screen");
const roomCodeDisplay = document.getElementById("room-code-display");
const roomHostName = document.getElementById("room-host-name");
const roomGuestName = document.getElementById("room-guest-name");
const roomStatus = document.getElementById("room-status");
const roomStartButton = document.getElementById("room-start-button");
const roomLeaveButton = document.getElementById("room-leave-button");
const roomLeaveDialog = document.getElementById("room-leave-dialog");
const roomLeaveMessage = document.getElementById("room-leave-message");
const roomCodeDialog = document.getElementById("room-code-dialog");
const roomCodeForm = document.getElementById("room-code-form");
const roomCodeInput = document.getElementById("room-code-input");
const roomCodeError = document.getElementById("room-code-error");
let currentRoom = null;
let roomScreenVisible = false;
let pendingRoomAction = null;
let roomLeaveUnlockTimer = null;
let onlineMatchActive = false;
let onlineOpponentName = "";
let onlineMatchId = null;
let onlineOutcome = null;
let onlineGameOverSent = false;
let onlineSyncElapsed = 0;
let onlineRemoteState = null;
let onlineReturnError = "";
let roomStartTimeout = null;

function emitMatchState() {
  if (!onlineMatchActive || !socket.connected || onlineMatchId === null) return;
  socket.emit("match:state", {
    matchId: onlineMatchId,
    state: {
      grid: game.grid,
      piece: game.gameOver || game.lockPending || !game.piece
        ? null
        : {
          shapeIdx: game.shapeIdx,
          shape: game.piece,
          x: game.pieceX,
          y: game.pieceY,
        },
      next: [game.nextShapeIdx, game.nextNextShapeIdx],
      score: game.score,
      gameOver: game.gameOver,
    },
  });
}

function sendGarbageAttack(lines, onComplete) {
  if (!onlineMatchActive || !socket.connected || onlineMatchId === null) return false;
  socket.timeout(5000).emit("match:attack", { matchId: onlineMatchId, lines }, (error, response) => {
    if (error || !response || !response.ok) {
      console.error(
        "お邪魔ブロックを送信できませんでした。",
        error || (response && response.message)
      );
      onComplete(null);
      return;
    }
    onComplete(response);
  });
  return true;
}

function acknowledgeIncomingGarbage(ids) {
  if (!onlineMatchActive || !socket.connected || onlineMatchId === null || ids.length === 0) return;
  socket.emit("match:garbage:applied", { matchId: onlineMatchId, ids });
}

function lockRoomLeaveButtonForMoment() {
  if (roomLeaveUnlockTimer !== null) clearTimeout(roomLeaveUnlockTimer);
  roomLeaveButton.disabled = true;
  roomLeaveUnlockTimer = setTimeout(() => {
    roomLeaveButton.disabled = false;
    roomLeaveUnlockTimer = null;
  }, 1000);
}

function updatePlayerNameBadge() {
  const label = playerName ? `プレイヤー名：${playerName}` : "プレイヤー名を設定";
  playerNameBadge.textContent = label;
  playerNameBadge.setAttribute("aria-label", `${label}（クリックして変更）`);
  ctx.save();
  ctx.font = fontOf(20);
  const textWidth = ctx.measureText(label).width;
  ctx.restore();
  const availableWidth = 250 - 28 - 4;
  playerNameBadge.style.fontSize = `${Math.min(20, 20 * availableWidth / textWidth)}px`;
}

function syncPlayerNameBadge() {
  const titleVisible = game.isTitle && !roomScreenVisible && !playerNameDialog.open;
  playerNameBadge.hidden = !titleVisible;
  if (titleVisible) {
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width / WIDTH;
    playerNameBadge.style.left = `${rect.left + 18 * scale}px`;
    playerNameBadge.style.top = `${rect.top + 18 * scale}px`;
    playerNameBadge.style.transform = `scale(${scale})`;
  }
}

function openPlayerNameDialog() {
  playerNameInput.value = playerName;
  playerNameError.textContent = "";
  document.getElementById("player-name-cancel").hidden = !playerName;
  playerNameDialog.showModal();
  playerNameInput.focus();
}

function renderRoom(room) {
  currentRoom = room;
  roomScreenVisible = true;
  roomScreen.hidden = false;
  roomCodeDisplay.textContent = room.code;
  const host = room.players.find((player) => player.id === room.hostId);
  const guest = room.players.find((player) => player.id !== room.hostId);
  roomHostName.textContent = host ? host.name : "ホスト";
  roomGuestName.textContent = guest ? guest.name : "参加待ち";

  const isHost = room.hostId === socket.id;
  roomStartButton.hidden = !isHost;
  roomStartButton.disabled = room.players.length < 2 || room.started;
  roomStatus.textContent = room.started
    ? "対戦を開始します。"
    : room.players.length < 2
      ? "対戦相手の参加をお待ちください。"
      : isHost
        ? "プレイヤーが揃いました。対戦を開始できます。"
        : "ホストが対戦を開始するのをお待ちください。";
}

function showRoomError(message) {
  currentRoom = null;
  roomScreenVisible = true;
  roomScreen.hidden = false;
  roomCodeDisplay.textContent = "----";
  roomHostName.textContent = "---";
  roomGuestName.textContent = "---";
  roomStartButton.hidden = true;
  roomStatus.textContent = message;
}

function returnToTitle() {
  if (roomLeaveUnlockTimer !== null) {
    clearTimeout(roomLeaveUnlockTimer);
    roomLeaveUnlockTimer = null;
  }
  roomLeaveButton.disabled = false;
  if (currentRoom) socket.emit("room:leave");
  currentRoom = null;
  roomScreenVisible = false;
  roomScreen.hidden = true;
  game.isTitle = true;
  game.reset();
  game.titleTimer = 0;
  scrollTime = 0;
  onlineMatchActive = false;
  onlineMatchId = null;
  onlineOutcome = null;
  onlineGameOverSent = false;
  onlineRemoteState = null;
  onlineReturnError = "";
}

function returnFromMatchToRoom(room) {
  currentRoom = room;
  onlineMatchActive = false;
  onlineMatchId = null;
  onlineOutcome = null;
  onlineGameOverSent = false;
  onlineRemoteState = null;
  onlineReturnError = "";
  game.isTitle = true;
  game.reset();
  game.titleTimer = 0;
  scrollTime = 0;
  clearHeldInputs();
  renderRoom(room);
}

function createOnlineRoom() {
  if (!playerName) {
    pendingRoomAction = "create";
    openPlayerNameDialog();
    return;
  }
  lockRoomLeaveButtonForMoment();
  if (!socket.connected) {
    roomLeaveButton.disabled = false;
    showRoomError("サーバーに接続できません。接続を確認してください。");
    return;
  }
  showRoomError("ルームを作成しています...");
  socket.timeout(5000).emit("room:create", { name: playerName }, (error, response) => {
    if (error) {
      roomLeaveButton.disabled = false;
      if (roomLeaveUnlockTimer !== null) {
        clearTimeout(roomLeaveUnlockTimer);
        roomLeaveUnlockTimer = null;
      }
      showRoomError("サーバーから応答がありません。もう一度お試しください。");
    } else if (!response.ok) {
      roomLeaveButton.disabled = false;
      if (roomLeaveUnlockTimer !== null) {
        clearTimeout(roomLeaveUnlockTimer);
        roomLeaveUnlockTimer = null;
      }
      showRoomError(response.message);
    } else {
      lockRoomLeaveButtonForMoment();
      renderRoom(response.room);
    }
  });
}

function openRoomCodeDialog() {
  if (!playerName) {
    pendingRoomAction = "join";
    openPlayerNameDialog();
    return;
  }
  roomCodeInput.value = "";
  roomCodeError.textContent = "";
  roomCodeDialog.showModal();
  roomCodeInput.focus();
}

socket.on("room:updated", (room) => {
  if (!currentRoom || room.code !== currentRoom.code) return;
  if (onlineMatchActive && !room.started) returnFromMatchToRoom(room);
  else renderRoom(room);
});

socket.on("room:closed", ({ message }) => {
  currentRoom = null;
  showRoomError(message || "ルームが終了しました。");
});

socket.on("room:started", ({ seed, matchId } = {}) => {
  if (!currentRoom) return;
  if (!Number.isInteger(seed) || !Number.isInteger(matchId)) {
    roomStatus.textContent = "対戦開始の通知を確認できません。ページを再読み込みしてください。";
    roomStartButton.disabled = false;
    return;
  }
  beginOnlineMatch({ seed, matchId });
});

function beginOnlineMatch({ seed, matchId }) {
  if (!currentRoom || !Number.isInteger(seed) || !Number.isInteger(matchId)) return false;
  if (onlineMatchActive && onlineMatchId === matchId) return true;
  if (roomStartTimeout !== null) {
    clearTimeout(roomStartTimeout);
    roomStartTimeout = null;
  }
  const opponent = currentRoom.players.find((player) => player.id !== socket.id);
  onlineOpponentName = opponent ? opponent.name : "相手";
  roomScreenVisible = false;
  roomScreen.hidden = true;
  startGame(true, seed, matchId);
  return true;
}

socket.on("match:state", (state) => {
  if (!onlineMatchActive || !state || state.matchId !== onlineMatchId) return;
  onlineRemoteState = {
    grid: state.grid,
    piece: state.piece,
    next: state.next,
  };
});

socket.on("match:garbage:queue", ({ matchId, lines } = {}) => {
  if (!onlineMatchActive || matchId !== onlineMatchId ||
      !Array.isArray(lines) || lines.length > 100 ||
      !lines.every((line) => line && Number.isSafeInteger(line.id) &&
        Number.isInteger(line.hole) && line.hole >= 0 && line.hole < ROWS)) return;
  game.queueIncomingGarbage(lines);
});

socket.on("match:ended", ({ matchId, outcome } = {}) => {
  if (!onlineMatchActive || matchId !== onlineMatchId ||
      !["win", "lose"].includes(outcome)) return;
  onlineOutcome = outcome;
  onlineGameOverSent = true;
  game.gameOver = true;
  clearHeldInputs();
});

socket.on("match:returned", (room) => {
  if (currentRoom && room && room.code === currentRoom.code) {
    returnFromMatchToRoom(room);
  }
});

updatePlayerNameBadge();
playerNameBadge.addEventListener("click", openPlayerNameDialog);
document.getElementById("player-name-cancel").addEventListener("click", () => {
  if (playerName) playerNameDialog.close();
});
playerNameDialog.addEventListener("cancel", (event) => {
  if (!playerName) {
    event.preventDefault();
    playerNameInput.focus();
  }
});
playerNameForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = playerNameInput.value.trim();
  if (!name) {
    playerNameError.textContent = "プレイヤー名を入力してください。";
    playerNameInput.focus();
    return;
  }
  if (Array.from(name).length > 7) {
    playerNameError.textContent = "名前は7文字までです。";
    playerNameInput.focus();
    return;
  }
  try {
    localStorage.setItem(PLAYER_NAME_KEY, name);
  } catch (error) {
    console.error("プレイヤー名を保存できませんでした。", error);
    playerNameError.textContent = "名前を保存できませんでした。ブラウザーの設定をご確認ください。";
    return;
  }
  playerName = name;
  updatePlayerNameBadge();
  playerNameDialog.close();
  const nextAction = pendingRoomAction;
  pendingRoomAction = null;
  if (nextAction === "create") {
    createOnlineRoom();
  } else if (nextAction === "join") {
    openRoomCodeDialog();
  }
});
document.getElementById("room-code-cancel").addEventListener("click", () => {
  roomCodeDialog.close();
});
roomCodeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const code = roomCodeInput.value.trim();
  if (!/^\d{4}$/.test(code)) {
    roomCodeError.textContent = "ルームコードは4桁の数字で入力してください。";
    roomCodeInput.focus();
    return;
  }
  if (!socket.connected) {
    roomCodeError.textContent = "サーバーに接続できません。接続を確認してください。";
    return;
  }
  roomCodeError.textContent = "ルームを検索しています...";
  socket.timeout(5000).emit("room:join", { code, name: playerName }, (error, response) => {
    if (error) {
      roomCodeError.textContent = "サーバーから応答がありません。もう一度お試しください。";
    } else if (!response.ok) {
      roomCodeError.textContent = response.message;
    } else {
      roomCodeDialog.close();
      renderRoom(response.room);
    }
  });
});
roomStartButton.addEventListener("click", () => {
  if (!currentRoom || currentRoom.hostId !== socket.id) return;
  roomStartButton.disabled = true;
  roomStatus.textContent = "対戦を開始しています...";
  if (roomStartTimeout !== null) clearTimeout(roomStartTimeout);
  roomStartTimeout = setTimeout(() => {
    roomStartTimeout = null;
    if (roomScreen.hidden || !currentRoom) return;
    roomStatus.textContent = "対戦開始の通知が届きませんでした。もう一度お試しください。";
    roomStartButton.disabled = currentRoom.players.length < 2;
  }, 6000);
  socket.timeout(5000).emit("room:start", (error, response) => {
    if (error) {
      if (roomStartTimeout !== null) {
        clearTimeout(roomStartTimeout);
        roomStartTimeout = null;
      }
      if (roomScreen.hidden) return;
      roomStatus.textContent = "サーバーから応答がありません。";
      roomStartButton.disabled = false;
    } else if (!response.ok) {
      if (roomStartTimeout !== null) {
        clearTimeout(roomStartTimeout);
        roomStartTimeout = null;
      }
      roomStatus.textContent = response.message;
      roomStartButton.disabled = currentRoom.players.length < 2;
    } else if (response.match && !beginOnlineMatch(response.match)) {
      if (roomStartTimeout !== null) {
        clearTimeout(roomStartTimeout);
        roomStartTimeout = null;
      }
      roomStatus.textContent = "対戦を開始できませんでした。ルームに入り直してください。";
      roomStartButton.disabled = false;
    }
  });
});
roomLeaveButton.addEventListener("click", () => {
  const isHost = currentRoom && currentRoom.hostId === socket.id;
  roomLeaveMessage.textContent = isHost
    ? "ルームを解散してタイトルに戻りますか？"
    : currentRoom
      ? "ルームから退出してタイトルに戻りますか？"
      : "タイトルに戻りますか？";
  roomLeaveDialog.showModal();
});
document.getElementById("room-leave-cancel").addEventListener("click", () => {
  roomLeaveDialog.close();
});
document.getElementById("room-leave-confirm").addEventListener("click", () => {
  roomLeaveDialog.close();
  returnToTitle();
});
roomCodeDialog.addEventListener("cancel", () => {
  roomCodeError.textContent = "";
});
if (!playerName) openPlayerNameDialog();

let scrollTime = 0;
const DAS_DELAY = 200;
const DAS_INTERVAL = 50;

function handleHold(pressedKey, timeKey, action, dt) {
  if (game[pressedKey]) {
    game[timeKey] += dt;
    if (game[timeKey] >= DAS_DELAY) {
      const excess = game[timeKey] - DAS_DELAY;
      const steps = Math.floor(excess / DAS_INTERVAL);
      if (steps > 0) {
        for (let i = 0; i < steps; i++) action();
        game[timeKey] = DAS_DELAY + (excess % DAS_INTERVAL);
      }
    }
  }
}

let lastTime = performance.now();
function loop(now) {
  const dt = Math.min(now - lastTime, 100);
  lastTime = now;

  if (!game.paused) updateBackground(dt);

  if (game.isTitle) {
    game.titleTimer += dt;
  } else {
    if (!game.paused && !game.gameOver) {
      scrollTime += dt;
      if (scrollTime >= SCROLL_SPEED) {
        game.scrollLeft();
        scrollTime = 0;
      }
    }
    if (!game.paused) game.update(dt);

    if (!game.paused && !game.gameOver) {
      handleHold("keyLeftPressed", "keyLeftTime", () => game.scrollLeft(), dt);
      handleHold("keyUpPressed", "keyUpTime", () => game.moveY(-1), dt);
      handleHold("keyDownPressed", "keyDownTime", () => game.moveY(1), dt);
    }
  }

  if (onlineMatchActive && !onlineOutcome) {
    if (game.gameOver && !onlineGameOverSent) {
      onlineGameOverSent = true;
      emitMatchState();
      socket.emit("match:gameover", { matchId: onlineMatchId });
    }
    onlineSyncElapsed += dt;
    if (onlineSyncElapsed >= 100) {
      onlineSyncElapsed %= 100;
      emitMatchState();
    }
  }

  syncPlayerNameBadge();
  game.draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ============================================================
//  入力（キーボード・スマホボタン共通）
// ============================================================
function startGame(online = false, seed = null, matchId = null) {
  roomScreenVisible = false;
  roomScreen.hidden = true;
  game.isTitle = false;
  onlineMatchActive = online;
  onlineMatchId = online ? matchId : null;
  onlineOutcome = null;
  onlineGameOverSent = false;
  onlineSyncElapsed = 0;
  onlineRemoteState = null;
  onlineReturnError = "";
  game.reset(online ? seed : null);
  if (!online) onlineOpponentName = "";
  scrollTime = 0;
  if (online) emitMatchState();
}

function clearHeldInputs() {
  game.keyLeftPressed = game.keyUpPressed = game.keyDownPressed = false;
  game.keyLeftTime = game.keyUpTime = game.keyDownTime = 0;
  document.querySelectorAll("#touch-controls .tbtn.active")
    .forEach((button) => button.classList.remove("active"));
}

function handleCanvasAction(action) {
  initAudio();
  if (!playerName) {
    openPlayerNameDialog();
    return;
  }
  switch (action) {
    case "play":
      startGame();
      break;
    case "createRoom":
      createOnlineRoom();
      break;
    case "joinRoom":
      openRoomCodeDialog();
      break;
    case "pause":
      game.paused = true;
      clearHeldInputs();
      break;
    case "resume":
      game.paused = false;
      clearHeldInputs();
      scrollTime = 0;
      break;
    case "restart":
      game.reset();
      scrollTime = 0;
      break;
    case "retry":
      game.reset();
      scrollTime = 0;
      break;
    case "title":
      onlineMatchActive = false;
      onlineOpponentName = "";
      game.isTitle = true;
      game.reset();
      game.titleTimer = 0;
      scrollTime = 0;
      break;
    case "returnRoom":
      if (!onlineMatchActive || !onlineOutcome) return;
      onlineReturnError = "";
      socket.timeout(5000).emit("match:return", (error, response) => {
        if (error) {
          onlineReturnError = "サーバーから応答がありません。";
        } else if (!response.ok) {
          onlineReturnError = response.message;
        }
      });
      break;
  }
}

function pressKey(code) {
  if (playerNameDialog.open) return;
  initAudio();

  if (game.isTitle) {
    return;
  }

  if (code === "Escape" && !game.gameOver) {
    game.paused = !game.paused;
    clearHeldInputs();
    scrollTime = 0;
    return;
  }

  if (game.paused) {
    return;
  }

  if (game.gameOver) {
    if (onlineMatchActive) return;
    if (code === "KeyR") {
      game.reset();
      scrollTime = 0;
    }
    return;
  }

  switch (code) {
    case "KeyW":
      game.moveY(-1);
      game.keyUpPressed = true;
      game.keyUpTime = 0;
      sfx.move();
      break;
    case "KeyS":
      game.moveY(1);
      game.keyDownPressed = true;
      game.keyDownTime = 0;
      sfx.move();
      break;
    case "Space":
      game.rotate();
      break;
    case "KeyJ":
      game.hardDrop();
      break;
    case "KeyA":
      game.scrollLeft();
      game.keyLeftPressed = true;
      game.keyLeftTime = 0;
      break;
  }
}

function releaseKey(code) {
  switch (code) {
    case "KeyA": game.keyLeftPressed = false; game.keyLeftTime = 0; break;
    case "KeyW": game.keyUpPressed = false; game.keyUpTime = 0; break;
    case "KeyS": game.keyDownPressed = false; game.keyDownTime = 0; break;
  }
}

// ---- キーボード ----
window.addEventListener("keydown", (e) => {
  if (playerNameDialog.open) return;
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
    e.preventDefault();
  }
  if (e.repeat) return;
  pressKey(e.code);
});

window.addEventListener("keyup", (e) => releaseKey(e.code));

// ---- スマホの操作ボタン ----
document.querySelectorAll("#touch-controls .tbtn").forEach((btn) => {
  const code = btn.dataset.key;

  btn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    btn.setPointerCapture(e.pointerId); // 指がボタンの外へ動いても離したことを検知できる
    btn.classList.add("active");
    pressKey(code);
  });

  const up = () => {
    btn.classList.remove("active");
    releaseKey(code);
  };
  btn.addEventListener("pointerup", up);
  btn.addEventListener("pointercancel", up);
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
});

// ---- タイトル画面・ゲームオーバーの操作 ----
canvas.addEventListener("pointermove", (e) => {
  if (e.pointerType === "touch") return;
  Object.assign(titlePointer, getCanvasPoint(e));
  canvas.style.cursor = getCanvasAction(titlePointer) ? "pointer" : "default";
});

canvas.addEventListener("pointerleave", () => {
  titlePointer.x = -1;
  titlePointer.y = -1;
  canvas.style.cursor = "default";
});

canvas.addEventListener("pointerdown", (e) => {
  Object.assign(titlePointer, getCanvasPoint(e));
  titlePointer.downAction = getCanvasAction(titlePointer);
});

window.addEventListener("pointerup", () => {
  titlePointer.downAction = null;
});
window.addEventListener("pointercancel", () => {
  titlePointer.downAction = null;
});

canvas.addEventListener("pointerup", (e) => {
  initAudio();
  const pressedAction = titlePointer.downAction;
  const releasedAction = getCanvasAction(getCanvasPoint(e));
  titlePointer.downAction = null;
  if (pressedAction && pressedAction === releasedAction) {
    handleCanvasAction(pressedAction);
    return;
  }
  if (game.isTitle) {
    return;
  }
});

// ウィンドウから離れたときにキーが押しっぱなしになるのを防ぐ
window.addEventListener("blur", () => {
  clearHeldInputs();
});