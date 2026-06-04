const BOARD_SIZE = 10;
const TABLE_COLUMNS = 11;
const TABLE_ROWS = 11;
const ROW_LABEL_COLUMN_WIDTH = 46;
const BOARD_CELL_WIDTH = 36;
const BOARD_CELL_HEIGHT = 24;

const selectedCell = document.getElementById("selected-cell");
const actionMessage = document.getElementById("action-message");
const serverStatus = document.getElementById("server-status");
const playerStatus = document.getElementById("player-status");
const opponentStatus = document.getElementById("opponent-status");
const turnStatus = document.getElementById("turn-status");
const resetButton = document.getElementById("reset-board");

let ownBoard = [];
let opponentBoard = [];
let ownTable;
let opponentTable;
let socket;
let gameOver = false;

function connectToServer() {
  if (typeof io === "undefined") {
    serverStatus.textContent = "Open through localhost:3000";
    playerStatus.textContent = "No socket";
    return;
  }

  socket = io();

  socket.on("connect", () => {
    serverStatus.textContent = "Socket connected";
    socket.emit("joinGame");
  });

  socket.on("disconnect", () => {
    serverStatus.textContent = "Disconnected";
    playerStatus.textContent = "Waiting";
    opponentStatus.textContent = "AI Bot";
    turnStatus.textContent = "Waiting";
  });

  socket.on("connectionStatus", (message) => {
    serverStatus.textContent = message;
  });

  socket.on("playerAssigned", ({ playerId }) => {
    playerStatus.textContent = playerId || "Human";
    opponentStatus.textContent = "AI Bot";
  });

  socket.on("gameState", (state) => {
    ownBoard = state.ownBoard;
    opponentBoard = state.opponentBoard;
    gameOver = state.gameOver;
    turnStatus.textContent = getTurnText(state.currentTurn, state.gameOver);

    renderBoards();

    if (state.gameOver) {
      turnStatus.textContent = "Game over";
    }
  });

  socket.on("message", (message) => {
    actionMessage.textContent = message;
  });

  socket.on("gameOver", ({ winner }) => {
    turnStatus.textContent = `${winner} won`;
  });
}

function boardToRows(board) {
  return board.map((rowCells, rowIndex) => {
    const row = {
      row: String.fromCharCode(65 + rowIndex)
    };

    rowCells.forEach((cell, cellIndex) => {
      row[`c${cellIndex + 1}`] = cell;
    });

    return row;
  });
}

function createReport(board) {
  return {
    dataSource: {
      data: boardToRows(board)
    },
    options: {
      grid: {
        type: "flat",
        showTotals: "off",
        showGrandTotals: "off"
      }
    },
    tableSizes: createTableSizes()
  };
}

function createTableSizes() {
  return {
    columns: Array.from({ length: TABLE_COLUMNS }, (_, idx) => ({
      idx,
      width: idx === 0 ? ROW_LABEL_COLUMN_WIDTH : BOARD_CELL_WIDTH
    })),
    rows: Array.from({ length: TABLE_ROWS }, (_, idx) => ({
      idx,
      height: BOARD_CELL_HEIGHT
    }))
  };
}

function renderBoards() {
  if (typeof WebDataRocks === "undefined") {
    actionMessage.textContent = "WebDataRocks did not load. Check the CDN script in battle.html.";
    return;
  }

  ownTable = renderTable({
    table: ownTable,
    container: "#own-board-table",
    board: ownBoard,
    onClick: handleOwnBoardClick
  });

  opponentTable = renderTable({
    table: opponentTable,
    container: "#opponent-board-table",
    board: opponentBoard,
    onClick: handleOpponentBoardClick
  });
}

function renderTable({ table, container, board, onClick }) {
  if (!table) {
    const newTable = new WebDataRocks({
      container,
      toolbar: false,
      report: createReport(board)
    });

    newTable.on("cellclick", onClick);
    return newTable;
  }

  table.setReport(createReport(board));
  return table;
}

function handleOwnBoardClick(cell) {
  const position = getClickedPosition(cell);

  if (!position) {
    actionMessage.textContent = "Click inside your board.";
    return;
  }

  const cellName = getCellName(position.rowIndex, position.colIndex);
  selectedCell.textContent = cellName;
  actionMessage.textContent = `${cellName} is your own board. Attack the opponent board.`;
}

function handleOpponentBoardClick(cell) {
  const position = getClickedPosition(cell);

  if (!position) {
    actionMessage.textContent = "Click inside the opponent board.";
    return;
  }

  const cellName = getCellName(position.rowIndex, position.colIndex);
  selectedCell.textContent = cellName;

  if (gameOver) {
    actionMessage.textContent = "The game is over. Restart to play again.";
    return;
  }

  if (!socket) {
    actionMessage.textContent = "Open through localhost:3000 to attack.";
    return;
  }

  socket.emit("attack", position);
}

function getClickedPosition(cell) {
  const rowIndex = cell.rowIndex - 1;
  const colIndex = cell.columnIndex - 1;

  if (!isBoardCell(rowIndex, colIndex)) {
    return null;
  }

  return { rowIndex, colIndex };
}

function getCellName(rowIndex, colIndex) {
  return `${String.fromCharCode(65 + rowIndex)}${colIndex + 1}`;
}

function isBoardCell(rowIndex, colIndex) {
  return (
    rowIndex >= 0 &&
    rowIndex < BOARD_SIZE &&
    colIndex >= 0 &&
    colIndex < BOARD_SIZE
  );
}

function getTurnText(currentTurn, isGameOver) {
  if (isGameOver) {
    return "Game over";
  }

  return currentTurn === "human" ? "Your turn" : "AI Bot";
}

resetButton.addEventListener("click", () => {
  selectedCell.textContent = "None";
  actionMessage.textContent = "Restarting game.";

  if (!socket) {
    actionMessage.textContent = "Open through localhost:3000 to restart.";
    return;
  }

  socket.emit("restartGame");
});

connectToServer();
