import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, House, KeyRound, LogOut, Menu, UserRound, X } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { CHANGE_PASSWORD_PATH } from '../../auth/guards';
import { can, roleLabel } from '../../auth/permissions';
import { config } from '../../config';
import { navItems } from './nav';
import { PrototypeBanner } from './PrototypeBanner';
import { Wordmark } from './BrandMark';
import { cn } from '../ui/cn';

// Demo tools drive the mock adapter only. In an http build this constant-folds to null.
const DemoTools = import.meta.env.VITE_API_MODE === 'http' ? null : lazy(() => import('./DemoTools'));

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onDown); };
  }, [open, close]);
  return ref;
}

const pop = 'absolute right-0 top-full z-40 mt-2 w-[280px] rounded-xl border border-rule bg-surface p-2 shadow-xl';
const popItem = 'flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-[16px] text-ink hover:bg-brand-50';

/** Who is signed in (button name = display name), role, Change password. */
function AccountMenu({ name, roles }: { name: string; roles?: string }) {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const ref = useDismiss(open, () => setOpen(false));
  return (
    <div ref={ref} className="relative min-w-0">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="account-menu" aria-label={name}
        className="flex min-h-11 max-w-[260px] items-center gap-2 rounded-lg px-2 text-left text-white hover:bg-white/10">
        <UserRound aria-hidden size={22} strokeWidth={1.75} className="shrink-0" />
        <span className="hidden min-w-0 flex-col leading-tight md:flex">
          <span className="truncate text-[15px] font-semibold">{name}</span>
          <span className="truncate text-[13px] text-white/75">{roles}</span>
        </span>
        <ChevronDown aria-hidden size={18} className="shrink-0" />
      </button>
      {open && (
        <div id="account-menu" className={pop}>
          <p className="border-b border-rule px-3 pb-2 pt-1 text-[15px]"><span className="font-semibold text-ink">{name}</span>{roles && <><br /><span className="text-muted">{roles}</span></>}</p>
          <Link to={CHANGE_PASSWORD_PATH} className={cn(popItem, 'mt-1')}><KeyRound aria-hidden size={20} strokeWidth={1.75} />Change password</Link>
        </div>
      )}
    </div>
  );
}

/** Admin-only page menu. Other roles work from their Home cards. */
function AdminMenu({ items }: { items: typeof navItems }) {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const ref = useDismiss(open, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="main-nav"
        className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-[16px] font-medium text-white hover:bg-white/10">
        {open ? <X aria-hidden size={20} /> : <Menu aria-hidden size={20} />}<span className="hidden sm:inline">Menu</span>
      </button>
      {open && (
        <nav id="main-nav" aria-label="Main" className={cn(pop, 'left-0 right-auto')}>
          {items.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => cn(popItem, isActive && 'bg-brand-50 font-semibold text-brand-700')}>{i.label}</NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}

export function AppShell() {
  const navigate = useNavigate();
  const loc = useLocation();
  const { user, logout } = useAuth();
  const items = navItems.filter((i) => i.caps.some((c) => can(user, c)));
  const roles = user?.roles.map((r) => roleLabel[r]).join(', ');
  const isAdmin = !!user?.roles.includes('admin');
  const atHome = loc.pathname === '/home';
  const signOut = async () => { await logout(); navigate('/login'); };

  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <PrototypeBanner tools={DemoTools && config.isMock ? <Suspense fallback={null}><DemoTools /></Suspense> : undefined} />
      <header className="sticky top-0 z-30 bg-brand-900 text-white shadow-md">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center gap-2 px-3 sm:gap-3 md:px-6">
          <Link to="/home" className="flex min-h-11 items-center rounded-lg px-1" aria-label="KPMPL Gate to Bill, home"><Wordmark inverse /></Link>
          <Link to="/home" aria-current={atHome ? 'page' : undefined}
            className={cn('ml-1 flex min-h-11 items-center gap-2 rounded-lg px-3 text-[16px] font-semibold sm:ml-3',
              atHome ? 'bg-white/15 text-white' : 'bg-white text-brand-900 hover:bg-brand-50')}>
            <House aria-hidden size={20} strokeWidth={2} /><span>Home</span>
          </Link>
          {isAdmin && <AdminMenu items={items} />}
          <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-2">
            {user && <AccountMenu name={user.displayName} roles={roles} />}
            <button type="button" aria-label="Sign out" onClick={signOut}
              className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-[16px] font-medium text-white hover:bg-white/10">
              <LogOut aria-hidden size={20} strokeWidth={1.75} /><span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      <main id="main" className="min-w-0 flex-1 px-4 pb-16 pt-6 md:px-8 md:pt-8">
        <div className="mx-auto w-full max-w-[1216px]">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
