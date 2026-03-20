# Linear — Design System

> Dark, minimal, developer-focused. Every element earns its place.

---

## Quick Reference

**Aesthetic:** Dense information display, near-black backgrounds, indigo accent, tight spacing. Feels fast and precise — no decorative flourishes.

### Colour Palette
| Role | Token | Value |
|---|---|---|
| App background | `--linear-bg-app` | `#0A0A0F` |
| Surface (panels, sidebars) | `--linear-bg-surface` | `#12121A` |
| Elevated (modals, dropdowns) | `--linear-bg-elevated` | `#1A1A25` |
| Hover state | `--linear-bg-hover` | `#22222F` |
| Border (default) | `--linear-border` | `rgba(255,255,255,0.08)` |
| Border (strong) | `--linear-border-strong` | `rgba(255,255,255,0.15)` |
| Border (focus) | `--linear-border-focus` | `#5E6AD2` |
| Primary text | `--linear-text-primary` | `#E8E8ED` |
| Secondary text | `--linear-text-secondary` | `rgba(232,232,237,0.65)` |
| Muted text | `--linear-text-muted` | `rgba(232,232,237,0.4)` |
| Accent | `--linear-accent` | `#5E6AD2` |
| Accent hover | `--linear-accent-hover` | `#6E7AE2` |
| Accent subtle bg | `--linear-accent-subtle` | `rgba(94,106,210,0.15)` |
| Status: active | `--linear-status-active` | `#F2C94C` |
| Status: done | `--linear-status-done` | `#4CB782` |
| Status: backlog | `--linear-status-backlog` | `#8B8B99` |

### Typography
- **UI font:** `Inter`, -apple-system, sans-serif — via `--linear-font-sans`
- **Code/mono font:** `JetBrains Mono`, monospace — via `--linear-font-mono`
- Body: 14px / 1.5 line-height
- Labels: 12px, `--linear-text-secondary`, letter-spacing 0.01em
- Headings: 15–18px, `--linear-text-primary`, font-weight 500–600

### Spacing Scale
`4 / 8 / 12 / 16 / 24px` — tokens `xs / sm / md / lg / xl`

### Border Radius
`4px (sm) / 6px (md) / 8px (lg)`

### Key Design Rules
1. **No white backgrounds.** Even modals use `--linear-bg-elevated`.
2. **Borders are barely visible** — `rgba(255,255,255,0.08)` by default. Strengthen on hover/focus.
3. **Accent sparingly.** Indigo only for primary actions and active states.
4. **Status colours** carry meaning — yellow = in progress, green = done, grey = backlog.
5. **No border-radius above 8px.** This is a tool, not a consumer app.
6. **Transitions:** 120ms ease-out on interactive elements only.
7. **Icons:** 16px, `--linear-text-secondary`, nudge to `--linear-text-primary` on hover.

---

## Design Tokens

### Backgrounds
```
--linear-bg-app:      #0A0A0F    /* root, page background */
--linear-bg-surface:  #12121A    /* sidebar, panels */
--linear-bg-elevated: #1A1A25    /* modals, dropdowns */
--linear-bg-hover:    #22222F    /* row/item hover */
```

### Borders
```
--linear-border:       rgba(255,255,255,0.08)  /* default dividers */
--linear-border-strong: rgba(255,255,255,0.15) /* card edges, inputs */
--linear-border-focus: #5E6AD2                 /* focused inputs */
```

### Text
```
--linear-text-primary:   #E8E8ED
--linear-text-secondary: rgba(232,232,237,0.65)
--linear-text-muted:     rgba(232,232,237,0.4)
```

### Accent
```
--linear-accent:        #5E6AD2
--linear-accent-hover:  #6E7AE2
--linear-accent-subtle: rgba(94,106,210,0.15)
```

### Status
```
--linear-status-active:  #F2C94C
--linear-status-done:    #4CB782
--linear-status-backlog: #8B8B99
```

### Typography
```
--linear-font-sans: 'Inter', -apple-system, sans-serif
--linear-font-mono: 'JetBrains Mono', monospace
```

