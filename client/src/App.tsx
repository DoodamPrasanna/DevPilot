import { Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom'
import {
  Blocks,
  Bot,
  FolderTree,
  LayoutDashboard,
  MessageSquareText,
  Sparkles,
  LogOut,
} from 'lucide-react'
import { useState } from 'react'

import { useAuth } from './context/useAuth'
import { LoadingState } from './components/LoadingState'
import { ErrorState } from './components/ErrorState'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import { DashboardPage } from './pages/DashboardPage'
import { RepositoriesPage } from './pages/RepositoriesPage'
import { RepositoryDetailPage } from './pages/RepositoryDetailPage'
import { ChatPage } from './pages/ChatPage'
import { NotFoundPage } from './pages/NotFoundPage'

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/repositories', label: 'Repositories', icon: FolderTree },
  { to: '/chat', label: 'Chat', icon: MessageSquareText },
]

function AppLayout() {
  const { user, logout } = useAuth()
  const [loggingOut, setLoggingOut] = useState(false)

  const handleLogout = async () => {
    setLoggingOut(true)
    try {
      await logout()
    } finally {
      setLoggingOut(false)
    }
  }

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <aside className="w-14 shrink-0 border-r border-slate-800 bg-slate-950/95 p-2 backdrop-blur md:w-60 md:p-4 xl:w-[260px]">
        <div className="mb-8 flex items-center justify-center gap-3 rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-1 py-2 md:justify-start md:px-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-300">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="hidden md:block">
            <p className="text-xs uppercase tracking-[0.22em] text-cyan-300">DevPilot</p>
            <p className="text-sm font-semibold text-slate-100">Developer workspace</p>
          </div>
        </div>

        <nav aria-label="Main navigation" className="space-y-2">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/dashboard'}
              className={({ isActive }) =>
                [
                  'flex items-center justify-center gap-3 rounded-xl px-2 py-2.5 text-sm font-medium transition-colors md:justify-start md:px-3',
                  isActive
                    ? 'bg-cyan-500/10 text-cyan-200 ring-1 ring-cyan-400/30'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-slate-100',
                ].join(' ')
              }
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="sr-only md:not-sr-only">{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="mt-10 hidden rounded-2xl border border-slate-800 bg-slate-900/80 p-4 md:block">
          <div className="mb-3 flex items-center gap-2 text-cyan-300">
            <Bot className="h-4 w-4" />
            <span className="text-sm font-semibold">Chat scope</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-300">
            <span className="inline-flex h-2.5 w-2.5 rounded-full bg-cyan-400" aria-hidden="true" />
            General and repository chat
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/75 px-4 py-4 backdrop-blur sm:px-6">
          <div className="min-w-0">
            <p className="hidden max-w-full truncate text-xs uppercase tracking-[0.3em] text-slate-400 sm:block">Signed in as {user?.email}</p>
            <h1 className="mt-1 text-xl font-semibold text-white">DevPilot workspace</h1>
          </div>

          <div className="flex items-center gap-3">
            <NavLink
              to="/repositories?connect=1"
              className="inline-flex items-center gap-2 rounded-lg bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
            >
              <Blocks className="h-4 w-4" />
              New repo
            </NavLink>
            <button
              type="button"
              onClick={() => void handleLogout()}
              disabled={loggingOut}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-200 hover:border-slate-500 hover:bg-slate-800 disabled:opacity-60"
            >
              <LogOut className="h-4 w-4" />
              {loggingOut ? 'Signing out...' : 'Sign out'}
            </button>
          </div>
        </header>

        <div className="h-[calc(100vh-81px)] overflow-y-auto p-3 sm:p-6">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

function RequireAuth() {
  const { status, error, retry } = useAuth()

  if (status === 'loading') return <LoadingState label="Checking your session..." />
  if (status === 'error') {
    return (
      <div className="min-h-screen bg-slate-950 p-6">
        <ErrorState title="Unable to connect" message={error ?? 'Check the server and try again.'} />
        <button type="button" className="mx-auto mt-4 block rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950" onClick={() => void retry()}>
          Retry
        </button>
      </div>
    )
  }
  if (status === 'unauthenticated') return <Navigate to="/login" replace />
  return <Outlet />
}

function GuestOnly() {
  const { status } = useAuth()
  if (status === 'loading') return <LoadingState label="Checking your session..." />
  if (status === 'authenticated') return <Navigate to="/dashboard" replace />
  return <Outlet />
}

function App() {
  return (
    <Routes>
      <Route element={<GuestOnly />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/repositories" element={<RepositoriesPage />} />
        <Route path="/repositories/:repoId" element={<RepositoryDetailPage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  )
}

export default App
