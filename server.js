const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";
const BOARD_SIZE = 10;
const FLEET = [5, 4, 3, 3, 2];
const WATER = ".";
const SHIP = "S";
const HIT = "X";
const MISS = "o";

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const games = new Map();
let waitingSocketId = null;
let nextRoomId = 1;

app.use("/css", express.static(path.join(__dirname, "css")));
app.use("/js", express.static(path.join(__dirname, "js")));
app.use("/images", express.static(path.join(__dirname, "images")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/battle.html", (req, res) => {
  res.sendFile(path.join(__dirname, "battle.html"));
});

app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

io.on("connection", (socket) => {
  console.log(`Client connected: ${socket.id}`);
  socket.emit("connectionStatus", "Connected to server");

  socket.on("joinGame", ({ mode } = {}) => {
    if (mode === "multiplayer") {
      joinMultiplayerGame(socket);
      return;
    }

    startAiGame(socket);
  });

  socket.on("attack", ({ rowIndex, colIndex }) => {
    const game = games.get(socket.id);

    if (!game) {
      socket.emit("message", "Start a game first.");
      return;
    }

    if (game.mode === "multiplayer") {
      handleMultiplayerAttack(socket, game, rowIndex, colIndex);
      return;
    }

    handleAiPlayerAttack(socket, game, rowIndex, colIndex);
  });

  socket.on("restartGame", () => {
    const game = games.get(socket.id);

    if (!game) {
      socket.emit("message", "Start a game first.");
      return;
    }

    if (game.mode === "multiplayer") {
      restartMultiplayerGame(game);
      return;
    }

    const newGame = createAiGame();
    games.set(socket.id, newGame);
    sendAiGameUpdate(socket, newGame, "New game started.");
  });

  socket.on("disconnect", () => {
    leaveGame(socket);
    console.log(`Client disconnected: ${socket.id}`);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Sea Battle server is running at http://localhost:${PORT}`);
});

function createAiGame() {
  return {
    mode: "ai",
    playerBoard: createBoardWithFleet(),
    botBoard: createBoardWithFleet(),
    botTargets: [],
    currentTurn: "human",
    gameOver: false,
    winner: null
  };
}

function startAiGame(socket) {
  leaveGame(socket);

  const game = createAiGame();
  games.set(socket.id, game);
  socket.emit("playerAssigned", { playerId: "Human" });
  socket.emit("connectionStatus", "Connected as Human player");
  socket.emit("message", "Game started. Attack the opponent board.");
  sendAiGameState(socket, game);
}

function createMultiplayerGame(socketId) {
  return {
    mode: "multiplayer",
    roomId: `game-${nextRoomId++}`,
    players: [socketId, null],
    boards: [createBoardWithFleet(), createBoardWithFleet()],
    currentTurn: 1,
    gameOver: false,
    winner: null
  };
}

function joinMultiplayerGame(socket, waitingMessage = "Waiting for Player 2.") {
  leaveGame(socket);

  const waitingSocket = waitingSocketId
    ? io.sockets.sockets.get(waitingSocketId)
    : null;
  const waitingGame = waitingSocket ? games.get(waitingSocket.id) : null;

  if (!waitingSocket || !waitingGame || waitingGame.players[1]) {
    const game = createMultiplayerGame(socket.id);

    waitingSocketId = socket.id;
    games.set(socket.id, game);
    socket.join(game.roomId);
    socket.emit("playerAssigned", { playerId: "Player 1" });
    socket.emit("connectionStatus", "Connected as Player 1");
    socket.emit("waitingForOpponent");
    socket.emit("message", waitingMessage);
    sendMultiplayerGameState(socket, game);
    return;
  }

  const game = waitingGame;
  waitingSocketId = null;
  game.players[1] = socket.id;
  games.set(socket.id, game);
  socket.join(game.roomId);

  waitingSocket.emit("playerAssigned", { playerId: "Player 1" });
  socket.emit("playerAssigned", { playerId: "Player 2" });
  waitingSocket.emit("connectionStatus", "Connected as Player 1");
  socket.emit("connectionStatus", "Connected as Player 2");
  sendMultiplayerUpdate(game, "Player 2 joined. Player 1 starts.");
}

function leaveGame(socket) {
  const game = games.get(socket.id);

  if (!game) {
    return;
  }

  games.delete(socket.id);

  if (game.mode !== "multiplayer") {
    return;
  }

  if (waitingSocketId === socket.id) {
    waitingSocketId = null;
  }

  socket.leave(game.roomId);

  const opponentId = game.players.find(
    (playerSocketId) => playerSocketId && playerSocketId !== socket.id
  );
  const opponentSocket = opponentId
    ? io.sockets.sockets.get(opponentId)
    : null;

  if (!opponentSocket) {
    return;
  }

  games.delete(opponentId);
  opponentSocket.leave(game.roomId);
  joinMultiplayerGame(
    opponentSocket,
    "Opponent left. Waiting for a new opponent."
  );
}

function createBoardWithFleet() {
  const board = createBoard();
  placeFleet(board);
  return board;
}

function createBoard() {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => ({
      hasShip: false,
      wasShot: false,
      shipId: null
    }))
  );
}

