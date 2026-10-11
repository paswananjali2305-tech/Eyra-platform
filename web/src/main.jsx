import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { EyraProvider } from './context/EyraContext.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <EyraProvider>
        <App />
      </EyraProvider>
    </BrowserRouter>
  </StrictMode>,
);
