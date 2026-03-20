# Stripe — Design System

> Light, clean, high-trust. Precision that converts.

---

## Quick Reference

**Aesthetic:** Clean whites and cool grays communicate reliability. Purple accent is used only where action is required. Typography is native system stack for maximum legibility. Layouts are generous — plenty of breathing room to reduce cognitive load at critical moments.

### Colour Palette
| Role | Token | Value |
|---|---|---|
| App background | `--stripe-bg-app` | `#F6F9FC` |
| Card/surface | `--stripe-bg-surface` | `#FFFFFF` |
| Hover background | `--stripe-bg-hover` | `#F6F9FC` |
| Border (default) | `--stripe-border` | `#E3E8EE` |
| Border (strong) | `--stripe-border-strong` | `#C1C9D2` |
| Border (focus) | `--stripe-border-focus` | `#635BFF` |
| Primary text | `--stripe-text-primary` | `#1A1F36` |
| Secondary text | `--stripe-text-secondary` | `#3C4257` |
| Muted text | `--stripe-text-muted` | `#697386` |
| Accent | `--stripe-accent` | `#635BFF` |
| Accent hover | `--stripe-accent-hover` | `#5145E5` |
| Accent subtle | `--stripe-accent-subtle` | `rgba(99,91,255,0.08)` |
| Success | `--stripe-success` | `#09825D` |
| Success bg | `--stripe-success-bg` | `#EBFAF4` |
| Warning | `--stripe-warning` | `#8D6A00` |
| Warning bg | `--stripe-warning-bg` | `#FFFAEB` |
| Error | `--stripe-error` | `#C0123C` |
| Error bg | `--stripe-error-bg` | `#FFF0F3` |
| Info | `--stripe-info` | `#0A5494` |
| Info bg | `--stripe-info-bg` | `#EFF8FF` |

### Typography
- **UI font:** `-apple-system`, BlinkMacSystemFont, Segoe UI, Roboto — via `--stripe-font-sans`
- **Mono font:** `SF Mono`, Fira Code — via `--stripe-font-mono`
- Body: 14px / 1.6 line-height, `--stripe-text-secondary`
- Headings: 18–24px, `--stripe-text-primary`, font-weight 600–700
- Labels: 13px, `--stripe-text-muted`, font-weight 500
- Table headers: 12px, uppercase, letter-spacing 0.04em, `--stripe-text-muted`

### Spacing Scale
`4 / 8 / 12 / 16 / 24 / 32 / 48px` — tokens `xs / sm / md / lg / xl / 2xl / 3xl`

### Border Radius
`4px (sm) / 6px (md) / 8px (lg)`

### Key Design Rules
1. **White is the surface colour.** `--stripe-bg-surface` is pure white.
2. **App background is `#F6F9FC`** — a barely-there blue-gray that makes white cards pop.
3. **Borders use real colour** (not opacity-based) for consistent rendering on all backgrounds.
4. **Shadows are used sparingly** — cards get `--stripe-shadow-sm`, modals get `--stripe-shadow-md`.
5. **Accent (purple) is for primary CTA only.** Never use it for decoration.
6. **Focus rings:** `--stripe-border-focus` border + `rgba(99,91,255,0.15)` box-shadow.
7. **Feedback colours** pair a text colour with a tinted background — always use both.
8. **Transitions:** 150ms ease-out on interactive elements.

---

## Design Tokens

### Backgrounds
```
--stripe-bg-app:      #F6F9FC
--stripe-bg-surface:  #FFFFFF
--stripe-bg-elevated: #FFFFFF
--stripe-bg-hover:    #F6F9FC
```

### Borders
```
--stripe-border:       #E3E8EE
--stripe-border-strong: #C1C9D2
--stripe-border-focus: #635BFF
```

### Text
```
--stripe-text-primary:   #1A1F36
--stripe-text-secondary: #3C4257
--stripe-text-muted:     #697386
```

### Accent
```
--stripe-accent:        #635BFF
--stripe-accent-hover:  #5145E5
--stripe-accent-subtle: rgba(99, 91, 255, 0.08)
```

