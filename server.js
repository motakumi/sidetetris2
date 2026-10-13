const express = require('express');
const http = require('http');
const { randomInt } = require('crypto');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});
const rooms = new Map();
const MAX_ROOM_PLAYERS = 2;

app.use(express.static(__dirname));

function acknowledge(callback, response) {
  if (typeof callback === 'function') callback(response);
}

function roomSnapshot(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    players: [...room.players.values()],
    started: room.started,
  };
}

function broadcastRoom(room) {
  io.to(room.code).emit('room:updated', roomSnapshot(room));
}

function leaveRoom(socket) {
  const code = socket.data.roomCode;
  if (!code) return;

  const room = rooms.get(code);
  socket.leave(code);
  delete socket.data.roomCode;
  if (!room) return;

  if (room.hostId === socket.id) {
    rooms.delete(code);
    io.to(code).emit('room:closed', { message: 'ホストが退出したため、ルームを解散しました。' });
    return;
  }

  room.players.delete(socket.id);
  room.started = false;
  room.matchEnded = false;
  room.matchId = null;
  room.seed = null;
  room.matchStates = new Map();
  room.garbageQueues = new Map();
  broadcastRoom(room);
}

function normalizeMatchState(state) {
  if (!state || !Array.isArray(state.grid) || state.grid.length !== 10 ||
      !state.grid.every((row) => Array.isArray(row) && row.length === 20 &&
        row.every((value) => Number.isInteger(value) && value >= 0 && value <= 8))) {
    return null;
  }
  if (!Array.isArray(state.next) || state.next.length !== 2 ||
      !state.next.every((shape) => Number.isInteger(shape) && shape >= 0 && shape <= 6)) {
    return null;
  }
  if (typeof state.gameOver !== 'boolean') return null;
  let piece = null;
  if (state.piece !== null) {
    const candidate = state.piece;
    if (!candidate || !Number.isInteger(candidate.shapeIdx) ||
        candidate.shapeIdx < 0 || candidate.shapeIdx > 6 ||
        !Number.isInteger(candidate.x) || candidate.x < -4 || candidate.x > 20 ||
        !Number.isInteger(candidate.y) || candidate.y < -4 || candidate.y > 10 ||
        !Array.isArray(candidate.shape) || candidate.shape.length < 1 ||
        candidate.shape.length > 4 ||
        !candidate.shape.every((row) => Array.isArray(row) && row.length >= 1 &&
          row.length <= 4 && row.every((value) => value === 0 || value === 1))) {
      return null;
    }
    piece = {
      shapeIdx: candidate.shapeIdx,
      shape: candidate.shape,
      x: candidate.x,
      y: candidate.y,
    };
  }
  if (!Number.isSafeInteger(state.score) || state.score < 0) return null;

  return {
    grid: state.grid,
    piece,
    next: state.next,
    score: state.score,
    gameOver: state.gameOver,
  };
}

function createRoomCode() {
  let code;
  do {
    code = String(randomInt(1000, 10000));
  } while (rooms.has(code));
  return code;
}

function validPlayerName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return Array.from(name).length >= 1 && Array.from(name).length <= 7 ? name : null;
}