### Spacing
```
--linear-space-xs: 4px
--linear-space-sm: 8px
--linear-space-md: 12px
--linear-space-lg: 16px
--linear-space-xl: 24px
```

### Border Radius
```
--linear-radius-sm: 4px
--linear-radius-md: 6px
--linear-radius-lg: 8px
```

---

## Components

### Button

Three variants: primary (solid accent fill), secondary (surface bg + border), ghost (no bg until hover). Height 32px. Font size 14px, weight 500.

**Tokens used:** `--linear-accent`, `--linear-accent-hover`, `--linear-bg-surface`, `--linear-bg-hover`, `--linear-border`, `--linear-text-primary`, `--linear-radius-md`

```tsx
type ButtonVariant = 'primary' | 'secondary' | 'ghost';

interface ButtonProps {
  variant?: ButtonVariant;
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}

export function Button({ variant = 'primary', children, onClick, disabled }: ButtonProps) {
  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    height: '32px',
    padding: '0 12px',
    borderRadius: 'var(--linear-radius-md)',
    fontSize: '14px',
    fontWeight: 500,
    fontFamily: 'var(--linear-font-sans)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1,
    border: '1px solid transparent',
    transition: 'background 120ms ease-out, border-color 120ms ease-out',
  };

  const variants: Record<ButtonVariant, React.CSSProperties> = {
    primary: {
      background: 'var(--linear-accent)',
      color: '#fff',
    },
    secondary: {
      background: 'var(--linear-bg-surface)',
      color: 'var(--linear-text-primary)',
      borderColor: 'var(--linear-border-strong)',
    },
    ghost: {
      background: 'transparent',
      color: 'var(--linear-text-secondary)',
    },
  };

  return (
    <button
      style={{ ...base, ...variants[variant] }}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={e => {
        if (variant === 'primary') (e.currentTarget as HTMLButtonElement).style.background = 'var(--linear-accent-hover)';
        if (variant === 'ghost') (e.currentTarget as HTMLButtonElement).style.background = 'var(--linear-bg-hover)';
      }}
      onMouseLeave={e => {
        if (variant === 'primary') (e.currentTarget as HTMLButtonElement).style.background = 'var(--linear-accent)';
        if (variant === 'ghost') (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
      }}
    >
      {children}
    </button>
  );
}
```

---

### Input

Single-line text input. Dark surface background, `--linear-border-strong` border at rest, `--linear-border-focus` on focus with a subtle glow. Height 32px, 14px font.

**Tokens used:** `--linear-bg-surface`, `--linear-border-strong`, `--linear-border-focus`, `--linear-text-primary`, `--linear-text-muted`, `--linear-radius-md`

```tsx
interface InputProps {
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  label?: string;
}

export function Input({ placeholder, value, onChange, label }: InputProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {label && (
        <label style={{
          fontSize: '12px',
          color: 'var(--linear-text-secondary)',
          fontFamily: 'var(--linear-font-sans)',
          letterSpacing: '0.01em',
        }}>
          {label}
        </label>
      )}
      <input
        value={value}
        onChange={e => onChange?.(e.target.value)}
        placeholder={placeholder}
        style={{
          height: '32px',
          padding: '0 var(--linear-space-md)',
          background: 'var(--linear-bg-surface)',
          border: '1px solid var(--linear-border-strong)',
          borderRadius: 'var(--linear-radius-md)',
          color: 'var(--linear-text-primary)',
          fontSize: '14px',
          fontFamily: 'var(--linear-font-sans)',
          outline: 'none',
          transition: 'border-color 120ms ease-out, box-shadow 120ms ease-out',
        }}
        onFocus={e => {
          e.currentTarget.style.borderColor = 'var(--linear-border-focus)';
          e.currentTarget.style.boxShadow = '0 0 0 2px rgba(94, 106, 210, 0.2)';
        }}
        onBlur={e => {
          e.currentTarget.style.borderColor = 'var(--linear-border-strong)';
          e.currentTarget.style.boxShadow = 'none';
        }}
      />
    </div>
  );
}
```

---

### Card

