const BOARD_SIZE = 10;
const TABLE_COLUMNS = 11;
const TABLE_ROWS = 11;
const ROW_LABEL_KEY = "COORDS";
const COLUMN_KEYS = Array.from({ length: BOARD_SIZE }, (_, index) => `${index + 1} `);
const ROW_LABEL_WIDTH_RATIO = 0.08;
const MIN_WDR_TABLE_SIZE = 580;
const WATER_SYMBOL = ".";
const SHIP_SYMBOL = "S";
const HIT_SYMBOL = "X";
const MISS_SYMBOL = "o";
const WATER_ICON_HTML = iconHtml("board-water-icon", "images/water.svg", "Water");
const SHIP_ICON_HTML = iconHtml("board-ship-icon", "images/ship-icon.svg", "Ship");
const HIT_ICON_HTML = iconHtml("board-hit-icon", "images/hit-ship.svg", "Hit");
const MISS_ICON_HTML = iconHtml("board-miss-icon", "images/miss-water.svg", "Miss");

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
  prepareTableContainer(container);
  const tableSizes = createTableSizes(container);

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

function prepareTableContainer(container) {
  const tableElement = document.querySelector(container);

  if (!tableElement) {
    return;
  }

  const frame = tableElement.parentElement;
  const frameWidth = frame.clientWidth;
  const frameHeight = frame.clientHeight;
  const scale = Math.min(1, frameWidth / MIN_WDR_TABLE_SIZE);

  if (scale < 1) {
    tableElement.style.width = `${MIN_WDR_TABLE_SIZE}px`;
    tableElement.style.height = `${Math.max(MIN_WDR_TABLE_SIZE, frameHeight / scale)}px`;
    tableElement.style.transform = `scale(${scale})`;
    return;
  }

  tableElement.style.width = "100%";
  tableElement.style.height = "100%";
  tableElement.style.transform = "none";
}

function createMapping() {
  const mapping = {
    [ROW_LABEL_KEY]: {
      type: "string",
      caption: ""
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

function createTableSizes(container) {
  const containerWidth = Math.max(TABLE_COLUMNS, getContainerWidth(container) - 6);
  const containerHeight = Math.max(TABLE_ROWS, getContainerHeight(container) - 6);
  const rowLabelWidth = Math.max(1, Math.floor(containerWidth * ROW_LABEL_WIDTH_RATIO));
  const boardCellWidth = Math.max(1, Math.floor((containerWidth - rowLabelWidth) / BOARD_SIZE));
  const boardCellHeight = Math.max(1, Math.floor(containerHeight / TABLE_ROWS));

  return {
    columns: Array.from({ length: TABLE_COLUMNS }, (_, idx) => ({
      idx,
      width: idx === 0 ? rowLabelWidth : boardCellWidth
    })),
    rows: Array.from({ length: TABLE_ROWS }, (_, idx) => ({
      idx,
      height: boardCellHeight
    }))
  };
}

function getContainerWidth(container) {
  const element = document.querySelector(container);

  if (!element) {
    return TABLE_COLUMNS;
  }

  return element.clientWidth || TABLE_COLUMNS;
}

function getContainerHeight(container) {
  const element = document.querySelector(container);

  if (!element) {
    return TABLE_ROWS;
  }

  return element.clientHeight || TABLE_ROWS;
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

window.addEventListener("resize", () => {
  scheduleBoardRender();
});

connectToServer();
