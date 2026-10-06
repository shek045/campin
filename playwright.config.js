const { defineConfig } = require('@playwright/test');

// Port 5510 keeps the browser-test fixture server independent of any long-running
// fixture instance on the default port 5502 (tests/fixture-server.js, PORT-overridable).
const port = Number(process.env.BROWSER_TEST_PORT || 5510);
const baseURL = `http://127.0.0.1:${port}`;

module.exports = defineConfig({
  testDir: './tests/browser',
  workers: 1,
  fullyParallel: false,
  use: { baseURL },
  webServer: {
    command: `PORT=${port} node tests/fixture-server.js`,
    url: baseURL,
    reuseExistingServer: false
  }
});
