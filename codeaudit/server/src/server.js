import express from 'express';
import cors from 'cors';
import uploadRouter from './routes/upload.js';
import scanRouter from './routes/scan.js';
import reportRouter from './routes/report.js';
import { handleBindError } from './services/internalAuth.js';

const app = express();
const PORT = Number(process.env.PORT || 5000);

function corsOrigins() {
  const raw = process.env.EYRA_AUDIT_CORS_ORIGINS
    || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174';
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

app.use(cors({
  origin: corsOrigins(),
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Eyra-User-Id', 'X-Eyra-Ts', 'X-Eyra-Sig'],
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

function startServer(port) {
  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`[CodeAudit AI] Server running on http://127.0.0.1:${port}`);
  });

  server.on('error', (err) => {
    const outcome = handleBindError(err, port);
    console.error(`[CodeAudit AI] ${outcome.message}`);
    process.exit(1);
  });
}

startServer(PORT);
