import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { RootErrorBoundary } from './components/RootErrorBoundary.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { EyraProvider } from './context/EyraContext.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RootErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <EyraProvider>
            <App />
          </EyraProvider>
        </AuthProvider>
      </BrowserRouter>
    </RootErrorBoundary>
  </StrictMode>,
);
