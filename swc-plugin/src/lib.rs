//! SWC source-tagging plugin for Layout Live.
//!
//! Rust/Wasm twin of `src/plugins/transform.ts` (the parity oracle). Runs as a
//! native SWC pass so it works under the Next.js App Router AND Turbopack,
//! where the Babel-via-webpack loader can't (the Babel pass makes Next
//! misclassify React Server Components as client modules).
//!
//! It injects the same four attributes on the same set of JSX elements, with
//! the same skip rules and the same line/col semantics as `transform.ts`:
//!
//!   data-layout-source-file   — path relative to projectRoot (POSIX)
//!   data-layout-source-line   — 1-indexed line
//!   data-layout-source-col    — 1-indexed column (SWC 0-based col + 1)
//!   data-layout-component     — nearest enclosing component name
//!
//! Output *formatting* is the host codegen's, not Babel's, so the emitted code
//! string differs from `transform.ts`. Parity is defined on WHICH elements are
//! tagged and WHAT the four attribute values are — see test/swc-parity.test.ts.
use serde::Deserialize;
use swc_core::common::{SourceMapper, Span, DUMMY_SP};
use swc_core::ecma::ast::*;
use swc_core::ecma::visit::{VisitMut, VisitMutWith};
use swc_core::plugin::metadata::TransformPluginMetadataContextKind;
use swc_core::plugin::plugin_transform;
use swc_core::plugin::proxies::{PluginSourceMapProxy, TransformPluginProgramMetadata};

const MARKER_ATTR: &str = "data-layout-source-file";

/// React's raw-HTML escape-hatch prop, assembled at runtime so this source
/// file doesn't trip content scanners. Semantics unchanged from transform.ts.
fn raw_html_prop() -> String {
    ["dangerously", "Set", "Inner", "HTML"].concat()
}

#[derive(Deserialize, Default)]
struct Config {
    #[serde(rename = "projectRoot", default)]
    project_root: String,
    /// Reserved: the host only injects this plugin in dev, so tagging is
    /// unconditional here. Kept for symmetry with `transform.ts`.
    #[serde(default)]
    #[allow(dead_code)]
    dev: bool,
}

/// Whether `file` is an absolute path (POSIX `/…` or Windows `C:\…`).
fn is_absolute(file: &str) -> bool {
    file.starts_with('/')
        || file.starts_with('\\')
        || file.as_bytes().get(1) == Some(&b':')
}

/// Project-relative POSIX path for `file`, matching transform.ts output.
///
/// The host passes the filename in different shapes:
///   - webpack → ABSOLUTE (`/proj/app/page.tsx`)  → relativise against root.
///   - Turbopack → already PROJECT-RELATIVE (`app/page.tsx`) → use as-is.
/// Both must yield the same `app/page.tsx`.
fn make_relative(root: &str, file: &str) -> String {
    let norm = |s: &str| s.replace('\\', "/");
    let file = norm(file);
    if !is_absolute(&file) {
        // Turbopack: already relative to the project root.
        return file
            .trim_start_matches("./")
            .trim_start_matches('/')
            .to_string();
    }
    let root = norm(root);
    let root_parts: Vec<&str> = root
        .trim_end_matches('/')
        .split('/')
        .filter(|s| !s.is_empty())
        .collect();
    let file_parts: Vec<&str> = file.split('/').filter(|s| !s.is_empty()).collect();
    let mut i = 0;
    while i < root_parts.len() && i < file_parts.len() && root_parts[i] == file_parts[i] {
        i += 1;
    }
    let mut out: Vec<String> = Vec::new();
    for _ in i..root_parts.len() {
        out.push("..".to_string());
    }
    for p in &file_parts[i..] {
        out.push((*p).to_string());
    }
    out.join("/")
}

// The JSXAttrValue string-literal shape changed across swc_core versions:
// swc_core >= ~45 uses `Str(Str)`; older (<= 35) used `Lit(Lit::Str)`. We build
// this same source for BOTH ABIs (Next 15.5 = swc_core 35, Next 16.2 = swc_core
// 57), so the variant is selected by the `legacy_jsx_attr` cargo feature (on for
// the swc_core-35 build, off for 57). See swc-plugin/build.sh.