io.on('connection', (socket) => {
  socket.on('room:create', (payload, callback) => {
    const name = validPlayerName(payload && payload.name);
    if (!name) {
      acknowledge(callback, { ok: false, message: 'プレイヤー名を確認してください。' });
      return;
    }

    leaveRoom(socket);
    const code = createRoomCode();
    const room = {
      code,
      hostId: socket.id,
      players: new Map([[socket.id, { id: socket.id, name }]]),
      started: false,
      matchEnded: false,
      matchId: null,
      seed: null,
      matchStates: new Map(),
      garbageQueues: new Map(),
    };
    rooms.set(code, room);
    socket.data.roomCode = code;
    socket.join(code);
    acknowledge(callback, { ok: true, room: roomSnapshot(room) });
    broadcastRoom(room);
  });

  socket.on('room:join', (payload, callback) => {
    const name = validPlayerName(payload && payload.name);
    const code = typeof (payload && payload.code) === 'string' ? payload.code.trim() : '';
    if (!name) {
      acknowledge(callback, { ok: false, message: 'プレイヤー名を確認してください。' });
      return;
    }
    if (!/^\d{4}$/.test(code)) {
      acknowledge(callback, { ok: false, message: 'ルームコードは4桁の数字で入力してください。' });
      return;
    }

    const room = rooms.get(code);
    if (!room) {
      acknowledge(callback, { ok: false, message: 'ルームが見つかりません。コードを確認してください。' });
      return;
    }
    if (room.started) {
      acknowledge(callback, { ok: false, message: 'このルームではすでに対戦が始まっています。' });
      return;
    }
    if (room.players.has(socket.id)) {
      acknowledge(callback, { ok: true, room: roomSnapshot(room) });
      return;
    }
    if (room.players.size >= MAX_ROOM_PLAYERS) {
      acknowledge(callback, { ok: false, message: 'このルームは満員です。' });
      return;
    }

    leaveRoom(socket);
    room.players.set(socket.id, { id: socket.id, name });
    socket.data.roomCode = code;
    socket.join(code);
    acknowledge(callback, { ok: true, room: roomSnapshot(room) });
    broadcastRoom(room);
  });

  socket.on('room:start', (callback) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id) {
      acknowledge(callback, { ok: false, message: '対戦を開始できるのはホストだけです。' });
      return;
    }
    if (room.players.size !== MAX_ROOM_PLAYERS) {
      acknowledge(callback, { ok: false, message: 'もう一人のプレイヤーが参加するまでお待ちください。' });
      return;
    }

    room.started = true;
    room.matchEnded = false;
    room.matchId = randomInt(1, 0x7fffffff);
    room.seed = randomInt(1, 0x7fffffff);
    room.nextGarbageId = 1;
    room.matchStates = new Map();
    room.garbageQueues = new Map([...room.players.keys()].map((playerId) => [playerId, []]));
    const match = {
      matchId: room.matchId,
      seed: room.seed,
    };
    io.to(room.code).emit('room:started', match);
    acknowledge(callback, { ok: true, match });
  });

  socket.on('match:state', (payload) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.started || room.matchEnded ||
        !room.players.has(socket.id) || !payload ||
        payload.matchId !== room.matchId) return;
    const state = normalizeMatchState(payload.state);
    if (!state) return;
    room.matchStates.set(socket.id, state);
    socket.to(room.code).emit('match:state', {
      matchId: room.matchId,
      playerId: socket.id,
      ...state,
    });
  });

  socket.on('match:attack', (payload, callback) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.started || room.matchEnded ||
        !room.players.has(socket.id) || !payload ||
        payload.matchId !== room.matchId ||
        !Number.isInteger(payload.lines) || payload.lines < 1 || payload.lines > 3) {
      acknowledge(callback, { ok: false, message: 'お邪魔ブロックを送信できませんでした。' });
      return;
    }
    const opponentId = [...room.players.keys()].find((playerId) => playerId !== socket.id);
    if (!opponentId) {
      acknowledge(callback, { ok: false, message: '対戦相手がルームにいません。' });
      return;
    }
    const ownQueue = room.garbageQueues.get(socket.id) || [];
    const opponentQueue = room.garbageQueues.get(opponentId) || [];
    let remainingAttack = payload.lines;
    while (remainingAttack > 0 && ownQueue.length > 0) {
      ownQueue.shift();
      remainingAttack -= 1;
    }
    for (let index = 0; index < remainingAttack; index++) {
      opponentQueue.push({
        id: room.nextGarbageId++,
        hole: randomInt(0, 9),
      });
    }
    room.garbageQueues.set(socket.id, ownQueue);
    room.garbageQueues.set(opponentId, opponentQueue);
    for (const playerId of room.players.keys()) {
      io.to(playerId).emit('match:garbage:queue', {
        matchId: room.matchId,
        lines: room.garbageQueues.get(playerId),
      });
    }
    acknowledge(callback, {
      ok: true,
      cancelled: payload.lines - remainingAttack,
      sent: remainingAttack,
      incoming: ownQueue,
    });
  });

  socket.on('match:garbage:applied', (payload) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.started || room.matchEnded ||
        !room.players.has(socket.id) || !payload ||
        payload.matchId !== room.matchId || !Array.isArray(payload.ids) ||
        payload.ids.length < 1 || payload.ids.length > 10 ||
        !payload.ids.every((id) => Number.isSafeInteger(id))) return;
    const queue = room.garbageQueues.get(socket.id) || [];
    const appliedIds = new Set(payload.ids);
    room.garbageQueues.set(socket.id, queue.filter((line) => !appliedIds.has(line.id)));
    io.to(socket.id).emit('match:garbage:queue', {
      matchId: room.matchId,
      lines: room.garbageQueues.get(socket.id),
    });
  });

  socket.on('match:gameover', (payload) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.started || room.matchEnded ||
        !room.players.has(socket.id) || !payload ||
        payload.matchId !== room.matchId ||
        !room.matchStates.get(socket.id) ||
        !room.matchStates.get(socket.id).gameOver) return;
    room.matchEnded = true;
    const winnerId = [...room.players.keys()].find((playerId) => playerId !== socket.id);
    for (const playerId of room.players.keys()) {
      io.to(playerId).emit('match:ended', {
        matchId: room.matchId,
        outcome: playerId === winnerId ? 'win' : 'lose',
      });
    }
  });

  socket.on('match:return', (callback) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.started || !room.matchEnded ||
        !room.players.has(socket.id)) {
      acknowledge(callback, { ok: false, message: '対戦結果を確認できません。' });
      return;
    }
    room.started = false;
    room.matchEnded = false;
    room.matchId = null;
    room.seed = null;
    room.matchStates = new Map();
    room.garbageQueues = new Map();
    io.to(room.code).emit('match:returned', roomSnapshot(room));
    acknowledge(callback, { ok: true });
  });

  socket.on('room:leave', (callback) => {
    leaveRoom(socket);
    acknowledge(callback, { ok: true });
  });

  socket.on('disconnect', () => {
    leaveRoom(socket);
  });
});

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, () => {
  console.log(`サーバーが起動しました！ http://localhost:${PORT}`);
});
