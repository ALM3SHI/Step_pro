import type { ReactNode } from 'react';

/**
 * Shared UI primitives.
 *
 * Every page previously re-declared its own card padding, button
 * colours and heading sizes, which is why nothing quite matched. These
 * are the single definition of each; a page that needs something
 * different should extend via className rather than fork the pattern.
 *
 * NOTE: none of this applies to the exam shell (`.x-*` classes). That
 * surface is a locked pixel match to the real STEP interface and must
 * not inherit product styling.
 */

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------
// Surface
// ---------------------------------------------------------------------

export function Card({
  children,
  className,
  as: Tag = 'section',
  interactive = false,
  accent,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'li' | 'article';
  /** Lifts on hover. Only for cards that are actually clickable. */
  interactive?: boolean;
  /** Coloured rail on the leading edge, for status. */
  accent?: 'brand' | 'good' | 'warn' | 'bad' | 'muted';
} & React.HTMLAttributes<HTMLElement>) {
  const rail = accent && {
    brand: 'border-r-4 border-r-[color:var(--app-brand)]',
    good: 'border-r-4 border-r-emerald-500',
    warn: 'border-r-4 border-r-amber-500',
    bad: 'border-r-4 border-r-red-500',
    muted: 'border-r-4 border-r-slate-400',
  }[accent];

  return (
    <Tag
      {...rest}
      className={cx(
        'glass rounded-2xl',
        interactive &&
          'transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-lg',
        rail,
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header className="animate-fade-up flex flex-wrap items-end gap-4">
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-bold tracking-tight text-[color:var(--app-brand)] sm:text-3xl">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-sm leading-relaxed text-[color:var(--app-muted)]">{subtitle}</p>
        )}
      </div>
      {action}
    </header>
  );
}

export function SectionTitle({
  children,
  hint,
  id,
}: {
  children: ReactNode;
  hint?: string;
  id?: string;
}) {
  return (
    <div className="mb-4">
      <h2 id={id} className="text-lg font-bold tracking-tight">{children}</h2>
      {hint && <p className="mt-0.5 text-sm text-[color:var(--app-muted)]">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-[color:var(--app-brand)] text-white hover:brightness-110 active:brightness-95',
  accent: 'bg-[color:var(--app-accent)] text-[#221503] hover:brightness-105 active:brightness-95',
  secondary:
    'border border-[color:var(--app-line)] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]',
  ghost: 'hover:bg-black/[0.05] dark:hover:bg-white/[0.07]',
  danger: 'bg-red-600 text-white hover:brightness-110',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'px-3.5 py-1.5 text-sm',
  md: 'px-5 py-2.5 text-sm',
  lg: 'px-7 py-3.5 text-base',
};

/**
 * The button's class list, without the element.
 *
 * Exported because a `next/link` must render an `<a>`, and every page
 * that wanted a link shaped like a button was re-typing the padding,
 * radius and brand colour by hand — which is how they drifted apart.
 */
export function linkClass({
  variant = 'secondary',
  size = 'md',
  block = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  className?: string;
} = {}): string {
  return cx(
    'inline-flex items-center justify-center gap-2 rounded-xl font-bold',
    'transition-[filter,background-color,transform] duration-150 active:scale-[.98]',
    'disabled:pointer-events-none disabled:opacity-45',
    VARIANTS[variant],
    SIZES[size],
    block && 'w-full',
    className,
  );
}

export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  className,
  block = false,
  ...rest
}: {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  block?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={linkClass({ variant, size, block, className })}
    >
      {children}
    </button>
  );
}