function placeFleet(board) {
  FLEET.forEach((shipLength, shipIndex) => {
    let placed = false;
    const shipId = shipIndex + 1;

    while (!placed) {
      const horizontal = Math.random() < 0.5;
      const rowIndex = getRandomIndex(BOARD_SIZE);
      const colIndex = getRandomIndex(BOARD_SIZE);

      if (canPlaceShip(board, rowIndex, colIndex, shipLength, horizontal)) {
        placeShip(board, rowIndex, colIndex, shipLength, horizontal, shipId);
        placed = true;
      }
    }
  });
}

function canPlaceShip(board, rowIndex, colIndex, shipLength, horizontal) {
  for (let offset = 0; offset < shipLength; offset += 1) {
    const row = horizontal ? rowIndex : rowIndex + offset;
    const col = horizontal ? colIndex + offset : colIndex;

    if (!isBoardCell(row, col) || hasNeighboringShip(board, row, col)) {
      return false;
    }
  }

  return true;
}

function hasNeighboringShip(board, rowIndex, colIndex) {
  for (let row = rowIndex - 1; row <= rowIndex + 1; row += 1) {
    for (let col = colIndex - 1; col <= colIndex + 1; col += 1) {
      if (isBoardCell(row, col) && board[row][col].hasShip) {
        return true;
      }
    }
  }

  return false;
}

function placeShip(board, rowIndex, colIndex, shipLength, horizontal, shipId) {
  for (let offset = 0; offset < shipLength; offset += 1) {
    const row = horizontal ? rowIndex : rowIndex + offset;
    const col = horizontal ? colIndex + offset : colIndex;

    board[row][col].hasShip = true;
    board[row][col].shipId = shipId;
  }
}

function handleAiPlayerAttack(socket, game, rowIndex, colIndex) {
  if (game.gameOver) {
    sendAiGameUpdate(socket, game, "The game is already over. Restart to play again.");
    return;
  }

  if (game.currentTurn !== "human") {
    sendAiGameUpdate(socket, game, "Wait for the AI Bot to finish its turn.");
    return;
  }

  if (!isBoardCell(rowIndex, colIndex)) {
    socket.emit("message", "Attack inside the opponent board.");
    return;
  }

  const target = game.botBoard[rowIndex][colIndex];
  const cellName = getCellName(rowIndex, colIndex);

  if (target.wasShot) {
    sendAiGameUpdate(socket, game, `${cellName} was already attacked.`);
    return;
  }

  target.wasShot = true;

  if (target.hasShip) {
    const messages = [`You hit ${cellName}.`];
    const destroyedMessage = getDestroyedShipMessage(game.botBoard, target.shipId, "human");

    if (destroyedMessage) {
      markCellsAroundDestroyedShip(game.botBoard, target.shipId);
      messages.push(destroyedMessage);
    }

    if (areAllShipsSunk(game.botBoard)) {
      finishGame(game, "Human");
      messages.push("You win!");
      sendAiGameUpdate(socket, game, messages, true);
      return;
    }

    messages.push("Shoot again.");
    sendAiGameUpdate(socket, game, messages);
    return;
  }

  game.currentTurn = "bot";
  const messages = [`You missed ${cellName}.`, ...makeBotTurn(game)];

  if (game.gameOver) {
    messages.push("AI Bot wins.");
  }

  sendAiGameUpdate(socket, game, messages, game.gameOver);
}

