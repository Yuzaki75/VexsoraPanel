import { Outlet, Link, useLocation, useParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export default function DashboardLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const { id: serverId } = useParams<{ id: string }>();

  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/";
    if (path.includes(":id")) {
      const basePath = path.replace(":id", serverId || "");
      return location.pathname.startsWith(basePath);
    }
    return location.pathname === path || location.pathname.startsWith(path + "/");
  };

  const navItems = [
    { path: "/", label: "Dashboard", exact: true, icon: "📊" },
    { path: "/servers", label: "Servers", icon: "🖥️" },
  ];

  const adminItems = user?.role === "admin" ? [
    { path: "/admin/nodes", label: "Nodes", icon: "🔧" },
    { path: "/admin/users", label: "Users", icon: "👥" },
    { path: "/admin/templates", label: "Templates", icon: "📋" },
  ] : [];

  const serverNavItems = serverId ? [
    { path: `/servers/${serverId}`, label: "Overview", icon: "📈" },
    { path: `/servers/${serverId}/console`, label: "Console", icon: "💻" },
    { path: `/servers/${serverId}/files`, label: "Files", icon: "📁" },
    { path: `/servers/${serverId}/databases`, label: "Databases", icon: "🗄️" },
    { path: `/servers/${serverId}/backups`, label: "Backups", icon: "💾" },
    { path: `/servers/${serverId}/schedules`, label: "Schedules", icon: "⏰" },
    { path: `/servers/${serverId}/users`, label: "Users", icon: "👤" },
    { path: `/servers/${serverId}/network`, label: "Network", icon: "🌐" },
    { path: `/servers/${serverId}/startup`, label: "Startup", icon: "🚀" },
    { path: `/servers/${serverId}/settings`, label: "Settings", icon: "⚙️" },
    { path: `/servers/${serverId}/activity`, label: "Activity", icon: "📜" },
  ] : [];

  return (
    <div className="min-h-screen bg-black flex">
      {/* Sidebar */}
      <aside className="w-64 bg-neutral-900 border-r border-neutral-800 flex-shrink-0 hidden lg:block">
        <div className="p-4 border-b border-neutral-800">
          <Link to="/" className="text-xl font-bold text-yellow-500">
            VexsoraPanel
          </Link>
        </div>
        
        <nav className="p-4 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={isActive(item.path) ? "nav-link-active" : "nav-link-inactive"}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}
          
          {serverNavItems.length > 0 && (
            <>
              <div className="pt-4 pb-2">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Server Management
                </div>
              </div>
              {serverNavItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={isActive(item.path) ? "nav-link-active" : "nav-link-inactive"}
                >
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              ))}
            </>
          )}
          
          {user?.role === "admin" && (
            <>
              <div className="pt-4 pb-2">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Administration
                </div>
              </div>
              {adminItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={isActive(item.path) ? "nav-link-active" : "nav-link-inactive"}
                >
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              ))}
            </>
          )}
        </nav>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top navigation bar */}
        <nav className="bg-neutral-900 border-b border-neutral-800">
          <div className="px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between h-14">
              <div className="flex items-center lg:hidden">
                <Link to="/" className="text-lg font-bold text-yellow-500">
                  VexsoraPanel
                </Link>
              </div>
              
              <div className="flex items-center gap-4 ml-auto">
                <span className="text-sm text-gray-400">
                  {user?.username}
                  {user?.role === "admin" && (
                    <span className="ml-2 badge badge-info">Admin</span>
                  )}
                </span>
                <Link to="/profile" className="text-sm text-gray-400 hover:text-gray-200">
                  Profile
                </Link>
                <button
                  onClick={() => logout()}
                  className="text-sm text-gray-400 hover:text-gray-200"
                >
                  Logout
                </button>
              </div>
            </div>
          </div>
        </nav>

        {/* Page content */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