### Feedback
```
--stripe-success:    #09825D    --stripe-success-bg: #EBFAF4
--stripe-warning:    #8D6A00    --stripe-warning-bg: #FFFAEB
--stripe-error:      #C0123C    --stripe-error-bg:   #FFF0F3
--stripe-info:       #0A5494    --stripe-info-bg:    #EFF8FF
```

### Typography
```
--stripe-font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif
--stripe-font-mono: 'SF Mono', 'Fira Code', monospace
```

### Spacing
```
--stripe-space-xs:  4px
--stripe-space-sm:  8px
--stripe-space-md:  12px
--stripe-space-lg:  16px
--stripe-space-xl:  24px
--stripe-space-2xl: 32px
--stripe-space-3xl: 48px
```

### Border Radius
```
--stripe-radius-sm: 4px
--stripe-radius-md: 6px
--stripe-radius-lg: 8px
```

### Shadows
```
--stripe-shadow-sm: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)
--stripe-shadow-md: 0 4px 6px rgba(0,0,0,0.07), 0 2px 4px rgba(0,0,0,0.06)
```

---

## Components

### Button

Primary (solid purple), secondary (white + border), and ghost variants. Includes loading state with spinner. Height 36px. Uses native font stack.

**Tokens used:** `--stripe-accent`, `--stripe-accent-hover`, `--stripe-bg-surface`, `--stripe-border`, `--stripe-text-primary`, `--stripe-text-muted`, `--stripe-radius-md`, `--stripe-shadow-sm`

```tsx
type ButtonVariant = 'primary' | 'secondary' | 'ghost';

interface ButtonProps {
  variant?: ButtonVariant;
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  children,
  onClick,
  disabled,
  loading,
}: ButtonProps) {
  const isDisabled = disabled || loading;

  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    height: '36px',
    padding: '0 16px',
    borderRadius: 'var(--stripe-radius-md)',
    fontSize: '14px',
    fontWeight: 600,
    fontFamily: 'var(--stripe-font-sans)',
    cursor: isDisabled ? 'not-allowed' : 'pointer',
    opacity: isDisabled ? 0.55 : 1,
    border: '1px solid transparent',
    transition: 'background 150ms ease-out, border-color 150ms ease-out, box-shadow 150ms ease-out',
    textDecoration: 'none',
  };

  const variants: Record<ButtonVariant, React.CSSProperties> = {
    primary: {
      background: 'var(--stripe-accent)',
      color: '#fff',
    },
    secondary: {
      background: 'var(--stripe-bg-surface)',
      color: 'var(--stripe-text-primary)',
      borderColor: 'var(--stripe-border-strong)',
      boxShadow: 'var(--stripe-shadow-sm)',
    },
    ghost: {
      background: 'transparent',
      color: 'var(--stripe-text-secondary)',
    },
  };

  return (
    <button
      style={{ ...base, ...variants[variant] }}
      onClick={onClick}
      disabled={isDisabled}
      onMouseEnter={e => {
        if (isDisabled) return;
        if (variant === 'primary') (e.currentTarget as HTMLButtonElement).style.background = 'var(--stripe-accent-hover)';
        if (variant === 'secondary') (e.currentTarget as HTMLButtonElement).style.background = 'var(--stripe-bg-hover)';
        if (variant === 'ghost') (e.currentTarget as HTMLButtonElement).style.background = 'var(--stripe-accent-subtle)';
      }}
      onMouseLeave={e => {
        if (variant === 'primary') (e.currentTarget as HTMLButtonElement).style.background = 'var(--stripe-accent)';
        if (variant === 'secondary') (e.currentTarget as HTMLButtonElement).style.background = 'var(--stripe-bg-surface)';
        if (variant === 'ghost') (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
      }}
    >
      {loading && (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ animation: 'spin 0.7s linear infinite' }}>
          <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.5" />
          <path d="M7 1.5A5.5 5.5 0 0 1 12.5 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )}
      {children}
    </button>
  );
}
```

---

### Input

Text input with optional label, helper text, and error state. Clean border at rest, purple focus ring. Height 36px.

