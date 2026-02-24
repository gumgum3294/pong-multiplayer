const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

// ===== GAME CONSTANTS =====
const W = 1200;
const H = 700;
const PAD_W = 14;
const PAD_H = 100;
const BALL_SIZE = 10;
const PAD_SPEED = 8;
const BALL_SPEED_INIT = 7;
const BALL_SPEED_MAX = 18;
const PAD_X_MARGIN = 40;
const WINNING_SCORE = 7;
const TICK_RATE = 60; // server ticks per second

// ===== ROOM STORE =====
// rooms: { [code]: RoomState }
const rooms = {};

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms[code]);
  return code;
}

function createBall(dir = null) {
  const angle = (Math.random() * 50 - 25) * Math.PI / 180;
  const d = dir ?? (Math.random() > 0.5 ? 1 : -1);
  return {
    x: W / 2,
    y: H / 2,
    vx: Math.cos(angle) * BALL_SPEED_INIT * d,
    vy: Math.sin(angle) * BALL_SPEED_INIT,
    speed: BALL_SPEED_INIT,
  };
}

function createRoom(hostSocketId, hostUsername, roomName) {
  const code = generateCode();
  rooms[code] = {
    code,
    name: roomName,
    players: {
      p1: { socketId: hostSocketId, username: hostUsername, y: H / 2 - PAD_H / 2, score: 0, input: { up: false, down: false } },
      p2: null,
    },
    ball: createBall(),
    state: 'waiting', // waiting | countdown | playing | paused | finished
    countdownValue: 3,
    countdownTimer: null,
    gameInterval: null,
    lastScorer: null,
  };
  return rooms[code];
}

function getRoomBySocket(socketId) {
  return Object.values(rooms).find(r =>
    r.players.p1?.socketId === socketId || r.players.p2?.socketId === socketId
  );
}

function getPlayerSide(room, socketId) {
  if (room.players.p1?.socketId === socketId) return 'p1';
  if (room.players.p2?.socketId === socketId) return 'p2';
  return null;
}

// ===== GAME LOOP =====
function startCountdown(room) {
  room.state = 'countdown';
  room.countdownValue = 3;
  io.to(room.code).emit('countdown', { value: 3 });

  let count = 2;
  room.countdownTimer = setInterval(() => {
    if (count <= 0) {
      clearInterval(room.countdownTimer);
      io.to(room.code).emit('countdown', { value: 'GO!' });
      setTimeout(() => startGameLoop(room), 600);
      return;
    }
    io.to(room.code).emit('countdown', { value: count });
    count--;
  }, 1000);
}

function startGameLoop(room) {
  room.state = 'playing';
  io.to(room.code).emit('gameStart');

  const MS_PER_TICK = 1000 / TICK_RATE;

  room.gameInterval = setInterval(() => {
    if (room.state !== 'playing') return;
    tickGame(room);
  }, MS_PER_TICK);
}

