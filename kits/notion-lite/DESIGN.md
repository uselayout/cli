# Notion — Design System

> Content-first. The UI disappears so the writing can breathe.

---

## Quick Reference

**Aesthetic:** Warm off-whites, organic warm-gray text, and almost-invisible borders. The interface is subordinate to content — controls only appear when needed. Typography is the primary design element: comfortable line-height, generous max-width, and subtle serif option for long-form content.

### Colour Palette
| Role | Token | Value |
|---|---|---|
| App background | `--notion-bg-app` | `#FFFFFF` |
| Surface (sidebars, panels) | `--notion-bg-surface` | `#F7F6F3` |
| Hover state | `--notion-bg-hover` | `#EEEEE9` |
| Selected state | `--notion-bg-selected` | `#E8E7E3` |
| Border (default) | `--notion-border` | `rgba(55,53,47,0.09)` |
| Border (strong) | `--notion-border-strong` | `rgba(55,53,47,0.18)` |
| Primary text | `--notion-text-primary` | `#37352F` |
| Secondary text | `--notion-text-secondary` | `#787774` |
| Muted text | `--notion-text-muted` | `#9B9A97` |
| Placeholder | `--notion-text-placeholder` | `rgba(55,53,47,0.4)` |
| Accent | `--notion-accent` | `#2383E2` |
| Accent hover | `--notion-accent-hover` | `#1E78D3` |
| Accent subtle | `--notion-accent-subtle` | `rgba(35,131,226,0.1)` |
| Callout: blue | `--notion-callout-blue` | `rgba(35,131,226,0.1)` |
| Callout: yellow | `--notion-callout-yellow` | `rgba(255,184,0,0.14)` |
| Callout: green | `--notion-callout-green` | `rgba(15,123,108,0.1)` |
| Callout: red | `--notion-callout-red` | `rgba(235,87,87,0.1)` |
| Callout: gray | `--notion-callout-gray` | `rgba(55,53,47,0.06)` |

### Typography
- **UI font:** `ui-sans-serif`, -apple-system, BlinkMacSystemFont, Segoe UI — via `--notion-font-sans`
- **Content font (optional):** `Georgia`, Times New Roman — via `--notion-font-serif`
- **Code font:** `SFMono-Regular`, Menlo, Consolas — via `--notion-font-mono`
- Body text: 16px / 1.7 line-height — generous for reading
- UI labels: 14px, `--notion-text-secondary`
- Small labels: 12px, `--notion-text-muted`
- Max content width: 720px (full width: none, centred)

### Spacing Scale
`2 / 4 / 8 / 16 / 24 / 32px` — tokens `2xs / xs / sm / md / lg / xl`

### Border Radius
`3px (sm) / 4px (md) / 6px (lg)` — intentionally small, organic

### Key Design Rules
1. **The background is white.** `--notion-bg-app` = `#FFFFFF`. No dark backgrounds.
2. **Warm grays, not cool.** All neutrals have a warm brownish undertone (`#37352F`).
3. **Borders are opacity-based** on `#37352F` — they adapt to any background tint.
4. **Hover is a background change** only — no border or shadow change.
5. **No box-shadow on interactive elements.** Only use shadow (if at all) on floating elements like menus.
6. **Accent (blue) is for links and active states only.** Never fill a button with it except for a true CTA.
7. **Icons appear on hover** — ghost by default, visible when the user approaches.
8. **Transitions:** 100ms ease-out. Fast enough to feel instant.
9. **Callout colours** are always paired: a tinted background from `--notion-callout-*` with the appropriately-toned text.

---

## Design Tokens

### Backgrounds
```
--notion-bg-app:      #FFFFFF
--notion-bg-surface:  #F7F6F3
--notion-bg-hover:    #EEEEE9
--notion-bg-selected: #E8E7E3
```

### Borders
```
--notion-border:       rgba(55, 53, 47, 0.09)
--notion-border-strong: rgba(55, 53, 47, 0.18)
```

### Text
```
--notion-text-primary:     #37352F
--notion-text-secondary:   #787774
--notion-text-muted:       #9B9A97
--notion-text-placeholder: rgba(55, 53, 47, 0.4)
```

### Accent
```
--notion-accent:        #2383E2
--notion-accent-hover:  #1E78D3
--notion-accent-subtle: rgba(35, 131, 226, 0.1)
```

### Callout Backgrounds
```
--notion-callout-blue:   rgba(35, 131, 226, 0.1)
--notion-callout-yellow: rgba(255, 184, 0, 0.14)
--notion-callout-green:  rgba(15, 123, 108, 0.1)
--notion-callout-red:    rgba(235, 87, 87, 0.1)
--notion-callout-gray:   rgba(55, 53, 47, 0.06)
```

### Typography
```
--notion-font-sans:  ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif
--notion-font-serif: Georgia, 'Times New Roman', serif
--notion-font-mono:  'SFMono-Regular', Menlo, Consolas, monospace
```