function handleMultiplayerAttack(socket, game, rowIndex, colIndex) {
  const playerNumber = getMultiplayerPlayerNumber(game, socket.id);
  const opponentNumber = playerNumber === 1 ? 2 : 1;

  if (!game.players[1]) {
    sendMultiplayerUpdate(game, "Wait for another player to join.");
    return;
  }

  if (game.gameOver) {
    sendMultiplayerUpdate(game, "The game is already over. Reset to play again.");
    return;
  }

  if (game.currentTurn !== playerNumber) {
    socket.emit("message", "Wait for your turn.");
    return;
  }

  if (!isBoardCell(rowIndex, colIndex)) {
    socket.emit("message", "Attack inside the opponent board.");
    return;
  }

  const target = game.boards[opponentNumber - 1][rowIndex][colIndex];
  const cellName = getCellName(rowIndex, colIndex);

  if (target.wasShot) {
    socket.emit("message", `${cellName} was already attacked.`);
    return;
  }

  target.wasShot = true;
  const messages = [`Player ${playerNumber} attacked ${cellName}.`];

  if (target.hasShip) {
    messages.push("It was a hit.");

    const destroyedMessage = getMultiplayerDestroyedShipMessage(
      game.boards[opponentNumber - 1],
      target.shipId,
      playerNumber
    );

    if (destroyedMessage) {
      markCellsAroundDestroyedShip(game.boards[opponentNumber - 1], target.shipId);
      messages.push(destroyedMessage);
    }

    if (areAllShipsSunk(game.boards[opponentNumber - 1])) {
      finishGame(game, `Player ${playerNumber}`);
      messages.push(`Player ${playerNumber} wins!`);
      sendMultiplayerUpdate(game, messages, true);
      return;
    }

    messages.push(`Player ${playerNumber} shoots again.`);
    sendMultiplayerUpdate(game, messages);
    return;
  }

  game.currentTurn = opponentNumber;
  messages.push(`It was a miss. Player ${opponentNumber}'s turn.`);
  sendMultiplayerUpdate(game, messages);
}

function makeBotTurn(game) {
  const messages = [];

  while (!game.gameOver && game.currentTurn === "bot") {
    const result = makeBotMove(game);
    messages.push(result.message);

    if (result.hit) {
      const destroyedMessage = getDestroyedShipMessage(game.playerBoard, result.shipId, "bot");

      if (destroyedMessage) {
        markCellsAroundDestroyedShip(game.playerBoard, result.shipId);
        messages.push(destroyedMessage);
      }

      if (areAllShipsSunk(game.playerBoard)) {
        finishGame(game, "AI Bot");
      }
    } else {
      game.currentTurn = "human";
      messages.push("Your turn.");
    }
  }

  return messages;
}

function makeBotMove(game) {
  const availableCells = getAvailableCells(game.playerBoard);

  if (availableCells.length === 0) {
    game.currentTurn = "human";
    return {
      hit: false,
      shipId: null,
      message: "AI Bot has no moves left."
    };
  }

  const move = getBotMove(game, availableCells);
  const target = game.playerBoard[move.rowIndex][move.colIndex];

  target.wasShot = true;

  if (target.hasShip) {
    addBotTargets(game, move.rowIndex, move.colIndex);
  }

  const cellName = getCellName(move.rowIndex, move.colIndex);
  return {
    hit: target.hasShip,
    shipId: target.shipId,
    message: target.hasShip ? `AI Bot hit ${cellName}.` : `AI Bot missed ${cellName}.`
  };
}

function getAvailableCells(board) {
  const availableCells = [];

  board.forEach((row, rowIndex) => {
    row.forEach((cell, colIndex) => {
      if (!cell.wasShot) {
        availableCells.push({ rowIndex, colIndex });
      }
    });
  });

  return availableCells;
}

function getBotMove(game, availableCells) {
  game.botTargets = game.botTargets.filter((target) =>
    isValidBotTarget(game, target)
  );

  if (game.botTargets.length) {
    return game.botTargets.shift();
  }

  return availableCells[getRandomIndex(availableCells.length)];
}

function addBotTargets(game, rowIndex, colIndex) {
  const nearbyCells = [
    { rowIndex: rowIndex - 1, colIndex },
    { rowIndex: rowIndex + 1, colIndex },
    { rowIndex, colIndex: colIndex - 1 },
    { rowIndex, colIndex: colIndex + 1 }
  ];

  nearbyCells.forEach((target) => {
    const isSaved = game.botTargets.some(
      (savedTarget) =>
        savedTarget.rowIndex === target.rowIndex &&
        savedTarget.colIndex === target.colIndex
    );

    if (isValidBotTarget(game, target) && !isSaved) {
      game.botTargets.push(target);
    }
  });
}

function isValidBotTarget(game, target) {
  return (
    isBoardCell(target.rowIndex, target.colIndex) &&
    !game.playerBoard[target.rowIndex][target.colIndex].wasShot
  );
}

function sendAiGameState(socket, game) {
  socket.emit("gameState", {
    mode: "ai",
    playerId: "Human",
    ownBoard: boardToDisplayRows(game.playerBoard, true),
    opponentBoard: boardToDisplayRows(game.botBoard, false),
    opponentConnected: true,
    isYourTurn: game.currentTurn === "human" && !game.gameOver,
    gameOver: game.gameOver,
    winner: game.winner,
    currentTurn: game.currentTurn
  });
}

