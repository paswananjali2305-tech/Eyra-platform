import express from 'express';
import cors from 'cors';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import uploadRouter from './routes/upload.js';
import scanRouter from './routes/scan.js';
import reportRouter from './routes/report.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS for frontend Vite dev server and production
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'CodeAudit AI Backend',
    timestamp: new Date().toISOString()
  });
});

// API Routes
app.use('/api', uploadRouter);
app.use('/api', scanRouter);
app.use('/api', reportRouter);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

// Self-healing port listener with automatic stale process reclamation
function startServer(port, retryCount = 0) {
  const server = app.listen(port, () => {
    console.log(`[CodeAudit AI] Server running on http://localhost:${port}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      if (retryCount < 2) {
        console.warn(`[CodeAudit AI] Port ${port} is occupied. Reclaiming port...`);
        try {
          if (process.platform === 'win32') {
            const out = execSync(`netstat -ano | findstr :${port}`).toString();
            const lines = out.trim().split('\n');
            for (const line of lines) {
              const parts = line.trim().split(/\s+/);
              const pid = parts[parts.length - 1];
              if (pid && pid !== '0' && pid !== String(process.pid)) {
                execSync(`taskkill /F /PID ${pid}`);
                console.log(`[CodeAudit AI] Terminated stale PID ${pid} on port ${port}`);
              }
            }
          }
        } catch (e) {}
        setTimeout(() => startServer(port, retryCount + 1), 600);
      } else {
        console.warn(`[CodeAudit AI] Port ${port} occupied. Trying alternative port ${Number(port) + 1}...`);
        startServer(Number(port) + 1, 0);
      }
    } else {
      console.error('Server error:', err);
    }
  });
}

startServer(PORT);
