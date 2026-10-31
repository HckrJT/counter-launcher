// Where releases live. Kept in code on purpose: electron-builder strips the "build" section from the packaged
// package.json, so reading it there at runtime would fail.
module.exports = { owner: 'HckrJT', repo: 'counter-launcher' };
