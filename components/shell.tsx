'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import {
  LayoutDashboard,
  TrendingUp,
  Receipt,
  FileSpreadsheet,
  Users,
  Target,
  Landmark,
  CalendarClock,
  Sparkles,
  Upload,
  Settings,
  Menu,
  X,
  LogOut,
  Handshake,
} from 'lucide-react'
import { cn } from '@/components/ui/primitives'

const NAV = [
  { href: '/', label: 'Visão geral', icon: LayoutDashboard },
  { href: '/receitas', label: 'Receitas', icon: TrendingUp },
  { href: '/despesas', label: 'Despesas e contas', icon: Receipt },
  { href: '/dre', label: 'DRE', icon: FileSpreadsheet },
  { href: '/socios', label: 'Sócios', icon: Handshake },
  { href: '/clientes', label: 'Clientes', icon: Users },
  { href: '/metas', label: 'Metas e projeção', icon: Target },
  { href: '/capacidade', label: 'Capacidade', icon: CalendarClock },
  { href: '/fiscal', label: 'Fiscal', icon: Landmark },
  { href: '/inteligencia', label: 'Inteligência', icon: Sparkles },
  { href: '/importar', label: 'Importar', icon: Upload },
  { href: '/configuracoes', label: 'Configurações', icon: Settings },
]

export function Shell({
  children,
  user,
  pendingReview,
}: {
  children: React.ReactNode
  user: { name: string; email: string }
  pendingReview: number
}) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  return (
    <div className="flex min-h-screen">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col border-r border-hairline bg-surface',
          'transition-transform lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center justify-between px-5 py-5">
          <div>
            <p className="text-[15px] font-semibold tracking-tight text-ink">Financeiro</p>
            <p className="text-[12px] text-ink-muted">Yuri dos Anjos</p>
          </div>
          <button
            className="rounded-lg p-1.5 text-ink-muted hover:bg-surface-2 lg:hidden"
            onClick={() => setOpen(false)}
            aria-label="Fechar menu"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
          {NAV.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] transition-colors',
                  active ? 'bg-surface-2 font-medium text-ink' : 'text-ink-2 hover:bg-surface-2',
                )}
              >
                <Icon size={16} className={active ? 'text-[var(--series-1)]' : 'text-ink-muted'} />
                {item.label}
                {item.href === '/receitas' && pendingReview > 0 && (
                  <span className="ml-auto rounded-full bg-[color-mix(in_srgb,var(--warning)_25%,transparent)] px-1.5 py-0.5 text-[11px] font-medium text-ink">
                    {pendingReview}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>

        <div className="border-t border-hairline px-3 py-3">
          <div className="flex items-center gap-2 px-2 py-1.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 text-[12px] font-semibold text-ink-2">
              {user.name.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-ink">{user.name}</p>
              <p className="truncate text-[11.5px] text-ink-muted">{user.email}</p>
            </div>
            <form action="/api/logout" method="post">
              <button
                type="submit"
                className="rounded-lg p-1.5 text-ink-muted hover:bg-surface-2"
                aria-label="Sair"
                title="Sair"
              >
                <LogOut size={16} />
              </button>
            </form>
          </div>
        </div>
      </aside>

      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/30 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col lg:pl-[248px]">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-hairline bg-[color-mix(in_srgb,var(--plane)_88%,transparent)] px-4 py-3 backdrop-blur lg:hidden">
          <button
            className="rounded-lg p-1.5 text-ink-2 hover:bg-surface-2"
            onClick={() => setOpen(true)}
            aria-label="Abrir menu"
          >
            <Menu size={18} />
          </button>
          <span className="text-[14px] font-semibold text-ink">Financeiro</span>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  )
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[21px] font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 text-[13.5px] text-ink-muted">{description}</p>}
      </div>
      {action && <div className="no-print">{action}</div>}
    </div>
  )
}