### Spacing
```
--notion-space-2xs: 2px
--notion-space-xs:  4px
--notion-space-sm:  8px
--notion-space-md:  16px
--notion-space-lg:  24px
--notion-space-xl:  32px
```

### Border Radius
```
--notion-radius-sm: 3px
--notion-radius-md: 4px
--notion-radius-lg: 6px
```

---

## Components

### Button

Minimal ghost-style buttons by default. The "primary" variant is used sparingly — only for true CTAs like "Create" or "Save". Text buttons are the standard. Height 28px, tight padding, barely-there hover.

**Tokens used:** `--notion-bg-hover`, `--notion-bg-selected`, `--notion-text-primary`, `--notion-text-secondary`, `--notion-accent`, `--notion-accent-subtle`, `--notion-radius-sm`

```tsx
type ButtonVariant = 'primary' | 'ghost' | 'text';

interface ButtonProps {
  variant?: ButtonVariant;
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
}

export function Button({
  variant = 'ghost',
  children,
  onClick,
  disabled,
  size = 'md',
}: ButtonProps) {
  const height = size === 'sm' ? '24px' : '28px';
  const fontSize = size === 'sm' ? '12px' : '14px';
  const padding = size === 'sm' ? '0 8px' : '0 10px';

  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    height,
    padding,
    borderRadius: 'var(--notion-radius-sm)',
    fontSize,
    fontWeight: 500,
    fontFamily: 'var(--notion-font-sans)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    border: 'none',
    transition: 'background 100ms ease-out',
  };

  const variants: Record<ButtonVariant, React.CSSProperties> = {
    primary: {
      background: 'var(--notion-text-primary)',
      color: '#FFFFFF',
    },
    ghost: {
      background: 'transparent',
      color: 'var(--notion-text-secondary)',
    },
    text: {
      background: 'transparent',
      color: 'var(--notion-accent)',
    },
  };

  const hoverBg: Record<ButtonVariant, string> = {
    primary: 'rgba(55,53,47,0.85)',
    ghost: 'var(--notion-bg-hover)',
    text: 'var(--notion-accent-subtle)',
  };

  return (
    <button
      style={{ ...base, ...variants[variant] }}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={e => {
        if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = hoverBg[variant];
      }}
      onMouseLeave={e => {
        const defaultBg = variant === 'primary' ? 'var(--notion-text-primary)' : 'transparent';
        (e.currentTarget as HTMLButtonElement).style.background = defaultBg;
      }}
    >
      {children}
    </button>
  );
}
```

---

### TextBlock

Editable content block — the core primitive of any Notion-style editor. Renders a `contentEditable` div with Notion's characteristic placeholder behaviour. Uses serif or sans font depending on the content type.

**Tokens used:** `--notion-font-sans`, `--notion-font-serif`, `--notion-text-primary`, `--notion-text-placeholder`, `--notion-bg-hover`, `--notion-radius-sm`

```tsx
type BlockType = 'paragraph' | 'heading1' | 'heading2' | 'heading3';

interface TextBlockProps {
  type?: BlockType;
  placeholder?: string;
  defaultValue?: string;
  serif?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
}

const blockStyles: Record<BlockType, React.CSSProperties> = {
  paragraph:  { fontSize: '16px', fontWeight: 400, lineHeight: '1.7' },
  heading1:   { fontSize: '30px', fontWeight: 700, lineHeight: '1.3' },
  heading2:   { fontSize: '24px', fontWeight: 700, lineHeight: '1.35' },
  heading3:   { fontSize: '20px', fontWeight: 600, lineHeight: '1.4' },
};

export function TextBlock({
  type = 'paragraph',
  placeholder = 'Type something…',
  defaultValue,
  serif,
  onFocus,
  onBlur,
}: TextBlockProps) {
  return (
    <div
      contentEditable
      suppressContentEditableWarning
      data-placeholder={placeholder}
      onFocus={onFocus}
      onBlur={onBlur}
      style={{
        outline: 'none',
        width: '100%',
        color: 'var(--notion-text-primary)',
        fontFamily: serif ? 'var(--notion-font-serif)' : 'var(--notion-font-sans)',
        ...blockStyles[type],
      }}
    >
      {defaultValue}
    </div>
  );
}

/* Required CSS for placeholder behaviour:
[contenteditable]:empty::before {
  content: attr(data-placeholder);
  color: var(--notion-text-placeholder);
  pointer-events: none;
}
*/
```

---

### Toggle

Expandable toggle block with animated arrow. The summary row has a hover state; the content indents beneath it. A fundamental Notion layout primitive.

**Tokens used:** `--notion-bg-hover`, `--notion-text-primary`, `--notion-text-secondary`, `--notion-font-sans`, `--notion-radius-sm`, `--notion-space-md`

