import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import LoginPage from "./pages/auth/LoginPage";
import RegisterPage from "./pages/auth/RegisterPage";
import DashboardLayout from "./layouts/DashboardLayout";
import DashboardPage from "./pages/DashboardPage";
import ServersListPage from "./pages/servers/ServersListPage";
import ServerConsolePage from "./pages/servers/ServerConsolePage";
import ServerFilesPage from "./pages/servers/ServerFilesPage";
import ServerBackupsPage from "./pages/servers/ServerBackupsPage";
import ServerSettingsPage from "./pages/servers/ServerSettingsPage";
import NodesPage from "./pages/admin/NodesPage";
import UsersPage from "./pages/admin/UsersPage";
import TemplatesPage from "./pages/admin/TemplatesPage";
import ProfilePage from "./pages/ProfilePage";

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>;
  return user ? <>{children}</> : <Navigate to="/login" replace />;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin") return <Navigate to="/" replace />;
  return <>{children}</>;
}

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        
        <Route path="/" element={<PrivateRoute><DashboardLayout /></PrivateRoute>}>
          <Route index element={<DashboardPage />} />
          <Route path="servers" element={<ServersListPage />} />
          <Route path="servers/:id/console" element={<ServerConsolePage />} />
          <Route path="servers/:id/files" element={<ServerFilesPage />} />
          <Route path="servers/:id/backups" element={<ServerBackupsPage />} />
          <Route path="servers/:id/settings" element={<ServerSettingsPage />} />
          <Route path="profile" element={<ProfilePage />} />
          
          <Route path="admin/nodes" element={<AdminRoute><NodesPage /></AdminRoute>} />
          <Route path="admin/users" element={<AdminRoute><UsersPage /></AdminRoute>} />
          <Route path="admin/templates" element={<AdminRoute><TemplatesPage /></AdminRoute>} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}

export default App;
