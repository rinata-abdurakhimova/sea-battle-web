# Sea Battle Web

Sea Battle game built with HTML, CSS, JavaScript, WebDataRocks, Node.js, Express, and Socket.IO.

Live project: https://sea-battle-web.onrender.com/

## Features

- Human vs AI mode
- Two-player mode in separate browser tabs
- Server-owned game state
- Automatic ship placement
- Real Sea Battle turn logic: a hit gives another shot, a miss changes the turn
- Destroyed ship messages
- Surrounding cells are marked after a ship is destroyed
- WebDataRocks tables for both player and opponent boards

## Run Locally

Requirements:

- Node.js 20 or newer
- npm

Install dependencies:

```powershell
npm install
```

Start the server:

```powershell
npm start
```

Open the project:

```text
http://localhost:3000/
```

## How To Play

Open the start page and choose a mode:

- **Human vs AI**: play against the server bot.
- **Two Players**: open the same mode in two browser tabs. The first tab becomes Player 1, and the second tab becomes Player 2.

Attack by clicking cells on the opponent board.

## Deployment

The project is deployed as one Render Web Service.

Render settings:

```text
Build Command: npm install
Start Command: npm start
Health Check Path: /health
```

Render provides the server port automatically through `process.env.PORT`, and the app falls back to port `3000` locally.