**Tokens used:** `--stripe-bg-surface`, `--stripe-border`, `--stripe-border-strong`, `--stripe-border-focus`, `--stripe-text-primary`, `--stripe-text-muted`, `--stripe-error`, `--stripe-radius-md`

```tsx
interface InputProps {
  label?: string;
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  helperText?: string;
  error?: string;
  type?: string;
}

export function Input({
  label,
  placeholder,
  value,
  onChange,
  helperText,
  error,
  type = 'text',
}: InputProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
      {label && (
        <label style={{
          fontSize: '13px',
          fontWeight: 500,
          color: 'var(--stripe-text-secondary)',
          fontFamily: 'var(--stripe-font-sans)',
        }}>
          {label}
        </label>
      )}
      <input
        type={type}
        value={value}
        onChange={e => onChange?.(e.target.value)}
        placeholder={placeholder}
        style={{
          height: '36px',
          padding: '0 12px',
          background: 'var(--stripe-bg-surface)',
          border: `1px solid ${error ? 'var(--stripe-error)' : 'var(--stripe-border-strong)'}`,
          borderRadius: 'var(--stripe-radius-md)',
          color: 'var(--stripe-text-primary)',
          fontSize: '14px',
          fontFamily: 'var(--stripe-font-sans)',
          outline: 'none',
          width: '100%',
          boxSizing: 'border-box',
          transition: 'border-color 150ms ease-out, box-shadow 150ms ease-out',
        }}
        onFocus={e => {
          e.currentTarget.style.borderColor = error ? 'var(--stripe-error)' : 'var(--stripe-border-focus)';
          e.currentTarget.style.boxShadow = error
            ? '0 0 0 3px rgba(192, 18, 60, 0.15)'
            : '0 0 0 3px rgba(99, 91, 255, 0.15)';
        }}
        onBlur={e => {
          e.currentTarget.style.borderColor = error ? 'var(--stripe-error)' : 'var(--stripe-border-strong)';
          e.currentTarget.style.boxShadow = 'none';
        }}
      />
      {(helperText || error) && (
        <span style={{
          fontSize: '12px',
          color: error ? 'var(--stripe-error)' : 'var(--stripe-text-muted)',
          fontFamily: 'var(--stripe-font-sans)',
        }}>
          {error ?? helperText}
        </span>
      )}
    </div>
  );
}
```

---

### Card

White surface container with subtle shadow and border. Optional header slot with title and actions. Padding is generous.

**Tokens used:** `--stripe-bg-surface`, `--stripe-border`, `--stripe-shadow-sm`, `--stripe-shadow-md`, `--stripe-radius-lg`, `--stripe-text-primary`, `--stripe-text-muted`

```tsx
interface CardProps {
  title?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  elevated?: boolean;
}

export function Card({ title, actions, children, elevated }: CardProps) {
  return (
    <div
      style={{
        background: 'var(--stripe-bg-surface)',
        border: '1px solid var(--stripe-border)',
        borderRadius: 'var(--stripe-radius-lg)',
        boxShadow: elevated ? 'var(--stripe-shadow-md)' : 'var(--stripe-shadow-sm)',
        overflow: 'hidden',
      }}
    >
      {title && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 24px',
            borderBottom: '1px solid var(--stripe-border)',
          }}
        >
          <h3 style={{
            margin: 0,
            fontSize: '16px',
            fontWeight: 600,
            color: 'var(--stripe-text-primary)',
            fontFamily: 'var(--stripe-font-sans)',
          }}>
            {title}
          </h3>
          {actions && <div>{actions}</div>}
        </div>
      )}
      <div style={{ padding: '24px' }}>
        {children}
      </div>
    </div>
  );
}
```

---

### Table

Clean data table with styled header row and hover states on body rows. For financial/data-heavy UIs.

**Tokens used:** `--stripe-bg-surface`, `--stripe-bg-hover`, `--stripe-border`, `--stripe-text-primary`, `--stripe-text-muted`, `--stripe-font-sans`, `--stripe-font-mono`

