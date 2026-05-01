import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import AnalyticsDashboard from './pages/AnalyticsDashboard';
import TrendsDashboard from './pages/TrendsDashboard';
import InsightsDashboard from './pages/InsightsDashboard';
import CallListPage from './pages/CallListPage';
import CallDetailPage from './pages/CallDetailPage';
import LoginPage from './pages/LoginPage';
import TrainerHome from './pages/trainer/TrainerHome';
import TrainerIdentify from './pages/trainer/TrainerIdentify';
import TrainerAdmin from './pages/trainer/TrainerAdmin';
import TrainerDisabled from './pages/trainer/TrainerDisabled';
import StoreSwotPage from './pages/trainer/StoreSwotPage';
import PersonaLibraryPage from './pages/trainer/admin/PersonaLibraryPage';
import DrillPage from './pages/trainer/DrillPage';
import ScoreCardPage from './pages/trainer/ScoreCardPage';
import DrillsListPage from './pages/trainer/DrillsListPage';

const ProtectedRoute = ({ children }) => {
  const isAuthenticated = localStorage.getItem('isAuthenticated') === 'true';
  return isAuthenticated ? children : <Navigate to="/login" replace />;
};

const PublicOnlyRoute = ({ children }) => {
  const isAuthenticated = localStorage.getItem('isAuthenticated') === 'true';
  return isAuthenticated ? <Navigate to="/" replace /> : children;
};

const SessionChecker = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  
  useEffect(() => {
    const isAuthenticated = localStorage.getItem('isAuthenticated') === 'true';
    // If not authenticated and not on login page, redirect to login
    if (!isAuthenticated && location.pathname !== '/login') {
      navigate('/login', { replace: true });
    }
  }, [location.pathname, navigate]);
  
  return children;
};

export default function App() {
  return (
    <BrowserRouter>
      <SessionChecker>
      <Routes>
        <Route
          path="/login"
          element={
            <PublicOnlyRoute>
              <LoginPage />
            </PublicOnlyRoute>
          }
        />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <AnalyticsDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/trends"
          element={
            <ProtectedRoute>
              <TrendsDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/insights"
          element={
            <ProtectedRoute>
              <InsightsDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/listing"
          element={
            <ProtectedRoute>
              <CallListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/call/:cleanNumber"
          element={
            <ProtectedRoute>
              <CallDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/trainer"
          element={
            <ProtectedRoute>
              <TrainerHome />
            </ProtectedRoute>
          }
        />
        <Route
          path="/trainer/identify"
          element={
            <ProtectedRoute>
              <TrainerIdentify />
            </ProtectedRoute>
          }
        />
        <Route
          path="/trainer/admin/*"
          element={
            <ProtectedRoute>
              <TrainerAdmin />
            </ProtectedRoute>
          }
        />
        <Route
          path="/trainer/disabled"
          element={
            <ProtectedRoute>
              <TrainerDisabled />
            </ProtectedRoute>
          }
        />
        <Route
          path="/trainer/swot/:storeName"
          element={
            <ProtectedRoute>
              <StoreSwotPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/trainer/admin/personas"
          element={
            <ProtectedRoute>
              <PersonaLibraryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/trainer/drill/:drillUuid"
          element={
            <ProtectedRoute>
              <DrillPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/trainer/score-cards/:drillUuid"
          element={
            <ProtectedRoute>
              <ScoreCardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/trainer/drills"
          element={
            <ProtectedRoute>
              <DrillsListPage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </SessionChecker>
    </BrowserRouter>
  );
}
