// DOM操作のヒューリスティクス（send.jsから抽出・最適化）
// 元のsalesbotのFIELD_KEYWORDSとSUBMIT_KEYWORDSを基に強化

// 型定義
interface Profile {
  name: string;
  company: string;
  department: string;
  position: string;
  email: string;
  tel: string;
  fullAddress: string;
  [key: string]: string | undefined;
}

// ====================================
// 定数定義（salesbotから移植）
// ====================================

const FIELD_KEYWORDS = {
  company: ['社名', '企業名', '法人名', '個人', '組織', '所属', '団体', '勤務先', 'company', 'Company', 'COMPANY', 'corporate', 'Corporate'],
  department: ['部署', '部門'],
  industry: ['業種'],
  position: ['役職'],
  subject: ['件名', 'タイトル', '題名', 'Subject', 'subject'],
  member: ['従業員数', '社員数'],
  sei: ['姓', '苗字'],
  seiKana: ['セイ'],
  meiKana: ['メイ'],
  seiHira: ['せい'],
  meiHira: ['めい'],
  name: ['名前', '氏名', '担当者', 'なまえ', 'Name', 'name'],
  furigana: ['フリガナ'],
  hiragana: ['ふりがな'],
  email: ['メール', 'MAIL', 'Mail', 'mail', '確認', '@'],
  tel: ['TEL', 'Tel', 'tel', '電話', '携帯', '直通', '連絡先'],
  fax: ['FAX', 'Fax', 'fax', 'ファックス'],
  zip: ['郵便', '〒'],
  pref: ['都道府県'],
  city: ['市区町村'],
  address: ['番地'],
  building: ['ビル', '建物'],
  fullAddress: ['住所', '所在', 'ところ', 'ADDRESS', 'Address', 'address'],
  url: ['URL', 'WEB', 'Web', 'web', 'ホームページ', 'ウェブサイト', 'http', 'リンク']
};

const SUBMIT_KEYWORDS = {
  text: ['送信', '送 信', '送　信', '確認', '確 認', '確　認', 'Send', 'SEND', 'Submit', 'SUBMIT', '次へ', '次に進む', 'はい', 'OK', '同意する', '続行'],
  value: ['送信', '送 信', '送　信', '確認', '確 認', '確　認', 'Send', 'SEND', 'Submit', 'SUBMIT', '問い合', '問合', '次へ', '次に進む', 'はい', 'OK', '同意する', '続行'],
  alt: ['送信', '確認', 'Send', 'SEND', 'Submit', 'SUBMIT', '問い合', '問合', '次へ', '次に進む', 'はい', 'OK', '同意する', '続行']
};

// ====================================
// ユーティリティ関数
// ====================================

/**
 * ラベルテキストからフィールドタイプを識別
 * @param {string} labelText - ラベルテキスト
 * @returns {string|null} フィールドタイプ
 */
function identifyFieldType(labelText: string): string | null {
  for (const [type, keywords] of Object.entries(FIELD_KEYWORDS)) {
    if (keywords.some(keyword => labelText.includes(keyword))) {
      return type;
    }
  }
  return null;
}

/**
 * プロフィールから適切な値を抽出
 * @param {any} profile - プロフィールオブジェクト
 * @param {string} fieldType - フィールドタイプ
 * @returns {string} 入力値
 */
function getProfileValue(profile: Profile, fieldType: string): string {
  switch (fieldType) {
    case 'name': return profile.name || '';
    case 'company': return profile.company || '';
    case 'department': return profile.department || '';
    case 'position': return profile.position || '';
    case 'email': return profile.email || '';
    case 'tel': return profile.tel || '';
    case 'fullAddress': return profile.fullAddress || '';
    default: return '';
  }
}

// ====================================
// フォーム入力関数（強化版）
// ====================================

export async function fillForm(page: any, profile: Profile) {
  console.log('フォーム入力開始（強化版）');

  // メッセージフィールドの優先入力（textarea優先）
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
      console.log(`メッセージ入力完了: ${selector}`);
      break;
    }
  }

  // ラベル付きフィールドの入力
  const labels = page.locator('label');
  const labelCount = await labels.count();

  for (let i = 0; i < labelCount; i++) {
    const label = labels.nth(i);
    const labelText = await label.textContent();
    if (labelText) {
      const fieldType = identifyFieldType(labelText);
      if (fieldType) {
        const input = label.locator('+ input, + textarea, + select').first();
        if (await input.isVisible()) {
          const value = getProfileValue(profile, fieldType);
          if (value) {
            await input.fill(value);
            console.log(`フィールド入力: ${fieldType} = ${value}`);
          }
        }
      }
    }
  }

  // 名前付きフィールドの入力（ラベルなしの場合）
  for (const [fieldType, keywords] of Object.entries(FIELD_KEYWORDS)) {
    for (const keyword of keywords) {
      const selector = `input[name*="${keyword}"], textarea[name*="${keyword}"], select[name*="${keyword}"]`;
      const element = page.locator(selector).first();
      if (await element.isVisible()) {
        const value = getProfileValue(profile, fieldType);
        if (value) {
          await element.fill(value);
          console.log(`名前付きフィールド入力: ${fieldType} = ${value}`);
        }
      }
    }
  }

  console.log('フォーム入力完了');
}

// ====================================
// 送信ボタン特定とクリック（強化版）
// ====================================

export async function clickSubmitButton(page: any): Promise<void> {
  const submitSelectors = [
    'input[type="submit"]',
    'button[type="submit"]',
    ...SUBMIT_KEYWORDS.text.map(text => `button:contains("${text}")`),
    ...SUBMIT_KEYWORDS.value.map(value => `input[value*="${value}"]`),
    ...SUBMIT_KEYWORDS.alt.map(alt => `input[alt*="${alt}"]`)
  ];

  for (const selector of submitSelectors) {
    const element = page.locator(selector).first();
    if (await element.isVisible()) {
      await element.click();
      console.log(`送信ボタンクリック: ${selector}`);
      return;
    }
  }

  console.log('送信ボタンが見つかりませんでした');
}

// ====================================
// 確認画面対応（強化版）
// ====================================

export async function handleConfirmationPage(page: any): Promise<void> {
  try {
    // 確認画面の検知（送信ボタン後のページ変化を待つ）
    await page.waitForTimeout(2000);

    // 確認ボタンを探す
    const confirmSelectors = [
      'button:contains("確認")',
      'input[value*="確認"]',
      'button:contains("はい")',
      'input[type="submit"]'
    ];

    for (const selector of confirmSelectors) {
      const element = page.locator(selector).first();
      if (await element.isVisible()) {
        await element.click();
        console.log(`確認画面ボタンクリック: ${selector}`);
        return;
      }
    }
  } catch (error) {
    console.error('確認画面処理エラー:', error);
  }
}