export function Pill({
  children,
  active = false,
  tone = 'brand',
  ...rest
}: {
  children: ReactNode;
  active?: boolean;
  /** Which colour the selected state takes. */
  tone?: 'brand' | 'accent';
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'rounded-full px-4 py-1.5 text-sm font-semibold transition-colors duration-150',
        'disabled:pointer-events-none disabled:opacity-40',
        active
          ? tone === 'accent'
            ? 'bg-[color:var(--app-accent)] text-[#221503]'
            : 'bg-[color:var(--app-brand)] text-white'
          : 'border border-[color:var(--app-line)] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]',
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------
// Data display
// ---------------------------------------------------------------------

export function Badge({
  children,
  tone = 'neutral',
  color,
  className,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'brand';
  /**
   * A computed colour (a section hue, a mastery status) for cases where
   * the tone is data-driven and cannot be one of the fixed five. Tints
   * the background from the same value, so callers never hand-roll the
   * `background: hex + '22'` pair again.
   */
  color?: string;
  className?: string;
}) {
  const tones = {
    neutral: 'bg-black/[0.06] text-[color:var(--app-muted)] dark:bg-white/[0.09]',
    good: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    warn: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    bad: 'bg-red-500/15 text-red-700 dark:text-red-300',
    brand: 'bg-[color:var(--app-brand)]/15 text-[color:var(--app-brand)]',
  };
  return (
    <span
      className={cx('rounded-full px-2.5 py-0.5 text-xs font-bold', !color && tones[tone], className)}
      style={
        color
          ? { color, background: `color-mix(in srgb, ${color} 15%, transparent)` }
          : undefined
      }
    >
      {children}
    </span>
  );
}

/**
 * A signed change indicator.
 *
 * Arrow AND sign AND colour — never colour alone, and never an arrow
 * alone. The caller decides whether the movement clears its own
 * significance threshold; this only renders what it is given.
 */
export function Delta({
  value,
  suffix = '',
}: {
  value: number;
  suffix?: string;
}) {
  const up = value > 0;
  return (
    <span
      className={cx(
        'text-xs font-bold tabular-nums',
        up ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300',
      )}
    >
      {up ? '▲' : '▼'} {Math.abs(value)}{suffix}
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
  semantic = false,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'good' | 'warn' | 'bad';
  /**
   * Render label/value as `dt`/`dd`. Set this when the Stat sits inside a
   * `<dl>` — a grid of labelled figures IS a description list, and screen
   * readers announce the pairing only if it is marked up as one. The
   * wrapper stays a `div`, which `dl > div > dt+dd` permits.
   */
  semantic?: boolean;
}) {
  const tones = {
    good: 'text-emerald-700 dark:text-emerald-300',
    warn: 'text-amber-700 dark:text-amber-300',
    bad: 'text-red-700 dark:text-red-300',
  };
  const Label = semantic ? 'dt' : 'div';
  const Value = semantic ? 'dd' : 'div';
  return (
    <div className="rounded-xl bg-black/[0.04] px-3 py-2.5 dark:bg-white/[0.05]">
      <Label className="text-[0.68rem] leading-tight text-[color:var(--app-muted)]">{label}</Label>
      <Value className={cx('m-0 text-base font-bold tabular-nums', tone && tones[tone])}>
        {value}
        {hint && (
          <span className="mr-1 text-[0.65rem] font-normal text-[color:var(--app-muted)]">
            {hint}
          </span>
        )}
      </Value>
    </div>
  );
}

export function Meter({
  value,
  color,
  label,
}: {
  /** 0-100. */
  value: number;
  color?: string;
  label?: string;
}) {
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/[0.09]"
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      <div
        className="h-full rounded-full transition-[width] duration-700 ease-out"
        // A 0% bar is invisible, which reads as "no data" rather than
        // "zero" — keep a sliver so the row still parses as a bar.
        style={{ width: `${Math.max(1.5, Math.min(100, value))}%`, background: color ?? 'var(--app-brand)' }}
      />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: string;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="animate-fade-in flex flex-col items-center gap-3 px-6 py-12 text-center">
      {icon && <span className="text-3xl opacity-40" aria-hidden>{icon}</span>}
      <p className="font-bold">{title}</p>
      {body && (
        <p className="max-w-sm text-sm leading-relaxed text-[color:var(--app-muted)]">{body}</p>
      )}
      {action}
    </div>
  );
}

export function Alert({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'good' | 'warn' | 'bad' | 'brand';
  children: ReactNode;
}) {
  const tones = {
    info: 'bg-black/[0.04] text-[color:var(--app-muted)] dark:bg-white/[0.05]',
    good: 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-200',
    warn: 'bg-amber-500/10 text-amber-900 dark:text-amber-200',
    bad: 'bg-red-500/10 text-red-700 dark:text-red-300',
    brand: 'bg-[color:var(--app-brand)]/10',
  };
  return (
    <div className={cx('animate-fade-in rounded-xl px-4 py-3 text-sm leading-relaxed', tones[tone])}>
      {children}
    </div>
  );
}

/** Field wrapper: label, optional hint, and inline error. */
export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex flex-wrap items-baseline gap-2 text-xs font-semibold">
        {label}
        {required && <span className="text-red-500">*</span>}
        {hint && <span className="font-normal text-[color:var(--app-muted)]">{hint}</span>}
      </span>
      {children}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

/**
 * Field classes for input / select / textarea.
 *
 * A function rather than a constant because the border is stateful, and
 * every caller that needed an error or success border was appending a
 * second `border-*` utility to a string. Tailwind resolves competing
 * utilities by their order in the generated stylesheet, NOT by their
 * order in the class attribute — so those appends won only by luck.
 * Choosing the single border here removes the coin-flip.
 */
export function inputClass({
  state,
  className,
}: {
  state?: 'invalid' | 'valid';
  className?: string;
} = {}): string {
  return cx(
    'w-full rounded-xl bg-transparent px-3.5 py-2.5 text-sm',
    'transition-colors duration-150',
    state === 'invalid'
      ? 'border-2 border-red-500'
      : state === 'valid'
        ? 'border-2 border-emerald-500 bg-emerald-500/5'
        : 'border border-[color:var(--app-line)] focus:border-[color:var(--app-brand)]',
    className,
  );
}

export { cx };
