import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AnalyticsDashboard from './pages/AnalyticsDashboard';
import CallListPage from './pages/CallListPage';
import CallDetailPage from './pages/CallDetailPage';
import LoginPage from './pages/LoginPage';

const ProtectedRoute = ({ children }) => {
  const isAuthenticated = localStorage.getItem('isAuthenticated') === 'true';
  return isAuthenticated ? children : <Navigate to="/login" replace />;
};

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<AnalyticsDashboard />} />
        <Route path="/listing" element={<CallListPage />} />
        <Route path="/call/:cleanNumber" element={<CallDetailPage />} />
      </Routes>
    </BrowserRouter>
  );
}