function tickGame(room) {
  const p1 = room.players.p1;
  const p2 = room.players.p2;
  const ball = room.ball;

  // Move paddles from inputs
  if (p1.input.up)   p1.y = Math.max(0, p1.y - PAD_SPEED);
  if (p1.input.down) p1.y = Math.min(H - PAD_H, p1.y + PAD_SPEED);
  if (p2.input.up)   p2.y = Math.max(0, p2.y - PAD_SPEED);
  if (p2.input.down) p2.y = Math.min(H - PAD_H, p2.y + PAD_SPEED);

  // Move ball
  ball.x += ball.vx;
  ball.y += ball.vy;

  // Wall bounce
  if (ball.y - BALL_SIZE < 0) { ball.y = BALL_SIZE; ball.vy = Math.abs(ball.vy); }
  if (ball.y + BALL_SIZE > H) { ball.y = H - BALL_SIZE; ball.vy = -Math.abs(ball.vy); }

  // P1 paddle (left)
  const p1x = PAD_X_MARGIN;
  if (ball.vx < 0 &&
      ball.x - BALL_SIZE < p1x + PAD_W &&
      ball.x + BALL_SIZE > p1x &&
      ball.y + BALL_SIZE > p1.y &&
      ball.y - BALL_SIZE < p1.y + PAD_H) {
    ball.x = p1x + PAD_W + BALL_SIZE;
    const rel = (ball.y - (p1.y + PAD_H / 2)) / (PAD_H / 2);
    const angle = rel * 55 * Math.PI / 180;
    ball.speed = Math.min(ball.speed * 1.06, BALL_SPEED_MAX);
    ball.vx = Math.cos(angle) * ball.speed;
    ball.vy = Math.sin(angle) * ball.speed;
    io.to(room.code).emit('hit', { side: 'p1', x: ball.x, y: ball.y });
  }

  // P2 paddle (right)
  const p2x = W - PAD_X_MARGIN - PAD_W;
  if (ball.vx > 0 &&
      ball.x + BALL_SIZE > p2x &&
      ball.x - BALL_SIZE < p2x + PAD_W &&
      ball.y + BALL_SIZE > p2.y &&
      ball.y - BALL_SIZE < p2.y + PAD_H) {
    ball.x = p2x - BALL_SIZE;
    const rel = (ball.y - (p2.y + PAD_H / 2)) / (PAD_H / 2);
    const angle = rel * 55 * Math.PI / 180;
    ball.speed = Math.min(ball.speed * 1.06, BALL_SPEED_MAX);
    ball.vx = -Math.cos(angle) * ball.speed;
    ball.vy = Math.sin(angle) * ball.speed;
    io.to(room.code).emit('hit', { side: 'p2', x: ball.x, y: ball.y });
  }

  // Scoring
  let scored = null;
  if (ball.x < 0) { scored = 'p2'; }
  else if (ball.x > W) { scored = 'p1'; }

  if (scored) {
    room.players[scored].score++;
    const s1 = p1.score;
    const s2 = p2.score;
    io.to(room.code).emit('score', { p1: s1, p2: s2, scorer: scored });

    if (s1 >= WINNING_SCORE || s2 >= WINNING_SCORE) {
      room.state = 'finished';
      clearInterval(room.gameInterval);
      const winner = s1 >= WINNING_SCORE ? p1.username : p2.username;
      io.to(room.code).emit('gameOver', { winner, p1Score: s1, p2Score: s2 });
      return;
    }

    // Reset ball towards the player who just got scored on
    room.ball = createBall(scored === 'p1' ? -1 : 1);
    return; // skip state broadcast this tick
  }

  // Broadcast game state ~every tick
  io.to(room.code).emit('state', {
    p1y: p1.y,
    p2y: p2.y,
    bx: Math.round(ball.x * 10) / 10,
    by: Math.round(ball.y * 10) / 10,
  });
}

function cleanupRoom(room) {
  if (room.countdownTimer) clearInterval(room.countdownTimer);
  if (room.gameInterval) clearInterval(room.gameInterval);
  delete rooms[room.code];
}

