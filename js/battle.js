const BOARD_SIZE = 10;
const GRID_SIZE = BOARD_SIZE + 1;
const ROW_LABEL_KEY = "COORDS";
const COLUMN_KEYS = Array.from({ length: BOARD_SIZE }, (_, index) => `${index + 1} `);
const MIN_WDR_TABLE_SIZE = 580;
const WDR_SIZE_OFFSET = 6;
const WATER_SYMBOL = ".";
const SHIP_SYMBOL = "S";
const HIT_SYMBOL = "X";
const MISS_SYMBOL = "o";
const WATER_ICON_HTML = iconHtml("board-water-icon", "images/water.svg", "Water");
const SHIP_ICON_HTML = iconHtml("board-ship-icon", "images/ship-icon.svg", "Ship");
const HIT_ICON_HTML = iconHtml("board-hit-icon", "images/hit-ship.svg", "Hit");
const MISS_ICON_HTML = iconHtml("board-miss-icon", "images/miss-water.svg", "Miss");
const requestedMode = new URLSearchParams(window.location.search).get("mode");
const gameMode = requestedMode === "multiplayer" ? "multiplayer" : "ai";

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
let isYourTurn = false;
let opponentConnected = gameMode === "ai";
let boardRenderFrame;
let initialLayoutCorrected = false;

function iconHtml(className, src, alt) {
  return `<span class="board-icon-wrap"><img class="board-cell-icon ${className}" src="${src}" alt="${alt}"></span>`;
}

function connectToServer() {
  if (typeof io === "undefined") {
    serverStatus.textContent = "Open through localhost:3000";
    playerStatus.textContent = "No socket";
    return;
  }

  socket = io();

  socket.on("connect", () => {
    serverStatus.textContent = "Socket connected";
    socket.emit("joinGame", { mode: gameMode });
  });

  socket.on("disconnect", () => {
    serverStatus.textContent = "Disconnected";
    playerStatus.textContent = "Waiting";
    opponentStatus.textContent = gameMode === "ai" ? "AI Bot" : "Waiting";
    turnStatus.textContent = "Waiting";
    isYourTurn = false;
    opponentConnected = false;
  });

  socket.on("connectionStatus", (message) => {
    serverStatus.textContent = message;
  });

  socket.on("playerAssigned", ({ playerId }) => {
    playerStatus.textContent = playerId || "Human";
  });

  socket.on("waitingForOpponent", () => {
    opponentStatus.textContent = "Waiting";
    turnStatus.textContent = "Waiting";
  });

  socket.on("gameState", (state) => {
    ownBoard = state.ownBoard;
    opponentBoard = state.opponentBoard;
    gameOver = state.gameOver;
    isYourTurn = state.isYourTurn;
    opponentConnected = state.opponentConnected;
    playerStatus.textContent = state.playerId;
    opponentStatus.textContent = getOpponentText(state);
    turnStatus.textContent = getTurnText(state);

    renderBoards();

    if (!initialLayoutCorrected) {
      initialLayoutCorrected = true;
      scheduleBoardRender();
    }

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
      [ROW_LABEL_KEY]: coordinateHtml(String.fromCharCode(65 + rowIndex))
    };

    rowCells.forEach((cell, cellIndex) => {
      row[COLUMN_KEYS[cellIndex]] = formatCellValue(cell);
    });

    return row;
  });
}

function coordinateHtml(label) {
  return `<span class="board-coordinate">${label}</span>`;
}

function formatCellValue(cell) {
  if (cell === WATER_SYMBOL) {
    return WATER_ICON_HTML;
  }

  if (cell === SHIP_SYMBOL) {
    return SHIP_ICON_HTML;
  }

  if (cell === HIT_SYMBOL) {
    return HIT_ICON_HTML;
  }

  if (cell === MISS_SYMBOL) {
    return MISS_ICON_HTML;
  }

  return cell;
}

function createReport(board, container) {
  const tableSizes = createTableSizes(getTableDimensions(container));

  return {
    dataSource: {
      data: boardToRows(board),
      mapping: createMapping()
    },
    options: {
      grid: {
        type: "flat",
        showHeaders: false,
        showTotals: "off",
        showGrandTotals: "off"
      }
    },
    tableSizes
  };
}

