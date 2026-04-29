'use strict';

const { defineConfig, devices } = require('@playwright/test');

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5445';

module.exports = defineConfig({
	testDir: './playwright-tests',
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: 1,
	reporter: [['list'], ['html', { open: 'never' }]],
	use: {
		baseURL,
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure',
		headless: true,
	},
	projects: [
		{
			name: 'desktop',
			use: {
				...devices['Desktop Chrome'],
				browserName: 'chromium',
				viewport: { width: 1440, height: 1100 },
			},
		},
		{
			name: 'mobile',
			use: {
				...devices['Pixel 7'],
				browserName: 'chromium',
			},
		},
	],
	expect: {
		timeout: 15000,
	},
	timeout: 90000,
});
