const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const PORT = 3000;
const BOARD_SIZE = 10;
const FLEET = [5, 4, 3, 3, 2];
const WATER = "~";
const SHIP = "S";
const HIT = "X";
const MISS = "o";

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const games = new Map();

app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

io.on("connection", (socket) => {
  console.log(`Client connected: ${socket.id}`);
  socket.emit("connectionStatus", "Connected to server");

  socket.on("joinGame", () => {
    const game = createGame();
    games.set(socket.id, game);

    socket.emit("playerAssigned", { playerId: "Human" });
    socket.emit("connectionStatus", "Connected as Human player");
    socket.emit("message", "Game started. Attack the opponent board.");
    sendGameState(socket, game);
  });

  socket.on("attack", ({ rowIndex, colIndex }) => {
    const game = games.get(socket.id);

    if (!game) {
      socket.emit("message", "Start a game first.");
      return;
    }

    handlePlayerAttack(socket, game, rowIndex, colIndex);
  });

  socket.on("restartGame", () => {
    const game = createGame();
    games.set(socket.id, game);

    socket.emit("message", "New game started.");
    sendGameState(socket, game);
  });

  socket.on("disconnect", () => {
    games.delete(socket.id);
    console.log(`Client disconnected: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`Sea Battle server is running at http://localhost:${PORT}`);
});

function createGame() {
  const playerBoard = createBoard();
  const botBoard = createBoard();

  placeFleet(playerBoard);
  placeFleet(botBoard);

  return {
    playerBoard,
    botBoard,
    gameOver: false,
    winner: null
  };
}

function createBoard() {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => ({
      hasShip: false,
      wasShot: false
    }))
  );
}

function placeFleet(board) {
  FLEET.forEach((shipLength) => {
    let placed = false;

    while (!placed) {
      const horizontal = Math.random() < 0.5;
      const rowIndex = getRandomIndex(BOARD_SIZE);
      const colIndex = getRandomIndex(BOARD_SIZE);

      if (canPlaceShip(board, rowIndex, colIndex, shipLength, horizontal)) {
        placeShip(board, rowIndex, colIndex, shipLength, horizontal);
        placed = true;
      }
    }
  });
}

function canPlaceShip(board, rowIndex, colIndex, shipLength, horizontal) {
  for (let offset = 0; offset < shipLength; offset += 1) {
    const row = horizontal ? rowIndex : rowIndex + offset;
    const col = horizontal ? colIndex + offset : colIndex;

    if (!isBoardCell(row, col) || board[row][col].hasShip) {
      return false;
    }
  }

  return true;
}

function placeShip(board, rowIndex, colIndex, shipLength, horizontal) {
  for (let offset = 0; offset < shipLength; offset += 1) {
    const row = horizontal ? rowIndex : rowIndex + offset;
    const col = horizontal ? colIndex + offset : colIndex;

    board[row][col].hasShip = true;
  }
}

function handlePlayerAttack(socket, game, rowIndex, colIndex) {
  if (game.gameOver) {
    socket.emit("message", "The game is already over. Restart to play again.");
    sendGameState(socket, game);
    return;
  }

  if (!isBoardCell(rowIndex, colIndex)) {
    socket.emit("message", "Attack inside the opponent board.");
    return;
  }

  const target = game.botBoard[rowIndex][colIndex];
  const cellName = getCellName(rowIndex, colIndex);

  if (target.wasShot) {
    socket.emit("message", `${cellName} was already attacked.`);
    sendGameState(socket, game);
    return;
  }

  target.wasShot = true;

  if (areAllShipsSunk(game.botBoard)) {
    game.gameOver = true;
    game.winner = "Human";
    socket.emit("message", `You hit ${cellName}. You win!`);
    sendGameState(socket, game);
    socket.emit("gameOver", { winner: game.winner });
    return;
  }

  const playerResult = target.hasShip ? `You hit ${cellName}.` : `You missed ${cellName}.`;
  const botResult = makeBotMove(game);

  if (areAllShipsSunk(game.playerBoard)) {
    game.gameOver = true;
    game.winner = "AI Bot";
    socket.emit("message", `${playerResult} ${botResult} AI Bot wins.`);
    sendGameState(socket, game);
    socket.emit("gameOver", { winner: game.winner });
    return;
  }

  socket.emit("message", `${playerResult} ${botResult}`);
  sendGameState(socket, game);
}

function makeBotMove(game) {
  const availableCells = [];

  game.playerBoard.forEach((row, rowIndex) => {
    row.forEach((cell, colIndex) => {
      if (!cell.wasShot) {
        availableCells.push({ rowIndex, colIndex });
      }
    });
  });

  if (availableCells.length === 0) {
    return "AI Bot has no moves left.";
  }

  const move = availableCells[getRandomIndex(availableCells.length)];
  const target = game.playerBoard[move.rowIndex][move.colIndex];

  target.wasShot = true;

  const cellName = getCellName(move.rowIndex, move.colIndex);
  return target.hasShip ? `AI Bot hit ${cellName}.` : `AI Bot missed ${cellName}.`;
}

function sendGameState(socket, game) {
  socket.emit("gameState", {
    ownBoard: boardToDisplayRows(game.playerBoard, true),
    opponentBoard: boardToDisplayRows(game.botBoard, false),
    gameOver: game.gameOver,
    winner: game.winner
  });
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

function isBoardCell(rowIndex, colIndex) {
  return (
    rowIndex >= 0 &&
    rowIndex < BOARD_SIZE &&
    colIndex >= 0 &&
    colIndex < BOARD_SIZE
  );
}

function getCellName(rowIndex, colIndex) {
  return `${String.fromCharCode(65 + rowIndex)}${colIndex + 1}`;
}

function getRandomIndex(max) {
  return Math.floor(Math.random() * max);
}
