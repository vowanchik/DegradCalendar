import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { Widget } from './Widget';
import './styles.css';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{window.partyupWidget ? <Widget /> : <App />}</React.StrictMode>,
);
