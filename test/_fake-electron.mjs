// Preload that makes commander believe it's running under Electron — exactly
// the situation Layout Live's one-click "Set up editing" creates when it runs
// this CLI through the Electron binary with ELECTRON_RUN_AS_NODE=1. argv stays
// node-shaped ([exec, script, ...args]); only the electron signature is present.
// Used by cli-electron-argv.test.ts to guard the argv-parsing regression.
if (!process.versions.electron) {
  Object.defineProperty(process.versions, "electron", {
    value: "33.4.11",
    configurable: true,
  });
}
