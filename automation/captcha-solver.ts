// CAPTCHA対応（オプション・基本実装）

import axios from 'axios';

// 2CaptchaなどのサービスでCAPTCHAを解決
export async function solveCaptcha(siteKey: string, pageUrl: string): Promise<string | null> {
  const apiKey = process.env.CAPTCHA_API_KEY; // 環境変数から取得
  if (!apiKey) {
    console.log('CAPTCHA APIキーが設定されていません。スキップします。');
    return null;
  }

  try {
    // 2Captchaの例（実際のAPIに合わせて調整）
    const response = await axios.post(`http://2captcha.com/in.php?key=${apiKey}&method=userrecaptcha&googlekey=${siteKey}&pageurl=${pageUrl}&json=1`);
    const taskId = response.data.request;

    // 結果待機
    let token: string | null = null;
    for (let i = 0; i < 10; i++) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      const res = await axios.get(`http://2captcha.com/res.php?key=${apiKey}&action=get&id=${taskId}&json=1`);
      if (res.data.status === 1) {
        token = res.data.request;
        break;
      }
    }

    return token;
  } catch (error) {
    console.error('CAPTCHA解決エラー:', error);
    return null;
  }
}

// ページ内でreCAPTCHAを検知・解決
export async function handleRecaptcha(page: any) {
  const recaptchaFrame = page.frameLocator('[src*="recaptcha"]');
  if (await recaptchaFrame.locator('.g-recaptcha').isVisible()) {
    const siteKey = await recaptchaFrame.locator('[data-sitekey]').getAttribute('data-sitekey');
    const pageUrl = page.url();
    const token = await solveCaptcha(siteKey, pageUrl);

    if (token) {
      await page.evaluate(`grecaptcha.execute('${siteKey}', { action: 'submit' }).then(token => document.querySelector('[name="g-recaptcha-response"]').value = token);`);
    }
  }
}

