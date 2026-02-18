const { chromium } = require('playwright');

// Refresh cult.fit session cookies using Playwright.
// Visits cult.fit with current cookies — the site auto-refreshes them.
// Outputs fresh AT and ST values to stdout for GitHub Actions to capture.

async function refreshTokens() {
    const AT = process.env.AT;
    const ST = process.env.ST;

    if (!AT || !ST) {
        console.error('[refresh] Missing AT or ST env vars');
        process.exit(1);
    }

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
    });

    // Set existing cookies
    await context.addCookies([
        { name: 'at', value: AT, domain: '.cult.fit', path: '/' },
        { name: 'st', value: ST, domain: '.cult.fit', path: '/' },
    ]);

    const page = await context.newPage();

    try {
        // Visit a lightweight page to trigger cookie refresh
        await page.goto('https://www.cult.fit/cult', { waitUntil: 'networkidle', timeout: 15000 });
        await page.waitForTimeout(2000);

        // Extract refreshed cookies
        const cookies = await context.cookies('https://www.cult.fit');
        const freshAT = cookies.find(c => c.name === 'at')?.value;
        const freshST = cookies.find(c => c.name === 'st')?.value;

        if (!freshAT || !freshST) {
            console.error('[refresh] Could not extract cookies — session may be fully expired');
            console.error('[refresh] You need to manually update AT and ST secrets');
            process.exit(1);
        }

        // Check if we're actually logged in
        const pageContent = await page.content();
        if (pageContent.includes('Login') && !pageContent.includes('logout') && !pageContent.includes('account')) {
            console.error('[refresh] Session expired — not logged in');
            process.exit(1);
        }

        // Output as GitHub Actions format so the workflow can update secrets
        console.log(`FRESH_AT=${freshAT}`);
        console.log(`FRESH_ST=${freshST}`);

        const atChanged = freshAT !== AT;
        const stChanged = freshST !== ST;
        console.error(`[refresh] AT ${atChanged ? 'REFRESHED' : 'unchanged'}`);
        console.error(`[refresh] ST ${stChanged ? 'REFRESHED' : 'unchanged'}`);

    } catch (err) {
        console.error('[refresh] Error:', err.message);
        process.exit(1);
    } finally {
        await browser.close();
    }
}

refreshTokens();
