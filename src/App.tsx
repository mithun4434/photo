import { useEffect, useState } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router";
import { AuthProvider, useAuth } from "./hooks/use-auth";
import Login from "./pages/Login";
import Setup from "./pages/Setup";
import DashboardRoutes from "./pages/DashboardRoutes";
import { Toaster } from "@/components/ui/sonner";
import Lenis from "lenis";
import "lenis/dist/lenis.css";
import { LoadingScreen } from "./components/LoadingScreen";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  const [globalLoading, setGlobalLoading] = useState(true);

  useEffect(() => {
    const lenis = new Lenis({
      autoRaf: true,
    });
  }, []);

  return (
    <>
      {globalLoading ? (
        <LoadingScreen onComplete={() => setGlobalLoading(false)} />
      ) : (
        <AuthProvider>
          <Router>
            <Routes>
              <Route path="/setup" element={<Setup />} />
              <Route path="/login" element={<Login />} />
              <Route
                path="/*"
                element={
                  <ProtectedRoute>
                    <DashboardRoutes />
                  </ProtectedRoute>
                }
              />
            </Routes>
          </Router>
          <Toaster />
        </AuthProvider>
      )}
    </>
  );
}
