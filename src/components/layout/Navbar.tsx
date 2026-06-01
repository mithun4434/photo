import { LogOut, ImagePlus, User as UserIcon, Home } from "lucide-react";
import { useAuth } from "../../hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Link, useLocation } from "react-router";

export default function Navbar() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const isProfile = location.pathname === "/profile";
  
  return (
    <nav className="glass sticky top-0 z-10 px-4 py-3 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between max-w-7xl mx-auto">
        <Link to="/" className="flex items-center gap-2 text-white hover:opacity-80 transition-opacity">
          <div className="bg-white/10 p-1.5 rounded-lg border border-white/20">
            <ImagePlus className="w-5 h-5 text-white" />
          </div>
          <span className="font-semibold text-lg tracking-tight hidden sm:inline-block">Photo Tracker</span>
        </Link>
        
        <div className="flex items-center gap-4">
          {user?.role && ['leader', 'co-leader', 'co-lead'].includes(user.role) && (
            <Button variant="ghost" size="sm" asChild className="text-white hover:bg-white/10">
              <Link to={isProfile ? "/" : "/profile"}>
                {isProfile ? <><Home className="w-4 h-4 mr-2" /> Dashboard</> : <><UserIcon className="w-4 h-4 mr-2" /> My Profile</>}
              </Link>
            </Button>
          )}
          <div className="flex items-center gap-2 text-sm text-white/90 bg-black/20 border border-white/10 px-3 py-1.5 rounded-full backdrop-blur-sm">
            <UserIcon className="w-4 h-4" />
            <span className="font-medium hidden sm:inline-block">{user?.name || user?.email}</span>
            <span className="bg-white/20 text-white uppercase text-[10px] font-bold px-1.5 py-0.5 rounded ml-1">
              {user?.role}
            </span>
          </div>
          <Button variant="ghost" size="icon" onClick={logout} title="Logout" className="text-white hover:bg-white/10">
            <LogOut className="w-5 h-5" />
          </Button>
        </div>
      </div>
    </nav>
  );
}
