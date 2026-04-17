const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  await page.goto('http://localhost:5174/');
  await page.waitForTimeout(2000);
  
  console.log('Current URL after load:', page.url());
  
  // Fill the login form
  await page.fill('input[type="email"]', 'micky@duroflexworld.com');
  await page.fill('input[type="password"]', 'duroflex123');
  await page.click('button[type="submit"]');
  
  await page.waitForTimeout(2000);
  console.log('Current URL after login:', page.url());
  
  const h1 = await page.$eval('h1', el => el.textContent).catch(() => 'no h1');
  console.log('H1 text:', h1);
  
  await browser.close();
})();
