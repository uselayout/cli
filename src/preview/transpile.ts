import ts from "typescript";

export interface TranspileResult {
  js: string;
  error?: string;
}

/**
 * Transpile TSX/JSX source to CommonJS JavaScript using TypeScript's transpileModule.
 * If the input looks like plain HTML (no JSX indicators), returns it unchanged.
 */
export function transpileTsx(code: string): TranspileResult {
  const trimmed = code.trim();

  // If it looks like plain HTML (starts with < but has no JSX indicators), return as-is
  const isPlainHtml =
    trimmed.startsWith("<!") ||
    (trimmed.startsWith("<") &&
      !trimmed.includes("import ") &&
      !trimmed.includes("export ") &&
      !trimmed.includes("const ") &&
      !trimmed.includes("function ") &&
      !trimmed.includes("=> ") &&
      !trimmed.includes("useState") &&
      !trimmed.includes("useEffect"));

  if (isPlainHtml) {
    return { js: code };
  }

  try {
    const result = ts.transpileModule(code, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.React,
        esModuleInterop: true,
        allowJs: true,
        strict: false,
      },
      fileName: "component.tsx",
    });

    return { js: result.outputText };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { js: "", error: message };
  }
}
