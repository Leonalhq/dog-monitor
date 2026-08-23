import { chromium, type Browser, type Page } from "playwright";

export class BrowserPool {
  private browserPromise: Promise<Browser> | undefined;

  private getBrowser(): Promise<Browser> {
    this.browserPromise ??= chromium.launch({ headless: true });
    return this.browserPromise;
  }

  async withPage<T>(run: (page: Page) => Promise<T>): Promise<T> {
    const browser = await this.getBrowser();
    const page = await browser.newPage({
      userAgent: "AdoptableDogMonitor/0.1 (+personal rescue listing monitor)",
      viewport: { width: 1280, height: 900 }
    });
    try {
      return await run(page);
    } finally {
      await page.close();
    }
  }

  async close(): Promise<void> {
    if (!this.browserPromise) return;
    const browser = await this.browserPromise;
    await browser.close();
    this.browserPromise = undefined;
  }
}
