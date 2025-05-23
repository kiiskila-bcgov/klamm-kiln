import "./App.css";
import NewFormPage from "./NewFormPage";
import EditFormPage from "./EditFormPage";
import ViewFormPage from "./ViewFormPage";
import PreviewFormPage from "./PreviewFormPage";
import PrintFormPage from "./PrintFormPage";
import UnauthorizedPage from "./UnauthorizedPage";
import ErrorPage from "./ErrorPage";
import "@carbon/styles/css/styles.css";
import "@fontsource/noto-sans";

import React, { useState, useEffect, createContext } from "react";
import { Routes, Route, useLocation, Navigate } from "react-router-dom";

import { initializeKeycloak } from "./keycloak";
import { PrivateRoute } from "./PrivateRoute";

export const AuthenticationContext = createContext<any>(null);

const App: React.FC = () => {
  const [keycloak, setKeycloak] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const location = useLocation(); // Get the current route

  // Check if we're in standalone mode
  const isStandaloneMode = import.meta.env.VITE_STANDALONE_MODE === 'true';

  // Public Routes
  const publicRoutes = ["/preview", "/unauthorized", "/printToPDF", "/error"];

  useEffect(() => {
    const initKeycloak = async () => {
      try {
        const _keycloak = await initializeKeycloak();
        setKeycloak(_keycloak);
      } catch (error) {
        console.error("Keycloak initialization error:", error);
      } finally {
        setLoading(false);
      }
    };

    // Skip authentication in standalone mode
    if (isStandaloneMode) {
      setLoading(false);
      return;
    }

    // Initialize Keycloak for protected routes
    if (!publicRoutes.includes(location.pathname)) {
      initKeycloak();
    } else {
      setLoading(false);
    }
  }, [isStandaloneMode]);

  //Loading page when waiting for authentication
  if (loading) {
    return <div>Loading authentication...</div>;
  }

  return (
    <AuthenticationContext.Provider value={keycloak}>
      <Routes>
        {/* Root route - redirect to preview in standalone mode, otherwise to new */}
        <Route path="/" element={<Navigate to={isStandaloneMode ? "/preview" : "/new"} replace />} />
        
        {/* Public Routes */}
        <Route path="/preview" element={<PreviewFormPage />} />
        <Route path="/printToPDF" element={<PrintFormPage />} />
        <Route path="/unauthorized" element={<UnauthorizedPage />} />
        <Route path="/error" element={<ErrorPage />} />

        {/* Protected Routes - bypass PrivateRoute in standalone mode */}
        {isStandaloneMode ? (
          <>
            <Route path="/new" element={<NewFormPage />} />
            <Route path="/edit" element={<EditFormPage />} />
            <Route path="/view" element={<ViewFormPage />} />
          </>
        ) : (
          <>
            <Route path="/new" element={<PrivateRoute><NewFormPage /></PrivateRoute>} />
            <Route path="/edit" element={<PrivateRoute><EditFormPage /></PrivateRoute>} />
            <Route path="/view" element={<PrivateRoute><ViewFormPage /></PrivateRoute>} />
          </>
        )}
      </Routes>
    </AuthenticationContext.Provider>
  );
};

// const WrappedApp = () => (
//   <Router>
//     <App />
//   </Router>
// );

export default App;