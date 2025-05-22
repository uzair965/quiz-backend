const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// Store room data
let rooms = {};

// Create Room Endpoint
app.post('/create-room', (req, res) => {
  const { questions, timeLimit } = req.body;
  const roomCode = uuidv4().slice(0, 6); // Generate 6-character room code

  rooms[roomCode] = {
    questions,
    timeLimit,
    startTime: null,
    endTime: null,
    status: 'waiting', // waiting | started | ended
    players: {},
    leaderboard: []
  };

  res.json({ roomCode });
});

// Join Room Endpoint
app.post('/join-room', (req, res) => {
  const { roomCode, playerName, isHost } = req.body;

  if (!rooms[roomCode]) {
    return res.status(404).json({ error: 'Room not found' });
  }

  if (rooms[roomCode].status !== 'waiting') {
    return res.status(400).json({ error: 'Room already started or ended' });
  }

  const playerId = uuidv4();
  rooms[roomCode].players[playerId] = {
    name: playerName,
    score: 0,
    progress: 0,
    completed: false,
    isHost: isHost || false // Default to false
  };

  // Broadcast to everyone in the room that a new player has joined
  io.in(roomCode).emit('user-joined', { playerName });

  res.json({ playerId, isHost });
});



// Start Game Endpoint
app.post('/start-game', (req, res) => {
  const { roomCode } = req.body;

  if (!rooms[roomCode]) {
    return res.status(404).json({ error: 'Room not found' });
  }

  const room = rooms[roomCode];
  room.status = 'started';
  room.startTime = Date.now();
  room.endTime = room.startTime + room.timeLimit * 1000;

io.in(roomCode).emit('game-started', {
  questions: room.questions,
  leaderboard: Object.values(room.players).map(p => ({
    name: p.name,
    score: 0,
    isHost: p.isHost
  })),
  timeLimit: room.timeLimit
});


  // Automatically end game after timer expires
  setTimeout(() => {
    if (room.status === 'started') {
      room.status = 'ended';
      room.leaderboard = Object.values(room.players)
        .sort((a, b) => b.score - a.score)
        .map(p => ({ name: p.name, score: p.score }));

      io.in(roomCode).emit('game-ended', room.leaderboard);
    }
  }, room.timeLimit * 1000);

  res.json({ message: 'Game started' });
});

// Submit Answer Endpoint
app.post('/submit-answer', (req, res) => {
  const { roomCode, playerId, questionIndex, answer } = req.body;

  if (!rooms[roomCode]) {
    return res.status(404).json({ error: 'Room not found' });
  }

  const room = rooms[roomCode];
  const player = room.players[playerId];

  if (!player) {
    return res.status(404).json({ error: 'Player not found' });
  }

  // Calculate time taken to answer
  const currentTime = Date.now();
  const timeTaken = (currentTime - room.startTime) / 1000; // in seconds
  const timeRemaining = room.timeLimit - timeTaken;

  // Evaluate answer and update score
  if (room.questions[questionIndex].correctAnswer === answer) {
    // Base score for correct answer
    player.score += 10;

    // Bonus score based on time remaining
    const bonus = Math.max(0, Math.floor(timeRemaining / room.timeLimit * 5)); // Max 5 bonus points
    player.score += bonus;
  }

  // Track progress
  player.progress += 1;

  if (player.progress >= room.questions.length) {
    player.completed = true;
  }

  // Emit real-time leaderboard updates
  const leaderboard = Object.values(room.players)
    .sort((a, b) => b.score - a.score)
    .map(p => ({ name: p.name, score: p.score }));

  io.in(roomCode).emit('leaderboard-updated', leaderboard);

  // End game if all players are done or timer expires
  const allCompleted = Object.values(room.players).every(p => p.completed);
  const timeUp = Date.now() >= room.endTime;

  if (allCompleted || timeUp) {
    room.status = 'ended';
    room.leaderboard = leaderboard;
    io.in(roomCode).emit('game-ended', room.leaderboard);
  }

  res.json({ score: player.score });
});


// Socket.io for Real-Time Updates
io.on('connection', (socket) => {
  socket.on('join-room', (roomCode) => {
    socket.join(roomCode);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});