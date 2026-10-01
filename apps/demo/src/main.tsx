import React from 'react';
import ReactDOM from 'react-dom/client';
import { IconContext } from '@phosphor-icons/react';
import App from './App';
import './styles/globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* Bold weight across every Phosphor glyph — matches the technical, thicker-stroke
        aesthetic in .agents/skills/minimalist-ui. Individual icons can still override. */}
    <IconContext.Provider value={{ weight: 'bold' }}>
      <App />
    </IconContext.Provider>
  </React.StrictMode>,
);
