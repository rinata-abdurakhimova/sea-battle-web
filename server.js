const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const PORT = 3000;
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
    currentTurn: "human",
    gameOver: false,
    winner: null
  };
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

function handlePlayerAttack(socket, game, rowIndex, colIndex) {
  if (game.gameOver) {
    socket.emit("message", "The game is already over. Restart to play again.");
    sendGameState(socket, game);
    return;
  }

  if (game.currentTurn !== "human") {
    socket.emit("message", "Wait for the AI Bot to finish its turn.");
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

  if (target.hasShip) {
    const messages = [`You hit ${cellName}.`];
    const destroyedMessage = getDestroyedShipMessage(game.botBoard, target.shipId, "human");

    if (destroyedMessage) {
      messages.push(destroyedMessage);
    }

    if (areAllShipsSunk(game.botBoard)) {
      game.gameOver = true;
      game.winner = "Human";
      messages.push("You win!");
      socket.emit("message", messages.join(" "));
      sendGameState(socket, game);
      socket.emit("gameOver", { winner: game.winner });
      return;
    }

    messages.push("Shoot again.");
    socket.emit("message", messages.join(" "));
    sendGameState(socket, game);
    return;
  }

  game.currentTurn = "bot";
  const messages = [`You missed ${cellName}.`, ...makeBotTurn(game)];

  if (areAllShipsSunk(game.playerBoard)) {
    game.gameOver = true;
    game.winner = "AI Bot";
    messages.push("AI Bot wins.");
    socket.emit("message", messages.join(" "));
    sendGameState(socket, game);
    socket.emit("gameOver", { winner: game.winner });
    return;
  }

  socket.emit("message", messages.join(" "));
  sendGameState(socket, game);
}

function makeBotTurn(game) {
  const messages = [];

  while (!game.gameOver && game.currentTurn === "bot") {
    const result = makeBotMove(game);
    messages.push(result.message);

    if (result.hit) {
      const destroyedMessage = getDestroyedShipMessage(game.playerBoard, result.shipId, "bot");

      if (destroyedMessage) {
        messages.push(destroyedMessage);
      }

      if (areAllShipsSunk(game.playerBoard)) {
        game.gameOver = true;
        game.winner = "AI Bot";
      }
    } else {
      game.currentTurn = "human";
      messages.push("Your turn.");
    }
  }

  return messages;
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
    game.currentTurn = "human";
    return {
      hit: false,
      shipId: null,
      message: "AI Bot has no moves left."
    };
  }

  const move = availableCells[getRandomIndex(availableCells.length)];
  const target = game.playerBoard[move.rowIndex][move.colIndex];

  target.wasShot = true;

  const cellName = getCellName(move.rowIndex, move.colIndex);
  return {
    hit: target.hasShip,
    shipId: target.shipId,
    message: target.hasShip ? `AI Bot hit ${cellName}.` : `AI Bot missed ${cellName}.`
  };
}

function sendGameState(socket, game) {
  socket.emit("gameState", {
    ownBoard: boardToDisplayRows(game.playerBoard, true),
    opponentBoard: boardToDisplayRows(game.botBoard, false),
    gameOver: game.gameOver,
    winner: game.winner,
    currentTurn: game.currentTurn
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

function getDestroyedShipMessage(board, shipId, actor) {
  if (!shipId || !isShipDestroyed(board, shipId)) {
    return "";
  }

  const shipLength = getShipCells(board, shipId).length;

  if (actor === "human") {
    return `You destroyed a ${shipLength}-cell ship.`;
  }

  return `AI Bot destroyed your ${shipLength}-cell ship.`;
}

function isShipDestroyed(board, shipId) {
  return getShipCells(board, shipId).every((cell) => cell.wasShot);
}

function getShipCells(board, shipId) {
  const cells = [];

  board.forEach((row) => {
    row.forEach((cell) => {
      if (cell.shipId === shipId) {
        cells.push(cell);
      }
    });
  });

  return cells;
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