```tsx
interface Column<T> {
  key: keyof T;
  header: string;
  align?: 'left' | 'right' | 'center';
  mono?: boolean;
}

interface TableProps<T extends Record<string, unknown>> {
  columns: Column<T>[];
  rows: T[];
}

export function Table<T extends Record<string, unknown>>({ columns, rows }: TableProps<T>) {
  const cellStyle = (align: string = 'left', mono = false): React.CSSProperties => ({
    padding: '12px 16px',
    textAlign: align as 'left' | 'right' | 'center',
    fontFamily: mono ? 'var(--stripe-font-mono)' : 'var(--stripe-font-sans)',
    fontSize: mono ? '13px' : '14px',
    color: 'var(--stripe-text-primary)',
    borderBottom: '1px solid var(--stripe-border)',
    whiteSpace: 'nowrap',
  });

  return (
    <div style={{ overflow: 'hidden', borderRadius: 'var(--stripe-radius-lg)', border: '1px solid var(--stripe-border)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--stripe-font-sans)' }}>
        <thead>
          <tr style={{ background: 'var(--stripe-bg-hover)' }}>
            {columns.map(col => (
              <th
                key={String(col.key)}
                style={{
                  padding: '10px 16px',
                  textAlign: col.align ?? 'left',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--stripe-text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  borderBottom: '1px solid var(--stripe-border)',
                }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              style={{ background: 'var(--stripe-bg-surface)', transition: 'background 100ms ease-out' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--stripe-bg-hover)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'var(--stripe-bg-surface)')}
            >
              {columns.map(col => (
                <td key={String(col.key)} style={cellStyle(col.align, col.mono)}>
                  {String(row[col.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

---

### Alert

Contextual feedback strip with four semantic variants (info/success/warning/error). Always shows an icon and message. Can include an optional action link.

**Tokens used:** `--stripe-info`, `--stripe-info-bg`, `--stripe-success`, `--stripe-success-bg`, `--stripe-warning`, `--stripe-warning-bg`, `--stripe-error`, `--stripe-error-bg`, `--stripe-radius-md`

```tsx
type AlertVariant = 'info' | 'success' | 'warning' | 'error';

interface AlertProps {
  variant?: AlertVariant;
  title?: string;
  children: React.ReactNode;
  action?: { label: string; onClick: () => void };
}

const alertConfig: Record<AlertVariant, { bg: string; color: string; icon: string }> = {
  info:    { bg: 'var(--stripe-info-bg)',    color: 'var(--stripe-info)',    icon: 'ℹ' },
  success: { bg: 'var(--stripe-success-bg)', color: 'var(--stripe-success)', icon: '✓' },
  warning: { bg: 'var(--stripe-warning-bg)', color: 'var(--stripe-warning)', icon: '⚠' },
  error:   { bg: 'var(--stripe-error-bg)',   color: 'var(--stripe-error)',   icon: '✕' },
};

export function Alert({ variant = 'info', title, children, action }: AlertProps) {
  const config = alertConfig[variant];

  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        gap: '12px',
        padding: '12px 16px',
        background: config.bg,
        borderRadius: 'var(--stripe-radius-md)',
        border: `1px solid ${config.color}22`,
      }}
    >
      <span style={{
        color: config.color,
        fontSize: '16px',
        fontWeight: 700,
        lineHeight: '20px',
        flexShrink: 0,
      }}>
        {config.icon}
      </span>
      <div style={{ flex: 1 }}>
        {title && (
          <div style={{
            fontSize: '14px',
            fontWeight: 600,
            color: config.color,
            fontFamily: 'var(--stripe-font-sans)',
            marginBottom: '2px',
          }}>
            {title}
          </div>
        )}
        <div style={{
          fontSize: '13px',
          color: config.color,
          fontFamily: 'var(--stripe-font-sans)',
          opacity: 0.85,
        }}>
          {children}
        </div>
        {action && (
          <button
            onClick={action.onClick}
            style={{
              marginTop: '6px',
              fontSize: '13px',
              fontWeight: 600,
              color: config.color,
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              textDecoration: 'underline',
              fontFamily: 'var(--stripe-font-sans)',
            }}
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
```

---

<!-- Generated by Layout — layout.design -->
