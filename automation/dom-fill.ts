// DOM操作のヒューリスティクス（send.jsから抽出・最適化）

// フォーム入力のヒューリスティクス関数
export async function fillForm(page: any, profile: any) {
  console.log('フォーム入力開始');

  // 基本フィールドの優先順位: textarea > input[name="message"] > その他
  const textareaSelectors = [
    'textarea[name*="message"]',
    'textarea[name*="inquiry"]',
    'textarea[name*="comment"]',
    'textarea'
  ];

  for (const selector of textareaSelectors) {
    const element = page.locator(selector).first();
    if (await element.isVisible()) {
      await element.fill(profile.message || 'お問い合わせ内容です。');
      break;
    }
  }

  // 名前・会社フィールド
  await page.fill('input[name*="name"]', profile.name);
  await page.fill('input[name*="company"]', profile.company);

  // メール・電話
  await page.fill('input[name*="email"]', profile.email);
  await page.fill('input[name*="tel"]', profile.phone);

  // 住所（郵便番号・住所を分割）
  if (profile.address) {
    await page.fill('input[name*="zip"]', profile.address.zip);
    await page.fill('input[name*="address"]', profile.address.prefecture);
    await page.fill('input[name*="city"]', profile.address.city);
  }

  console.log('フォーム入力完了');
}

// 送信ボタンの特定とクリック
export async function clickSubmitButton(page: any) {
  const submitSelectors = [
    'input[type="submit"]',
    'button[type="submit"]',
    'button:contains("送信")',
    'input[value*="送信"]'
  ];

  for (const selector of submitSelectors) {
    const element = page.locator(selector).first();
    if (await element.isVisible()) {
      await element.click();
      break;
    }
  }
}

