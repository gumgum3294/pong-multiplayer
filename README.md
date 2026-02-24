# 🏓 PONG.IO — Online Multiplayer Ping Pong

A real-time multiplayer ping pong game built with Node.js, Socket.io, and HTML Canvas.

## Features
- Real-time online multiplayer (two different devices/browsers)
- Create rooms with custom names and share 6-character room codes
- Authoritative server-side game loop (no cheating!)
- Ball physics with angle-based paddle deflection and speed scaling
- Hit particles and ball trail effects
- Score tracking — first to 7 wins
- Rematch system
- Connection status indicator
- Live room browser

---

## Quick Start

### Requirements
- Node.js v16 or higher
- npm

### Install & Run

```bash
# 1. Install dependencies
npm install

# 2. Start the server
npm start
```

The server starts at **http://localhost:3000**

Open it in **two different browser windows** (or two devices on the same network) and play!

---

## How to Play

1. **Enter your username** and click "Enter Lobby"
2. **Create a Room** or join an existing one from the room list
3. Share the **6-character room code** with your opponent
4. Once both players are in, the host clicks **Start Game**
5. Countdown → Play! First to **7 points** wins.

### Controls

| Player | Keys |
|--------|------|
| Player 1 (Left paddle) | `W` / `S` |
| Player 2 (Right paddle) | `↑` / `↓` Arrow Keys |

---

## Play Over the Internet

To play with friends online (not just local network):

### Option A — ngrok (easiest)
```bash
# Install ngrok: https://ngrok.com
npm start
# In another terminal:
ngrok http 3000
# Share the https://xxxx.ngrok.io URL with your friend
```

### Option B — Deploy to Railway / Render / Fly.io
- Push this folder to a GitHub repo
- Deploy on [