Container component. `--linear-bg-surface` background, `--linear-border` edge, `--linear-radius-lg` corners. On hover the border strengthens. No shadow — elevation is implied by background difference.

**Tokens used:** `--linear-bg-surface`, `--linear-bg-hover`, `--linear-border`, `--linear-border-strong`, `--linear-radius-lg`, `--linear-space-lg`, `--linear-space-xl`

```tsx
interface CardProps {
  children: React.ReactNode;
  onClick?: () => void;
  padding?: 'sm' | 'md' | 'lg';
}

export function Card({ children, onClick, padding = 'md' }: CardProps) {
  const paddingMap = {
    sm: 'var(--linear-space-md)',
    md: 'var(--linear-space-lg)',
    lg: 'var(--linear-space-xl)',
  };

  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--linear-bg-surface)',
        border: '1px solid var(--linear-border)',
        borderRadius: 'var(--linear-radius-lg)',
        padding: paddingMap[padding],
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color 120ms ease-out, background 120ms ease-out',
      }}
      onMouseEnter={e => {
        if (!onClick) return;
        (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--linear-border-strong)';
        (e.currentTarget as HTMLDivElement).style.background = 'var(--linear-bg-elevated)';
      }}
      onMouseLeave={e => {
        if (!onClick) return;
        (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--linear-border)';
        (e.currentTarget as HTMLDivElement).style.background = 'var(--linear-bg-surface)';
      }}
    >
      {children}
    </div>
  );
}
```

---

### Badge

Inline status label. Three semantic variants map to Linear's status colour system. Small, 12px text, tight padding. No shadow.

**Tokens used:** `--linear-status-active`, `--linear-status-done`, `--linear-status-backlog`, `--linear-accent`, `--linear-accent-subtle`, `--linear-radius-sm`

```tsx
type BadgeVariant = 'active' | 'done' | 'backlog' | 'accent';

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
}

const badgeStyles: Record<BadgeVariant, React.CSSProperties> = {
  active: {
    background: 'rgba(242, 201, 76, 0.15)',
    color: 'var(--linear-status-active)',
  },
  done: {
    background: 'rgba(76, 183, 130, 0.15)',
    color: 'var(--linear-status-done)',
  },
  backlog: {
    background: 'rgba(139, 139, 153, 0.15)',
    color: 'var(--linear-status-backlog)',
  },
  accent: {
    background: 'var(--linear-accent-subtle)',
    color: 'var(--linear-accent)',
  },
};

export function Badge({ variant = 'backlog', children }: BadgeProps) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '2px 8px',
        borderRadius: 'var(--linear-radius-sm)',
        fontSize: '12px',
        fontWeight: 500,
        fontFamily: 'var(--linear-font-sans)',
        lineHeight: '18px',
        ...badgeStyles[variant],
      }}
    >
      {children}
    </span>
  );
}
```

---

### Avatar

User avatar with image fallback to initials. Two sizes: sm (24px) and md (32px). Circular. Background uses `--linear-accent-subtle` for initials fallback.

**Tokens used:** `--linear-accent-subtle`, `--linear-accent`, `--linear-text-primary`, `--linear-border`

```tsx
interface AvatarProps {
  src?: string;
  name: string;
  size?: 'sm' | 'md';
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(n => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function Avatar({ src, name, size = 'md' }: AvatarProps) {
  const dimension = size === 'sm' ? 24 : 32;
  const fontSize = size === 'sm' ? 10 : 13;

  const base: React.CSSProperties = {
    width: dimension,
    height: dimension,
    borderRadius: '50%',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize,
    fontWeight: 600,
    fontFamily: 'var(--linear-font-sans)',
    flexShrink: 0,
    overflow: 'hidden',
    border: '1px solid var(--linear-border)',
  };

  if (src) {
    return (
      <div style={base}>
        <img src={src} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    );
  }

  return (
    <div
      style={{
        ...base,
        background: 'var(--linear-accent-subtle)',
        color: 'var(--linear-accent)',
      }}
    >
      {getInitials(name)}
    </div>
  );
}
```

---

<!-- Generated by Layout — layout.design -->
