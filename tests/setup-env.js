'use strict';

// Tests must never spawn a real proxy daemon or edit the developer's shell rc.
// `install()`/`uninstall()` honour this flag; the proxy tests drive the daemon
// module directly, so they are unaffected.
process.env.LAKON_PROXY_DISABLE = '1';

// Nor may they see the developer's own Claude config dir. Both
// `claudeConfigDir(home)` (src/install/paths.js) and `skillDirs(home)`
// (src/pixel/paths.js) prefer $CLAUDE_CONFIG_DIR over the home they are handed —
// correct in production, where the real home is always passed and the variable is
// how a custom config dir is selected, but fatal under test: every home-isolated
// test on a machine that sets it was silently pointed at the real ~/.claude.
// `doctor.hooksInstalled` found a real settings.json where the fake home had
// none, and the pixel tests scanned real installed skills — `convert()` writes to
// the files it finds, so that was a live hazard, not just a red suite. Unset it
// once here; the tests that exercise the variable set it themselves via withEnv.
delete process.env.CLAUDE_CONFIG_DIR;
