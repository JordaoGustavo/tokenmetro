// Componentes mínimos inspirados no shadcn/ui
import { cn } from '../../lib/utils'

export const Card = ({ className, ...p }) => <div className={cn('rounded-lg border bg-card shadow-sm', className)} {...p} />
export const CardHeader = ({ className, ...p }) => <div className={cn('flex flex-col gap-1 p-5 pb-2', className)} {...p} />
export const CardTitle = ({ className, ...p }) => <h3 className={cn('text-sm font-medium text-muted-foreground', className)} {...p} />
export const CardContent = ({ className, ...p }) => <div className={cn('p-5 pt-2', className)} {...p} />

const BTN = {
  default: 'bg-primary text-primary-foreground hover:opacity-90',
  outline: 'border bg-background hover:bg-accent',
  ghost: 'hover:bg-accent',
}
export const Button = ({ variant = 'default', className, ...p }) => (
  <button
    className={cn('inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition disabled:opacity-50 cursor-pointer', BTN[variant], className)}
    {...p}
  />
)

export const Input = ({ className, ...p }) => (
  <input className={cn('h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20', className)} {...p} />
)

export const Select = ({ className, options, placeholder, ...p }) => (
  <select className={cn('h-9 rounded-md border bg-background px-3 text-sm outline-none cursor-pointer', className)} {...p}>
    <option value="">{placeholder}</option>
    {options.map((o) => <option key={o} value={o}>{o}</option>)}
  </select>
)

const BADGE = {
  claude: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  codex: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  cursor: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  devin: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
  subagent: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
}
export const Badge = ({ children, className }) => (
  <span className={cn('inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium', BADGE[children] || 'bg-muted text-muted-foreground', className)}>
    {children}
  </span>
)

export const Tabs = ({ value, onChange, items }) => (
  <div className="inline-flex h-9 items-center rounded-lg bg-muted p-1 text-sm">
    {items.map(([k, label]) => (
      <button
        key={k}
        onClick={() => onChange(k)}
        className={cn('rounded-md px-3 py-1 font-medium text-muted-foreground transition cursor-pointer', value === k && 'bg-background text-foreground shadow-sm')}
      >
        {label}
      </button>
    ))}
  </div>
)

export const Table = ({ className, ...p }) => (
  <div className="w-full overflow-x-auto"><table className={cn('w-full text-sm', className)} {...p} /></div>
)
export const Th = ({ className, ...p }) => <th className={cn('h-10 px-3 text-left align-middle font-medium text-muted-foreground whitespace-nowrap', className)} {...p} />
export const Td = ({ className, ...p }) => <td className={cn('px-3 py-2.5 align-middle whitespace-nowrap', className)} {...p} />
export const Tr = ({ className, ...p }) => <tr className={cn('border-b transition-colors hover:bg-muted/50', className)} {...p} />
