import React from 'react';
import { createRoot } from 'react-dom/client';
import { Connect } from './Connect.tsx';
import Onsite from './Onsite.tsx';
import App from './App.tsx';
import './styles.css';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {location.pathname === '/reviewer-connect' ? (
      <Connect />
    ) : location.pathname === '/lab' ? (
      <App />
    ) : (
      <Onsite />
    )}
  </React.StrictMode>,
);
