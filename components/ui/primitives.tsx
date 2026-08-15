import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { ReactNode } from 'react'
import { formatBRL, formatVariation } from '@/lib/money'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/* ------------------------------------------------------------------ *
 * Superfícies
 * ------------------------------------------------------------------ */

export function Card({
  children,
  className,
  title,
  subtitle,
  action,
}: {
  children: ReactNode
  className?: string
  title?: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
}) {
  return (
    <section
      className={cn(
        'rounded-[10px] border border-hairline bg-surface',
        'shadow-[0_1px_2px_rgba(11,11,11,0.04)]',
        className,
      )}
    >
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 border-b border-hairline px-5 py-4">
          <div>
            {title && <h2 className="text-[15px] font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[13px] text-ink-muted">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

/* ------------------------------------------------------------------ *
 * Números
 * ------------------------------------------------------------------ */

export function Stat({
  label,
  value,
  hint,
  delta,
  tone = 'neutral',
  className,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  delta?: number | null
  tone?: 'neutral' | 'good' | 'warning' | 'critical'
  className?: string
}) {
  const toneClass = {
    neutral: 'text-ink',
    good: 'text-[var(--good-text)]',
    warning: 'text-[var(--serious)]',
    critical: 'text-[var(--critical)]',
  }[tone]

  return (
    <div className={cn('rounded-[10px] border border-hairline bg-surface px-5 py-4', className)}>
      <p className="text-[12px] font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <p className={cn('mt-1.5 text-[26px] font-semibold leading-none', toneClass)}>{value}</p>
      <div className="mt-2 flex items-center gap-2 text-[12.5px] text-ink-muted">
        {delta !== undefined && delta !== null && <DeltaBadge value={delta} />}
        {hint && <span>{hint}</span>}
      </div>
    </div>
  )
}

export function DeltaBadge({ value, invert = false }: { value: number | null; invert?: boolean }) {
  if (value === null) return <span className="text-ink-muted">—</span>
  const positive = invert ? value < 0 : value > 0
  const neutral = Math.abs(value) < 0.005

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[12px] font-medium',
        neutral
          ? 'bg-surface-2 text-ink-muted'
          : positive
            ? 'bg-[color-mix(in_srgb,var(--good)_14%,transparent)] text-[var(--good-text)]'
            : 'bg-[color-mix(in_srgb,var(--critical)_14%,transparent)] text-[var(--critical)]',
      )}
    >
      {!neutral && <span aria-hidden>{positive ? '▲' : '▼'}</span>}
      {formatVariation(value)}
    </span>
  )
}

export function Money({
  cents,
  className,
  signed = false,
}: {
  cents: number | null | undefined
  className?: string
  signed?: boolean
}) {
  const value = cents ?? 0
  const negative = value < 0
  return (
    <span className={cn('tabular', negative && 'text-[var(--critical)]', className)}>
      {signed && value > 0 ? '+' : ''}
      {formatBRL(value)}
    </span>
  )
}

/* ------------------------------------------------------------------ *
 * Estado e rótulos
 * ------------------------------------------------------------------ */

const BADGE_TONES = {
  neutral: 'bg-surface-2 text-ink-2 border-hairline',
  good: 'bg-[color-mix(in_srgb,var(--good)_12%,transparent)] text-[var(--good-text)] border-[color-mix(in_srgb,var(--good)_35%,transparent)]',
  warning: 'bg-[color-mix(in_srgb,var(--warning)_18%,transparent)] text-ink border-[color-mix(in_srgb,var(--warning)_45%,transparent)]',
  serious: 'bg-[color-mix(in_srgb,var(--serious)_16%,transparent)] text-ink border-[color-mix(in_srgb,var(--serious)_45%,transparent)]',
  critical: 'bg-[color-mix(in_srgb,var(--critical)_12%,transparent)] text-[var(--critical)] border-[color-mix(in_srgb,var(--critical)_35%,transparent)]',
  info: 'bg-[color-mix(in_srgb,var(--series-1)_12%,transparent)] text-[var(--series-1)] border-[color-mix(in_srgb,var(--series-1)_35%,transparent)]',
} as const

export function Badge({
  children,
  tone = 'neutral',
  icon,
  className,
}: {
  children: ReactNode
  tone?: keyof typeof BADGE_TONES
  icon?: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[12px] font-medium',
        BADGE_TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  )
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <p className="text-[15px] font-medium text-ink">{title}</p>
      {description && <p className="max-w-md text-[13.5px] text-ink-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Tabelas
 * ------------------------------------------------------------------ */

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full min-w-[600px] border-collapse text-[13.5px]', className)}>{children}</table>
    </div>
  )
}

export function Th({
  children,
  align = 'left',
  className,
}: {
  children?: ReactNode
  align?: 'left' | 'right' | 'center'
  className?: string
}) {
  return (
    <th
      className={cn(
        'border-b border-hairline px-4 py-2.5 text-[12px] font-medium uppercase tracking-wide text-ink-muted',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        align === 'left' && 'text-left',
        className,
      )}
    >
      {children}
    </th>
  )
}

export function Td({
  children,
  align = 'left',
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & {
  children?: ReactNode
  align?: 'left' | 'right' | 'center'
  className?: string
}) {
  return (
    <td
      {...props}
      className={cn(
        'border-b border-hairline px-4 py-2.5 text-ink-2',
        align === 'right' && 'text-right tabular',
        align === 'center' && 'text-center',
        className,
      )}
    >
      {children}
    </td>
  )
}

/* ------------------------------------------------------------------ *
 * Controles
 * ------------------------------------------------------------------ */

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
}) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-2.5 py-1.5 text-[13px]' : 'px-3.5 py-2 text-[13.5px]',
        {
          primary: 'bg-ink text-[var(--plane)] hover:opacity-90',
          secondary: 'border border-hairline bg-surface text-ink hover:bg-surface-2',
          ghost: 'text-ink-2 hover:bg-surface-2',
          danger: 'bg-[var(--critical)] text-white hover:opacity-90',
        }[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-[13.5px] text-ink',
        'placeholder:text-ink-muted focus:border-[var(--series-1)] focus:outline-none',
        className,
      )}
      {...props}
    />
  )
}

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'rounded-lg border border-hairline bg-surface px-3 py-2 text-[13.5px] text-ink',
        'focus:border-[var(--series-1)] focus:outline-none',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  )
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-[13.5px] text-ink',
        'placeholder:text-ink-muted focus:border-[var(--series-1)] focus:outline-none',
        className,
      )}
      {...props}
    />
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-ink-muted">{hint}</span>}
    </label>
  )
}

/* ------------------------------------------------------------------ *
 * Barra de progresso (metas, teto do MEI, ocupação)
 * ------------------------------------------------------------------ */

export function ProgressBar({
  ratio,
  tone = 'info',
  markers,
  className,
}: {
  ratio: number
  tone?: 'info' | 'good' | 'warning' | 'critical'
  markers?: Array<{ at: number; label: string }>
  className?: string
}) {
  const color = {
    info: 'var(--series-1)',
    good: 'var(--good)',
    warning: 'var(--warning)',
    critical: 'var(--critical)',
  }[tone]

  return (
    <div className={cn('relative h-2.5 w-full overflow-hidden rounded-full bg-surface-2', className)}>
      <div
        className="h-full rounded-full transition-[width]"
        style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%`, background: color }}
      />
      {markers?.map((marker) => (
        <span
          key={marker.label}
          title={marker.label}
          className="absolute top-0 h-full w-px bg-[var(--ink-muted)]"
          style={{ left: `${Math.min(100, marker.at * 100)}%` }}
        />
      ))}
    </div>
  )
}
