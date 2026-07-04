// test-only --require preload: shifts Date.now() forward by the ms count in the file named by
// MI_FAKE_NOW_OFFSET_FILE, re-read on every call so tests can advance the goal loop's clock mid-run
// (e.g. to cross the 40%/50% budget-elapsed pivot/escalation gates without real waiting).
const fs = require('fs'), real = Date.now.bind(Date), f = process.env.MI_FAKE_NOW_OFFSET_FILE;
if (f) Date.now = () => { let o = 0; try { o = +fs.readFileSync(f, 'utf8') || 0; } catch {} return real() + o; };