function getTableDimensions(container) {
  const tableElement = document.querySelector(container);

  if (!tableElement) {
    return { width: GRID_SIZE, height: GRID_SIZE };
  }

  const frame = tableElement.parentElement;
  const visibleSize = Math.min(frame.clientWidth, frame.clientHeight);
  const scale = Math.min(1, visibleSize / MIN_WDR_TABLE_SIZE);
  const renderSize = visibleSize / scale;

  tableElement.style.width = `${renderSize}px`;
  tableElement.style.height = `${renderSize}px`;
  tableElement.style.transform = scale < 1 ? `scale(${scale})` : "none";

  return {
    width: Math.floor(renderSize) - WDR_SIZE_OFFSET,
    height: Math.floor(renderSize) - WDR_SIZE_OFFSET
  };
}

function createMapping() {
  const mapping = {
    [ROW_LABEL_KEY]: {
      type: "string",
      caption: ROW_LABEL_KEY
    }
  };

  COLUMN_KEYS.forEach((columnKey, colIndex) => {
    mapping[columnKey] = {
      type: "string",
      caption: String(colIndex + 1)
    };
  });

  return mapping;
}

function createTableSizes({ width, height }) {
  const cellSize = Math.floor(Math.min(width, height) / GRID_SIZE);

  return {
    columns: Array.from({ length: GRID_SIZE }, (_, idx) => ({
      idx,
      width: cellSize
    })),
    rows: Array.from({ length: GRID_SIZE }, (_, idx) => ({
      idx,
      height: cellSize
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

function scheduleBoardRender() {
  window.cancelAnimationFrame(boardRenderFrame);

  boardRenderFrame = window.requestAnimationFrame(() => {
    boardRenderFrame = window.requestAnimationFrame(() => {
      if (ownBoard.length && opponentBoard.length) {
        renderBoards();
      }
    });
  });
}

function renderTable({ table, container, board, onClick }) {
  if (!table) {
    blockCoordinateClicks(container);

    const newTable = new WebDataRocks({
      container,
      toolbar: false,
      report: createReport(board, container)
    });

    newTable.on("cellclick", onClick);
    return newTable;
  }

  table.setReport(createReport(board, container));
  return table;
}

function blockCoordinateClicks(container) {
  const tableElement = document.querySelector(container);

  if (!tableElement) {
    return;
  }

  ["pointerdown", "click"].forEach((eventName) => {
    tableElement.addEventListener(
      eventName,
      (event) => {
        const coordinateCell = event.target.closest(
          ".wdr-header, .wdr-column-header, .board-coordinate"
        );

        if (coordinateCell) {
          event.preventDefault();
          event.stopPropagation();
        }
      },
      true
    );
  });
}

function handleOwnBoardClick(cell) {
  const position = getClickedPosition(cell);

  if (!position) {
    actionMessage.textContent = "Coordinates are labels, not game cells.";
    return;
  }

  const cellName = getCellName(position.rowIndex, position.colIndex);
  selectedCell.textContent = cellName;
  actionMessage.textContent = `${cellName} is your own board. Attack the opponent board.`;
}

function handleOpponentBoardClick(cell) {
  const position = getClickedPosition(cell);

  if (!position) {
    actionMessage.textContent = "Coordinates are labels, not game cells.";
    return;
  }

  const cellName = getCellName(position.rowIndex, position.colIndex);
  selectedCell.textContent = cellName;

  if (gameOver) {
    actionMessage.textContent = "The game is over. Restart to play again.";
    return;
  }

  if (!opponentConnected) {
    actionMessage.textContent = "Wait for another player to join.";
    return;
  }

  if (!isYourTurn) {
    actionMessage.textContent = "Wait for your turn.";
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

  if (cell.type !== "value" || cell.isTotal || cell.isGrandTotal) {
    return null;
  }

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

function getOpponentText(state) {
  if (state.mode === "ai") {
    return "AI Bot";
  }

  if (!state.opponentConnected) {
    return "Waiting";
  }

  return state.playerId === "Player 1" ? "Player 2" : "Player 1";
}

function getTurnText(state) {
  if (state.gameOver) {
    return "Game over";
  }

  if (!state.opponentConnected) {
    return "Waiting";
  }

  if (state.isYourTurn) {
    return "Your turn";
  }

  return state.mode === "ai" ? "AI Bot" : "Opponent's turn";
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

window.addEventListener("resize", () => {
  scheduleBoardRender();
});

connectToServer();