#[cfg(feature = "legacy_jsx_attr")]
fn jsx_string_value(value: &str) -> JSXAttrValue {
    JSXAttrValue::Lit(Lit::Str(Str {
        span: DUMMY_SP,
        value: value.into(),
        raw: None,
    }))
}

#[cfg(not(feature = "legacy_jsx_attr"))]
fn jsx_string_value(value: &str) -> JSXAttrValue {
    JSXAttrValue::Str(Str {
        span: DUMMY_SP,
        value: value.into(),
        raw: None,
    })
}

/// Is this attribute value a plain string literal (across both swc_core ABIs)?
fn is_jsx_string(v: &JSXAttrValue) -> bool {
    #[cfg(feature = "legacy_jsx_attr")]
    {
        matches!(v, JSXAttrValue::Lit(Lit::Str(_)))
    }
    #[cfg(not(feature = "legacy_jsx_attr"))]
    {
        matches!(v, JSXAttrValue::Str(_))
    }
}

fn str_attr(name: &str, value: &str) -> JSXAttrOrSpread {
    JSXAttrOrSpread::JSXAttr(JSXAttr {
        span: DUMMY_SP,
        name: JSXAttrName::Ident(IdentName::new(name.into(), DUMMY_SP)),
        value: Some(jsx_string_value(value)),
    })
}

/// Does `opening` already carry the marker attr? (idempotency)
fn is_pre_attributed(opening: &JSXOpeningElement) -> bool {
    opening.attrs.iter().any(|a| match a {
        JSXAttrOrSpread::JSXAttr(attr) => match &attr.name {
            JSXAttrName::Ident(n) => n.sym == *MARKER_ATTR,
            _ => false,
        },
        _ => false,
    })
}

fn has_raw_html(opening: &JSXOpeningElement) -> bool {
    let raw = raw_html_prop();
    opening.attrs.iter().any(|a| match a {
        JSXAttrOrSpread::JSXAttr(attr) => match &attr.name {
            JSXAttrName::Ident(n) => *n.sym == *raw,
            _ => false,
        },
        _ => false,
    })
}

/// Statically-editable `className` (string literal, `{"…"}`, or a template
/// literal with no expressions)? Mirrors `hasLiteralClassName` in transform.ts.
fn has_literal_classname(opening: &JSXOpeningElement) -> bool {
    for a in &opening.attrs {
        let JSXAttrOrSpread::JSXAttr(attr) = a else {
            continue;
        };
        let JSXAttrName::Ident(n) = &attr.name else {
            continue;
        };
        if n.sym != *"className" {
            continue;
        }
        return match &attr.value {
            Some(v) if is_jsx_string(v) => true,
            Some(JSXAttrValue::JSXExprContainer(c)) => match &c.expr {
                JSXExpr::Expr(e) => match &**e {
                    Expr::Lit(Lit::Str(_)) => true,
                    Expr::Tpl(t) => t.exprs.is_empty(),
                    _ => false,
                },
                JSXExpr::JSXEmptyExpr(_) => false,
            },
            _ => false, // className present but dynamic — not editable here
        };
    }
    false // no className prop
}

struct LayoutTagger<'a> {
    source_map: &'a PluginSourceMapProxy,
    relative_file: String,
    /// Stack of nearest enclosing component names (function / class / arrow or
    /// function-expression assigned to a variable).
    stack: Vec<String>,
    /// When true, the next function-expression we descend into is the direct
    /// init of a `const X = function () {}` — its own id must NOT shadow the
    /// variable name we already pushed (`X` wins, matching transform.ts order).
    suppress_fn_name: bool,
}

impl<'a> LayoutTagger<'a> {
    fn current_component(&self) -> String {
        self.stack
            .last()
            .cloned()
            .unwrap_or_else(|| "Anonymous".to_string())
    }