// ===== SOCKET EVENTS =====
io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  // Get current room list
  socket.on('getRooms', () => {
    const available = Object.values(rooms)
      .filter(r => r.state === 'waiting' && !r.players.p2)
      .map(r => ({ code: r.code, name: r.name, host: r.players.p1.username }));
    socket.emit('roomList', available);
  });

  // Create room
  socket.on('createRoom', ({ username, roomName }) => {
    // Leave any existing room
    const existing = getRoomBySocket(socket.id);
    if (existing) handleLeave(socket, existing);

    const room = createRoom(socket.id, username, roomName);
    socket.join(room.code);
    socket.emit('roomCreated', {
      code: room.code,
      name: room.name,
      p1: username,
    });
    console.log(`[Room] Created: ${room.code} by ${username}`);
  });

  // Join room
  socket.on('joinRoom', ({ username, code }) => {
    const room = rooms[code];
    if (!room) { socket.emit('joinError', 'Room not found.'); return; }
    if (room.players.p2) { socket.emit('joinError', 'Room is full.'); return; }
    if (room.state !== 'waiting') { socket.emit('joinError', 'Game already in progress.'); return; }

    const existing = getRoomBySocket(socket.id);
    if (existing) handleLeave(socket, existing);

    room.players.p2 = {
      socketId: socket.id,
      username,
      y: H / 2 - PAD_H / 2,
      score: 0,
      input: { up: false, down: false },
    };

    socket.join(room.code);
    socket.emit('joinedRoom', {
      code: room.code,
      name: room.name,
      p1: room.players.p1.username,
      p2: username,
    });
    io.to(room.players.p1.socketId).emit('opponentJoined', { username });
    console.log(`[Room] ${username} joined ${room.code}`);

    // Broadcast updated room list
    broadcastRoomList();
  });

  // Host starts game
  socket.on('startGame', () => {
    const room = getRoomBySocket(socket.id);
    if (!room) return;
    if (room.players.p1.socketId !== socket.id) return; // only host
    if (!room.players.p2) { socket.emit('error', 'Need 2 players to start.'); return; }
    if (room.state !== 'waiting') return;

    // reset scores
    room.players.p1.score = 0;
    room.players.p2.score = 0;
    room.ball = createBall();
    room.players.p1.y = H / 2 - PAD_H / 2;
    room.players.p2.y = H / 2 - PAD_H / 2;

    io.to(room.code).emit('gameInit', {
      p1: room.players.p1.username,
      p2: room.players.p2.username,
      W, H, PAD_W, PAD_H, BALL_SIZE, PAD_X_MARGIN
    });

    startCountdown(room);
    broadcastRoomList();
  });

  // Rematch
  socket.on('rematch', () => {
    const room = getRoomBySocket(socket.id);
    if (!room) return;
    if (room.players.p1.socketId !== socket.id) return;
    if (room.state !== 'finished') return;

    room.players.p1.score = 0;
    room.players.p2.score = 0;
    room.ball = createBall();
    room.players.p1.y = H / 2 - PAD_H / 2;
    room.players.p2.y = H / 2 - PAD_H / 2;
    room.state = 'waiting';

    io.to(room.code).emit('gameInit', {
      p1: room.players.p1.username,
      p2: room.players.p2.username,
      W, H, PAD_W, PAD_H, BALL_SIZE, PAD_X_MARGIN
    });

    startCountdown(room);
  });

  // Player input
  socket.on('input', ({ key, pressed }) => {
    const room = getRoomBySocket(socket.id);
    if (!room || room.state !== 'playing') return;
    const side = getPlayerSide(room, socket.id);
    if (!side) return;
    const player = room.players[side];
    if (key === 'up') player.input.up = pressed;
    if (key === 'down') player.input.down = pressed;
  });

  // Leave room
  socket.on('leaveRoom', () => {
    const room = getRoomBySocket(socket.id);
    if (room) handleLeave(socket, room);
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log(`[-] Disconnected: ${socket.id}`);
    const room = getRoomBySocket(socket.id);
    if (room) handleLeave(socket, room);
  });
});

function handleLeave(socket, room) {
  const side = getPlayerSide(room, socket.id);
  socket.leave(room.code);

  if (room.state === 'playing' || room.state === 'countdown') {
    // Notify the other player
    io.to(room.code).emit('opponentLeft', { message: 'Your opponent left the game.' });
    cleanupRoom(room);
  } else if (side === 'p1') {
    // Host left waiting room — if p2 exists, make them host or just close
    if (room.players.p2) {
      io.to(room.players.p2.socketId).emit('opponentLeft', { message: 'Host left the room.' });
    }
    cleanupRoom(room);
  } else if (side === 'p2') {
    room.players.p2 = null;
    io.to(room.players.p1.socketId).emit('opponentLeft', { message: 'Opponent left the room.' });
  }

  broadcastRoomList();
}

function broadcastRoomList() {
  const available = Object.values(rooms)
    .filter(r => r.state === 'waiting' && !r.players.p2)
    .map(r => ({ code: r.code, name: r.name, host: r.players.p1.username }));
  io.emit('roomList', available);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🏓 PONG.IO server running at http://localhost:${PORT}\n`);
});
