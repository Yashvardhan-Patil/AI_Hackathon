# API Debugging Copilot

A compact Electron.js desktop AI assistant that helps developers debug API issues, analyze logs, and monitor API health — all from a sleek floating window beside your IDE.

## Features

- 🤖 **AI-Powered Debugging** — Chat with Groq-powered AI (llama-3.3-70b) to analyze API failures
- 📋 **Real-time Logs Panel** — Monitor backend logs, terminal errors, and failed requests
- ❤️ **API Health Dashboard** — Track endpoint status with live indicators
- 🎤 **Voice Input** — Speak your debugging questions hands-free
- 📌 **Always-on-Top** — Keep the assistant floating above your workspace
- 🔍 **File Monitoring** — Automatically detect errors in your project logs
- 💡 **Smart Fixes** — Get root-cause analysis with suggested fixes
- 🎯 **Compact UI** — Narrow, mobile-style layout optimized for side-by-side coding

## Tech Stack

- **Frontend:** Electron.js + React + Tailwind CSS + Vite
- **Backend:** Node.js + Express.js + Socket.IO
- **AI:** Groq API (llama-3.3-70b-versatile)
- **Build:** Vite + electron-builder

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- A Groq API key (get one at [groq.com](https://groq.com))

### Installation

1. Clone the repo:
   ```bash
   git clone <repo-url>
   cd api-debugging-copilot
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and add your Groq API key:
   ```
   GROQ_API_KEY=gsk_your_api_key_here
   PORT=3001
   ```

4. Start in development mode:
   ```bash
   npm run dev
   ```

   This starts:
   - Vite dev server on port 5173 (React frontend)
   - Electron window loading the app
   - Express backend on port 3001 (auto-started by Electron)

### Building for Production

```bash
npm run build
```

## Project Structure

```
api-debugging-copilot/
├── src/
│   ├── main/           # Electron main process
│   │   ├── main.js     # Window creation, app lifecycle
│   │   ├── preload.js  # Secure bridge to renderer
│   │   └── tray.js     # System tray support
│   ├── renderer/       # React frontend (Vite)
│   │   ├── index.html
│   │   ├── index.jsx
│   │   ├── App.jsx
│   │   ├── styles/
│   │   │   └── index.css
│   │   ├── components/ # UI components
│   │   └── hooks/      # Custom React hooks
│   └── backend/        # Express server
│       ├── server.js
│       ├── routes/
│       ├── services/
│       └── utils/
├── sample-logs/        # Mock log files for testing
├── .env.example
├── package.json
├── vite.config.js
├── tailwind.config.js
└── postcss.config.js
```

## Usage

1. Launch the app — a compact dark-themed window appears
2. Click **Select Project** to point the assistant to your project folder
3. Use the tabs to switch between:
   - **Assistant** — Chat with AI about debugging issues
   - **Logs** — View real-time logs from your project
   - **API Health** — Monitor endpoint statuses
   - **Settings** — Configure API keys, auto-fix options, and more
4. Ask questions like:
   - "Why is my API failing?"
   - "Analyze current backend errors"
   - "Fix this API issue"

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `GROQ_API_KEY` | Your Groq API key | — |
| `PORT` | Backend server port | 3001 |
| `MODEL` | Groq model name | llama-3.3-70b-versatile |

## Sample Logs

The `sample-logs/` directory contains mock API error logs to test the assistant's analysis capabilities.

## License

MIT
