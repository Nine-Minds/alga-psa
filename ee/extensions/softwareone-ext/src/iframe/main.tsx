import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

import { AgreementsList } from '../pages/AgreementsList';
import { AgreementDetail } from '../pages/AgreementDetail';
import { StatementsList } from '../pages/StatementsList';
import { StatementDetail } from '../pages/StatementDetail';
import SettingsPageWrapper from '../components/SettingsPageWrapper';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/agreements" element={<AgreementsList />} />
        <Route path="/agreement/:id" element={<AgreementDetail />} />
        <Route path="/statements" element={<StatementsList />} />
        <Route path="/statement/:id" element={<StatementDetail />} />
        <Route path="/settings" element={<SettingsPageWrapper />} />
        <Route path="*" element={<Navigate to="/agreements" replace />} />
      </Routes>
    </Router>
  );
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}

