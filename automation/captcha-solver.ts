// CAPTCHA解決機能（無料オプション中心）
// 元のsalesbotのCAPTCHA解決を基に無料実装
// フォームドキュメント対応も追加

import { createWorker } from 'tesseract.js';

// 型定義
interface Page {
  locator: (selector: string) => { first: () => any; isVisible: () => Promise<boolean>; fill: (text: string) => Promise<void>; click: () => Promise<void>; screenshot: (options?: any) => Promise<Buffer>; };
  frameLocator: (src: string) => { locator: (selector: string) => { first: () => any; getAttribute: (attr: string) => Promise<string>; isVisible: () => Promise<boolean>; }; };
  waitForTimeout: (ms: number) => Promise<void>;
  pause: () => Promise<void>;
  url: () => string;
}

// ====================================
// 定数定義
// ====================================

const WAIT_TIMEOUT = 15000; // 15秒
const RECAPTCHA_WAIT = 20000; // 20秒

// ====================================
// 無料CAPTCHA解決関数
// ====================================

/**
 * 無料の画像CAPTCHA解決（Tesseract OCR使用）
 * @param {Buffer} imageBuffer - CAPTCHA画像のバッファ
 * @returns {Promise<string|null>} 解決されたテキストまたはnull
 */
export async function solveCaptchaFree(imageBuffer: Buffer): Promise<string | null> {
  try {
    const worker = await createWorker('eng');
    const { data: { text } } = await worker.recognize(imageBuffer);
    await worker.terminate();

    // テキストをクリーンアップ（数字や文字のみ抽出）
    const cleanedText = text.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    console.log(`OCR解決結果: ${cleanedText}`);
    return cleanedText.length > 0 ? cleanedText : null;
  } catch (error) {
    console.error('OCR CAPTCHA解決エラー:', error);
    return null;
  }
}

/**
 * 人間らしい入力シミュレーション
 * @param {any} page - Playwrightページオブジェクト
 */
export async function simulateHumanInput(page: Page): Promise<void> {
  const delay = Math.random() * 3000 + 1000; // 1-4秒のランダム遅延
  await page.waitForTimeout(delay);
  console.log(`人間らしい入力遅延をシミュレート: ${delay}ms`);
}

/**
 * reCAPTCHAを検知して無料オプションで対応
 * @param {any} page - Playwrightページオブジェクト
 */
export async function handleRecaptchaFree(page: Page): Promise<void> {
  try {
    // 厳格モード違反回避のため first() を用いて単一要素に限定
    const recaptchaIframe = (page as any).locator('iframe[src*="recaptcha"]').first();
    const hasRecaptcha = await recaptchaIframe.isVisible().catch(() => false);
    if (hasRecaptcha) {
      console.log('reCAPTCHA検知。無料オプションで対応します。');

      // サイトキーは任意（手動時の目安）
      let siteKey = '';
      try {
        siteKey = await (page as any).locator('.g-recaptcha[data-sitekey]').first().getAttribute('data-sitekey');
      } catch {}
      if (siteKey) {
        // CI環境では停止しない
        const shouldPause = !process.env.CI;
        if (shouldPause) {
          console.log('CAPTCHAを手動で解決してください。スクリプトを一時停止します。');
          await page.pause();
        }
      }
    }
  } catch (error) {
    console.error('reCAPTCHA処理エラー:', error);
  }
}

/**
 * フォーム内のCAPTCHA画像を検知して解決
 * @param {any} page - Playwrightページオブジェクト
 * @param {any} formDocument - フォームドキュメント（オプション）
 * @returns {Promise<string|null>} 解決されたテキスト
 */
export async function detectAndSolveCaptchaImage(page: Page, formDocument?: any): Promise<string | null> {
  try {
    const targetDocument = formDocument || page;

    // CAPTCHA画像のセレクタ（一般的なもの）
    const captchaSelectors = [
      'img[alt*="captcha"]',
      'img[src*="captcha"]',
      '.captcha img',
      '#captcha',
      '[id*="captcha"] img'
    ];

    for (const selector of captchaSelectors) {
      const img = targetDocument.locator(selector).first();
      if (await img.isVisible()) {
        console.log(`CAPTCHA画像検知: ${selector}`);

        // 画像をダウンロード
        const imageBuffer = await img.screenshot({ encoding: 'binary' });

        // OCRで解決
        const solvedText = await solveCaptchaFree(Buffer.from(imageBuffer, 'binary'));
        if (solvedText) {
          // 入力フィールドにテキストを入力
          const inputField = targetDocument.locator('input[name*="captcha"], #captcha-input');
          if (await inputField.isVisible()) {
            await inputField.fill(solvedText);
            console.log(`CAPTCHA入力完了: ${solvedText}`);
            return solvedText;
          }
        }
      }
    }
    return null;
  } catch (error) {
    console.error('CAPTCHA画像解決エラー:', error);
    return null;
  }
}
