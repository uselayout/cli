/**
 * Thin webpack-loader wrapper around the shared layout Babel transform.
 *
 * Runs after Next's own Babel loader (so it sees plain JSX). Injects the
 * layout source-location attrs in dev only. Source maps are chained back to
 * webpack so error stacks still point at the user's original lines.
 */
import { transformWithLayoutAttrs } from "../transform.js";

interface LoaderContext {
  resourcePath: string;
  rootContext: string;
  async(): (
    err: Error | null,
    content?: string,
    sourceMap?: object
  ) => void;
}

export default function layoutBabelLoader(
  this: LoaderContext,
  source: string,
  inputMap?: object
): void {
  const callback = this.async();
  try {
    const result = transformWithLayoutAttrs(
      source,
      this.resourcePath,
      this.rootContext
    );
    if (result.code === source && result.map === null) {
      // Nothing injected — pass through with the incoming map intact.
      callback(null, source, inputMap);
      return;
    }
    callback(null, result.code, result.map ?? inputMap);
  } catch (err) {
    // Never break the dev build over an attr-injection failure.
    callback(null, source, inputMap);
    void err;
  }
}