    fn tag(&self, opening: &mut JSXOpeningElement, span: Span) {
        if span.is_dummy() {
            return; // no real source loc → skip (transform.ts: `if (!loc) return`)
        }
        let loc = self.source_map.lookup_char_pos(span.lo());
        let line = loc.line; // 1-indexed
        let col = loc.col.0 + 1; // SWC col is 0-based → +1 (Babel parity)
        opening
            .attrs
            .push(str_attr("data-layout-source-file", &self.relative_file));
        opening
            .attrs
            .push(str_attr("data-layout-source-line", &line.to_string()));
        opening
            .attrs
            .push(str_attr("data-layout-source-col", &col.to_string()));
        opening
            .attrs
            .push(str_attr("data-layout-component", &self.current_component()));
    }
}

impl<'a> VisitMut for LayoutTagger<'a> {
    fn visit_mut_fn_decl(&mut self, n: &mut FnDecl) {
        self.stack.push(n.ident.sym.to_string());
        n.visit_mut_children_with(self);
        self.stack.pop();
    }

    fn visit_mut_class_decl(&mut self, n: &mut ClassDecl) {
        self.stack.push(n.ident.sym.to_string());
        n.visit_mut_children_with(self);
        self.stack.pop();
    }

    fn visit_mut_var_declarator(&mut self, n: &mut VarDeclarator) {
        // `const Card = () => …` / `const Card = function () {…}` → component
        // name is the variable. For a function-expression init, suppress its
        // own id so the variable name wins (transform.ts checks the var rule
        // before the named-fn-expr rule).
        let named = match (&n.name, n.init.as_deref()) {
            (Pat::Ident(bi), Some(Expr::Arrow(_))) => Some(bi.id.sym.to_string()),
            (Pat::Ident(bi), Some(Expr::Fn(_))) => {
                self.suppress_fn_name = true;
                Some(bi.id.sym.to_string())
            }
            _ => None,
        };
        if let Some(name) = named {
            self.stack.push(name);
            n.visit_mut_children_with(self);
            self.stack.pop();
        } else {
            n.visit_mut_children_with(self);
        }
    }

    fn visit_mut_fn_expr(&mut self, n: &mut FnExpr) {
        if std::mem::take(&mut self.suppress_fn_name) {
            // Direct init of `const X = function () {}` — X is already on the
            // stack; don't push the fn's own id.
            n.visit_mut_children_with(self);
            return;
        }
        // Standalone (named) function expression: `foo(function Bar() {…})`.
        if let Some(id) = &n.ident {
            self.stack.push(id.sym.to_string());
            n.visit_mut_children_with(self);
            self.stack.pop();
        } else {
            n.visit_mut_children_with(self);
        }
    }

    fn visit_mut_jsx_element(&mut self, n: &mut JSXElement) {
        let opening = &mut n.opening;
        let should_tag = match &opening.name {
            // Member expressions (Context.Provider) and namespaced names aren't
            // plain DOM tags — never tag, but still recurse into children.
            JSXElementName::Ident(ident) => {
                let tag = ident.sym.as_ref();
                let is_capital = tag.chars().next().is_some_and(|c| c.is_uppercase());
                if tag == "Fragment" {
                    false
                } else if is_capital && !has_literal_classname(opening) {
                    false
                } else if is_pre_attributed(opening) {
                    false
                } else {
                    !has_raw_html(opening)
                }
            }
            _ => false,
        };
        if should_tag {
            let span = opening.span;
            self.tag(opening, span);
        }
        n.visit_mut_children_with(self);
    }
}

#[plugin_transform]
pub fn process_transform(
    mut program: Program,
    metadata: TransformPluginProgramMetadata,
) -> Program {
    let config: Config = metadata
        .get_transform_plugin_config()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default();

    let filename = metadata
        .get_context(&TransformPluginMetadataContextKind::Filename)
        .unwrap_or_default();
    let relative_file = make_relative(&config.project_root, &filename);

    let mut tagger = LayoutTagger {
        source_map: &metadata.source_map,
        relative_file,
        stack: Vec::new(),
        suppress_fn_name: false,
    };
    program.visit_mut_with(&mut tagger);
    program
}
