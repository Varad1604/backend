import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { can, landingPath, type Capability } from './permissions';
import { LoadingState } from '../components/ui/States';

export const CHANGE_PASSWORD_PATH = '/account/password';

/** Where the login page sends the user back to after a session ends. */
export interface LoginRedirectState {
  from?: string;
}
export function RequireAuth() {
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return <LoadingState label="Checking your session…" className="min-h-dvh" />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search } satisfies LoginRedirectState} />;
  // Server flag after an admin creates the account or resets the password (brief §5.6).
  if (user.mustChangePassword && loc.pathname !== CHANGE_PASSWORD_PATH) return <Navigate to={CHANGE_PASSWORD_PATH} replace />;
  return <Outlet />;
}
export function RequireCap({ cap, children }: { cap: Capability | Capability[]; children: React.ReactNode }) {
  const { user } = useAuth();
  const caps = Array.isArray(cap) ? cap : [cap];
  if (!caps.some(c => can(user, c))) return <Navigate to="/home" replace />;
  return <>{children}</>;
}
export function HomeRedirect() {
  const { user } = useAuth();
  return <Navigate to={user ? landingPath(user) : '/login'} replace />;
}
