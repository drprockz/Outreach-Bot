import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { isLoggedIn } from './api.js';
import Sidebar from './components/Sidebar.jsx';
import Login from './views/Login.jsx';
import Overview from './views/Overview.jsx';
import Pipeline from './views/Pipeline.jsx';
import Analytics from './views/Analytics.jsx';
import Costs from './views/Costs.jsx';
import Reports from './views/Reports.jsx';
import Emails from './views/Emails.jsx';

function ProtectedLayout() {
  if (!isLoggedIn()) return <Navigate to="/login" />;
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#050505' }}>
      <Sidebar />
      <main style={{
        flex: 1,
        padding: '32px 40px',
        overflowY: 'auto',
        maxHeight: '100vh',
        background: '#0a0a0a',
        backgroundImage: 'radial-gradient(ellipse at 0% 0%, #6366f108 0%, transparent 50%)',
      }}>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/pipeline" element={<Pipeline />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/costs" element={<Costs />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/emails" element={<Emails />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/*" element={<ProtectedLayout />} />
      </Routes>
    </BrowserRouter>
  );
}