function sendAiGameUpdate(socket, game, messages, announceWinner = false) {
  const message = Array.isArray(messages) ? messages.join(" ") : messages;

  socket.emit("message", message);
  sendAiGameState(socket, game);

  if (announceWinner) {
    socket.emit("gameOver", { winner: game.winner });
  }
}

function sendMultiplayerGameState(socket, game) {
  const playerNumber = getMultiplayerPlayerNumber(game, socket.id);
  const opponentNumber = playerNumber === 1 ? 2 : 1;

  socket.emit("gameState", {
    mode: "multiplayer",
    playerId: `Player ${playerNumber}`,
    ownBoard: boardToDisplayRows(game.boards[playerNumber - 1], true),
    opponentBoard: boardToDisplayRows(game.boards[opponentNumber - 1], false),
    opponentConnected: Boolean(game.players[opponentNumber - 1]),
    isYourTurn:
      Boolean(game.players[1]) &&
      game.currentTurn === playerNumber &&
      !game.gameOver,
    gameOver: game.gameOver,
    winner: game.winner,
    currentTurn: game.currentTurn
  });
}

function sendMultiplayerUpdate(game, messages, announceWinner = false) {
  const message = Array.isArray(messages) ? messages.join(" ") : messages;

  game.players.forEach((playerSocketId) => {
    const playerSocket = playerSocketId
      ? io.sockets.sockets.get(playerSocketId)
      : null;

    if (!playerSocket) {
      return;
    }

    playerSocket.emit("message", message);
    sendMultiplayerGameState(playerSocket, game);

    if (announceWinner) {
      playerSocket.emit("gameOver", { winner: game.winner });
    }
  });
}

function restartMultiplayerGame(game) {
  game.boards = [createBoardWithFleet(), createBoardWithFleet()];
  game.currentTurn = 1;
  game.gameOver = false;
  game.winner = null;
  sendMultiplayerUpdate(game, "New game started. Player 1 starts.");
}

function finishGame(game, winner) {
  game.gameOver = true;
  game.winner = winner;
}

function boardToDisplayRows(board, showShips) {
  return board.map((row) =>
    row.map((cell) => {
      if (cell.wasShot && cell.hasShip) {
        return HIT;
      }

      if (cell.wasShot) {
        return MISS;
      }

      if (showShips && cell.hasShip) {
        return SHIP;
      }

      return WATER;
    })
  );
}

function areAllShipsSunk(board) {
  return board.every((row) =>
    row.every((cell) => !cell.hasShip || cell.wasShot)
  );
}

function getDestroyedShipMessage(board, shipId, actor) {
  if (!shipId) {
    return "";
  }

  const shipCells = getShipCells(board, shipId);

  if (!shipCells.every(({ cell }) => cell.wasShot)) {
    return "";
  }

  const shipLength = shipCells.length;

  if (actor === "human") {
    return `You destroyed a ${shipLength}-cell ship.`;
  }

  return `AI Bot destroyed your ${shipLength}-cell ship.`;
}

function getMultiplayerDestroyedShipMessage(board, shipId, playerNumber) {
  const shipCells = getShipCells(board, shipId);

  if (!shipCells.every(({ cell }) => cell.wasShot)) {
    return "";
  }

  return `Player ${playerNumber} destroyed a ${shipCells.length}-cell ship.`;
}

function getShipCells(board, shipId) {
  const cells = [];

  board.forEach((row, rowIndex) => {
    row.forEach((cell, colIndex) => {
      if (cell.shipId === shipId) {
        cells.push({ cell, rowIndex, colIndex });
      }
    });
  });

  return cells;
}

function markCellsAroundDestroyedShip(board, shipId) {
  getShipCells(board, shipId).forEach(({ rowIndex, colIndex }) => {
    for (let row = rowIndex - 1; row <= rowIndex + 1; row += 1) {
      for (let col = colIndex - 1; col <= colIndex + 1; col += 1) {
        if (isBoardCell(row, col) && !board[row][col].hasShip) {
          board[row][col].wasShot = true;
        }
      }
    }
  });
}

function isBoardCell(rowIndex, colIndex) {
  return (
    rowIndex >= 0 &&
    rowIndex < BOARD_SIZE &&
    colIndex >= 0 &&
    colIndex < BOARD_SIZE
  );
}

function getMultiplayerPlayerNumber(game, socketId) {
  return game.players.indexOf(socketId) + 1;
}

function getCellName(rowIndex, colIndex) {
  return `${String.fromCharCode(65 + rowIndex)}${colIndex + 1}`;
}

function getRandomIndex(max) {
  return Math.floor(Math.random() * max);
}