```tsx
import { useState } from 'react';

interface ToggleProps {
  summary: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export function Toggle({ summary, children, defaultOpen = false }: ToggleProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '4px',
          padding: '2px 4px',
          borderRadius: 'var(--notion-radius-sm)',
          cursor: 'pointer',
          userSelect: 'none',
          transition: 'background 100ms ease-out',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--notion-bg-hover)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '22px',
            height: '22px',
            flexShrink: 0,
            color: 'var(--notion-text-muted)',
            transition: 'transform 100ms ease-out',
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            fontSize: '12px',
            marginTop: '2px',
          }}
        >
          ▶
        </span>
        <div style={{
          flex: 1,
          fontSize: '16px',
          lineHeight: '1.7',
          color: 'var(--notion-text-primary)',
          fontFamily: 'var(--notion-font-sans)',
          fontWeight: 500,
        }}>
          {summary}
        </div>
      </div>

      {open && (
        <div style={{ paddingLeft: '26px', marginTop: '2px' }}>
          {children}
        </div>
      )}
    </div>
  );
}
```

---

### Callout

Highlighted block with emoji icon. Five colour variants. Used for tips, warnings, and important notes in documents. The emoji serves as the visual anchor — always provide one.

**Tokens used:** `--notion-callout-blue/yellow/green/red/gray`, `--notion-text-primary`, `--notion-radius-md`, `--notion-space-md`

```tsx
type CalloutColour = 'blue' | 'yellow' | 'green' | 'red' | 'gray';

interface CalloutProps {
  colour?: CalloutColour;
  emoji?: string;
  children: React.ReactNode;
}

const calloutBg: Record<CalloutColour, string> = {
  blue:   'var(--notion-callout-blue)',
  yellow: 'var(--notion-callout-yellow)',
  green:  'var(--notion-callout-green)',
  red:    'var(--notion-callout-red)',
  gray:   'var(--notion-callout-gray)',
};

const calloutEmoji: Record<CalloutColour, string> = {
  blue:   '💡',
  yellow: '⚠️',
  green:  '✅',
  red:    '🚨',
  gray:   '📝',
};

export function Callout({ colour = 'gray', emoji, children }: CalloutProps) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--notion-space-sm)',
        padding: 'var(--notion-space-md)',
        background: calloutBg[colour],
        borderRadius: 'var(--notion-radius-md)',
      }}
    >
      <span
        style={{
          fontSize: '18px',
          lineHeight: '1.7',
          flexShrink: 0,
        }}
        role="img"
        aria-hidden="true"
      >
        {emoji ?? calloutEmoji[colour]}
      </span>
      <div
        style={{
          flex: 1,
          fontSize: '16px',
          lineHeight: '1.7',
          color: 'var(--notion-text-primary)',
          fontFamily: 'var(--notion-font-sans)',
        }}
      >
        {children}
      </div>
    </div>
  );
}
```

---

### Breadcrumb

Page-path breadcrumb with separator chevrons. Items are clickable links styled as muted text; the last item (current page) is non-interactive and shows in primary text.

**Tokens used:** `--notion-text-primary`, `--notion-text-muted`, `--notion-accent`, `--notion-font-sans`, `--notion-bg-hover`, `--notion-radius-sm`

```tsx
interface BreadcrumbItem {
  label: string;
  href?: string;
  onClick?: () => void;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

export function Breadcrumb({ items }: BreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb">
      <ol
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '2px',
          listStyle: 'none',
          margin: 0,
          padding: 0,
          flexWrap: 'wrap',
        }}
      >
        {items.map((item, index) => {
          const isLast = index === items.length - 1;

          return (
            <li key={index} style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
              {isLast ? (
                <span
                  style={{
                    fontSize: '14px',
                    fontWeight: 500,
                    color: 'var(--notion-text-primary)',
                    fontFamily: 'var(--notion-font-sans)',
                    padding: '2px 6px',
                    borderRadius: 'var(--notion-radius-sm)',
                  }}
                  aria-current="page"
                >
                  {item.label}
                </span>
              ) : (
                <button
                  onClick={item.onClick}
                  style={{
                    fontSize: '14px',
                    fontWeight: 400,
                    color: 'var(--notion-text-secondary)',
                    fontFamily: 'var(--notion-font-sans)',
                    background: 'transparent',
                    border: 'none',
                    padding: '2px 6px',
                    borderRadius: 'var(--notion-radius-sm)',
                    cursor: item.onClick ? 'pointer' : 'default',
                    transition: 'background 100ms ease-out, color 100ms ease-out',
                  }}
                  onMouseEnter={e => {
                    if (!item.onClick) return;
                    (e.currentTarget as HTMLButtonElement).style.background = 'var(--notion-bg-hover)';
                    (e.currentTarget as HTMLButtonElement).style.color = 'var(--notion-text-primary)';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                    (e.currentTarget as HTMLButtonElement).style.color = 'var(--notion-text-secondary)';
                  }}
                >
                  {item.label}
                </button>
              )}
              {!isLast && (
                <span
                  aria-hidden="true"
                  style={{
                    color: 'var(--notion-text-muted)',
                    fontSize: '12px',
                    lineHeight: 1,
                    userSelect: 'none',
                  }}
                >
                  /
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
```

---

<!-- Generated by SuperDuper AI Studio — superduperui.com -->
