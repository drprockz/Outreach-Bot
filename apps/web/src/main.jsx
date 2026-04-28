import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider as UrqlProvider } from 'urql';
import { urqlClient } from './lib/urqlClient';
import './index.css';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')).render(
  <UrqlProvider value={urqlClient}>
    <App />
  </UrqlProvider>
);
