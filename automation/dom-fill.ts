// DOM操作のヒューリスティクス（send.jsから抽出・最適化）
// 元のsalesbotのFIELD_KEYWORDSとSUBMIT_KEYWORDSを基に強化
// フォームドキュメント探索機能も追加

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
  text: ['送信', '送 信', '送　信', 'この内容で送信', '確認', '確 認', '確　認', 'Send', 'SEND', 'Submit', 'SUBMIT', '次へ', '次に進む', 'はい', 'OK', '同意する', '続行'],
  value: ['送信', '送 信', '送　信', 'この内容で送信', '確認', '確 認', '確　認', 'Send', 'SEND', 'Submit', 'SUBMIT', '問い合', '問合', '次へ', '次に進む', 'はい', 'OK', '同意する', '続行'],
  alt: ['送信', '確認', 'Send', 'SEND', 'Submit', 'SUBMIT', '問い合', '問合', '次へ', '次に進む', 'はい', 'OK', '同意する', '続行']
};

// 送信対象から除外したいボタン・リンクに含まれがちなキーワード
const EXCLUDE_SUBMIT_KEYWORDS = ['検索', 'Search', 'さがす', '探す', '絞り', 'filter', '戻る', 'キャンセル', '取消', 'リセット', 'clear', 'クリア', 'プレビュー'];

// ====================================
// フォームドキュメント探索関数（salesbotのfindFormDocumentから移植）
// ====================================

/**
 * フォームが含まれるドキュメントを探索（iframe対応）
 * @param {any} page - Playwrightページオブジェクト
 * @returns {Promise<any|null>} フォームドキュメントまたはnull
 */
export async function findFormDocument(page: any): Promise<any | null> {
  // メインドキュメント: textarea もしくはフォーム要素が存在するか
  try {
    const hasTextarea = (await page.locator('textarea').count()) > 0;
    const hasFormFields = (await page.locator('form input, form textarea, form select').count()) > 0;
    if (hasTextarea || hasFormFields) {
      return page;
    }
  } catch (error) {
    console.warn('Main document probing error:', error);
  }

  // iframe内を探索: textarea もしくはフォーム要素が存在するか
  const iframes = page.locator('iframe');
  const iframeCount = await iframes.count();
  for (let i = 0; i < iframeCount; i++) {
    try {
      const frame = page.frameLocator(`iframe:nth-of-type(${i + 1})`);
      const iframeHasTextarea = (await frame.locator('textarea').count()) > 0;
      const iframeHasFormFields = (await frame.locator('form input, form textarea, form select').count()) > 0;
      if (iframeHasTextarea || iframeHasFormFields) {
        return frame;
      }
    } catch (iframeError) {
      console.warn('Cannot access iframe:', iframeError);
    }
  }

  return null;
}

// ====================================
// アクティブフォーム特定（textareaまたは入力要素が所在するform）
// ====================================

export async function findActiveForm(pageOrFrame: any): Promise<any | null> {
  try {
    // textareaのあるフォームを最優先
    const firstVisibleTextarea = pageOrFrame.locator('textarea').first();
    if (await firstVisibleTextarea.isVisible().catch(() => false)) {
      const parentForm = firstVisibleTextarea.locator('xpath=ancestor::form[1]').first();
      if (await parentForm.count() > 0 && await parentForm.isVisible().catch(() => false)) {
        return parentForm;
      }
    }

    // 入力要素が最も多いフォームを採用
    const forms = pageOrFrame.locator('form');
    const formCount = await forms.count();
    let bestForm: any | null = null;
    let bestScore = -1;
    for (let i = 0; i < formCount; i++) {
      const form = forms.nth(i);
      const inputs = form.locator('input, textarea, select');
      const visibleCount = await inputs.evaluateAll((elements: Element[]) => {
        return elements.filter(el => {
          const style = (window as any).getComputedStyle(el as HTMLElement);
          const visible = style.display !== 'none' && style.visibility !== 'hidden' && (((el as any).offsetWidth ?? 0) > 0 || ((el as any).offsetHeight ?? 0) > 0 || style.position === 'fixed');
          return visible;
        }).length;
      }).catch(() => 0);
      if (visibleCount > bestScore) {
        bestScore = visibleCount;
        bestForm = form;
      }
    }
    if (bestForm && bestScore > 0) return bestForm;
  } catch (_) {}
  return null;
}

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
    case 'fax': return (profile as any).fax || '';
    case 'zip': return (profile as any).zip || '';
    case 'pref': return (profile as any).pref || '';
    case 'city': return (profile as any).city || '';
    case 'address': return (profile as any).address || '';
    case 'building': return (profile as any).building || '';
    case 'fullAddress': return profile.fullAddress || '';
    case 'url': return (profile as any).url || '';
    case 'subject': return (profile as any).subject || '';
    case 'industry': return (profile as any).industry || '';
    case 'member': return (profile as any).member || '';
    default: return '';
  }
}

// ====================================
// フォーム入力関数（強化版）
// ====================================

export async function fillForm(page: any, profile: Profile) {
  console.log('フォーム入力開始（強化版）');

  // ====================================
  // フォームが含まれるドキュメントを探索（salesbotのfindFormDocumentから移植）
  // ====================================

  const formDocument = await findFormDocument(page);
  if (!formDocument) {
    console.log('問い合わせフォームが見つかりませんでした');
    return;
  }

  console.log('フォームドキュメント発見:', formDocument === page ? 'メインドキュメント' : 'iframe内');

  // メッセージフィールドの優先入力（textarea優先）
  const textareaSelectors = [
    'textarea[name*="message"]',
    'textarea[name*="inquiry"]',
    'textarea[name*="comment"]',
    'textarea'
  ];

  for (const selector of textareaSelectors) {
    const element = formDocument.locator(selector).first();
    if (await element.isVisible()) {
      await element.fill(profile.message || 'お問い合わせ内容です。');
      try {
        await (element as any).dispatchEvent('input');
        await (element as any).dispatchEvent('change');
        await (element as any).blur();
      } catch (_) {}
      console.log(`メッセージ入力完了: ${selector}`);
      break;
    }
  }

  // ラベル付きフィールドの入力
  const labels = formDocument.locator('label');
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
            // SELECT は selectOption、それ以外は fill
            const tagName = await input.evaluate((el: Element) => el.tagName);
            if (tagName !== 'SELECT') {
              // 既に値があれば上書きしない
              const current = (await (input as any).inputValue().catch(() => '')) || '';
              if (current.trim().length > 0) continue;
              // mailaddress 誤爆防止: fullAddress は mail を含む name には入れない
              const nameAttr = (await input.getAttribute('name')) || '';
              if (fieldType === 'fullAddress' && /mail/i.test(nameAttr)) continue;
            }
            if (tagName === 'SELECT') {
              try {
                await (input as any).selectOption({ label: value });
              } catch {
                try { await (input as any).selectOption({ value }); } catch {}
              }
            } else {
              await input.fill(value);
            }
            console.log(`フィールド入力: ${fieldType} = ${value}`);
            try {
              await (input as any).dispatchEvent('input');
              await (input as any).dispatchEvent('change');
              await (input as any).blur();
            } catch (_) {}
          }
        }
      }
    }
  }

  // 名前付きフィールドの入力（ラベルなしの場合）
  for (const [fieldType, keywords] of Object.entries(FIELD_KEYWORDS)) {
    for (const keyword of keywords) {
      const selector = `input[name*="${keyword}"], textarea[name*="${keyword}"], select[name*="${keyword}"]`;
      const element = formDocument.locator(selector).first();
      if (await element.isVisible()) {
        const value = getProfileValue(profile, fieldType);
        if (value) {
          const tagName = await element.evaluate((el: Element) => el.tagName);
          if (tagName !== 'SELECT') {
            // 既に値があれば上書きしない
            const current = (await (element as any).inputValue().catch(() => '')) || '';
            if (current.trim().length > 0) continue;
            // mailaddress 誤爆防止
            const nameAttr = (await element.getAttribute('name')) || '';
            if (fieldType === 'fullAddress' && /mail/i.test(nameAttr)) continue;
          }
          if (tagName === 'SELECT') {
            try {
              await (element as any).selectOption({ label: value });
            } catch {
              try { await (element as any).selectOption({ value }); } catch {}
            }
          } else {
            await element.fill(value);
          }
          console.log(`名前付きフィールド入力: ${fieldType} = ${value}`);
          try {
            await (element as any).dispatchEvent('input');
            await (element as any).dispatchEvent('change');
            await (element as any).blur();
          } catch (_) {}
        }
      }
    }
  }

  // メール確認・電話確認などのフォールバック入力
  const confirmEmailSelectors = [
    'input[name*="confirm"][type="email"]',
    'input[name*="email-confirm"]',
    'input[name*="mail-confirm"]',
    'input[name*="メール確認"]',
  ];
  for (const sel of confirmEmailSelectors) {
    const el = formDocument.locator(sel).first();
    if (await el.isVisible()) {
      try { await el.fill(profile.email || ''); } catch {}
    }
  }
  const confirmTelSelectors = [
    'input[name*="tel-confirm"]',
    'input[name*="phone-confirm"]',
    'input[name*="電話確認"]',
  ];
  for (const sel of confirmTelSelectors) {
    const el = formDocument.locator(sel).first();
    if (await el.isVisible()) {
      try { await el.fill(profile.tel || ''); } catch {}
    }
  }

  // セレクトボックスの処理（profile.prefに一致するもの、なければ最後のオプション）
  const selects = formDocument.locator('select');
  const selectCount = await selects.count();
  for (let i = 0; i < selectCount; i++) {
    const select = selects.nth(i);
    if (await select.isVisible()) {
      try {
        const options = select.locator('option');
        const optionCount = await options.count();
        let selected = false;
        const pref = (profile as any).pref;
        if (pref) {
          for (let j = 0; j < optionCount; j++) {
            const text = (await options.nth(j).textContent()) || '';
            if (text.trim() === pref) {
              await select.selectOption({ index: j });
              selected = true;
              break;
            }
          }
        }
        if (!selected && optionCount > 0) {
          await select.selectOption({ index: optionCount - 1 });
        }
        try {
          await (select as any).dispatchEvent('input');
          await (select as any).dispatchEvent('change');
          await (select as any).blur();
        } catch (_) {}
      } catch (_) {}
    }
  }

  // ラジオボタンの処理（各nameグループで最初の有効な項目を選択）
  const radios = formDocument.locator('input[type="radio"]');
  const radioCount = await radios.count();
  const pickedRadioNames = new Set<string>();
  for (let i = 0; i < radioCount; i++) {
    const radio = radios.nth(i);
    if (await radio.isVisible()) {
      const name = (await radio.getAttribute('name')) || '';
      if (!pickedRadioNames.has(name)) {
        try { await radio.check({ timeout: 1000 }); } catch (_) {}
        pickedRadioNames.add(name);
      }
    }
  }

  // 同意系チェックボックスの処理（プライバシー、同意、利用規約など）
  const agreeKeywords = ['同意', '承諾', '利用規約', 'プライバシー', '個人情報'];
  const checkboxes = formDocument.locator('input[type="checkbox"]');
  const checkboxCount = await checkboxes.count();
  for (let i = 0; i < checkboxCount; i++) {
    const checkbox = checkboxes.nth(i);
    if (await checkbox.isVisible()) {
      try {
        const id = await checkbox.getAttribute('id');
        let labelText = '';
        if (id) {
          const label = formDocument.locator(`label[for="${id}"]`).first();
          if (await label.isVisible()) {
            labelText = (await label.textContent()) || '';
          }
        }
        if (!labelText) {
          const parentLabel = checkbox.locator('xpath=ancestor::label[1]').first();
          if (await parentLabel.isVisible()) {
            labelText = (await parentLabel.textContent()) || '';
          }
        }
        if (agreeKeywords.some(k => labelText.includes(k))) {
          try { await checkbox.check({ timeout: 1000 }); } catch (_) {}
        }
      } catch (_) {}
    }
  }

  // 電話番号の分割入力対応（tel/電話 を含む複数テキスト入力）
  try {
    const telInputs = formDocument.locator('input[type="tel"], input[type="text"]').filter({ has: formDocument.locator('[name*="tel"], [name*="電話"]') });
    const telCandidates = formDocument.locator('input[type="tel"][name*="tel"], input[type="text"][name*="tel"], input[type="tel"][name*="電話"], input[type="text"][name*="電話"]');
    const telCount = await telCandidates.count();
    if (telCount >= 2 && telCount <= 4 && (profile as any).tel) {
      const digits = (profile as any).tel.replace(/[^0-9]/g, '');
      const guessParts = (profile as any).tel.split(/[^0-9]+/).filter((p: string) => p.length > 0);
      const parts = guessParts.length >= 2 ? guessParts : [digits];
      for (let i = 0; i < telCount; i++) {
        const el = telCandidates.nth(i);
        const toFill = parts[i] || '';
        if (toFill) {
          try { await el.fill(toFill); } catch (_) {}
        }
      }
    }
  } catch (_) {}

  // 郵便番号の分割入力対応（zip/郵便）
  try {
    const zipCandidates = formDocument.locator('input[type="text"][name*="zip"], input[type="text"][name*="郵便"]');
    const zipCount = await zipCandidates.count();
    if (zipCount >= 2 && (profile as any).zip) {
      const parts = ((profile as any).zip as string).split(/[^0-9]+/).filter((p: string) => p.length > 0);
      for (let i = 0; i < zipCount; i++) {
        const el = zipCandidates.nth(i);
        const toFill = parts[i] || '';
        if (toFill) {
          try { await el.fill(toFill); } catch (_) {}
        }
      }
    }
  } catch (_) {}

  // 空の必須フィールドをダッシュで埋める（salesbotのフォールバック挙動）
  const textInputs = formDocument.locator('input[type="text"], input:not([type]), textarea');
  const textCount = await textInputs.count();
  for (let i = 0; i < textCount; i++) {
    const input = textInputs.nth(i);
    if (await input.isVisible()) {
      const current = await input.inputValue();
      if (current.trim() === '') {
        try { await input.fill('—'); } catch (_) {}
        try {
          await (input as any).dispatchEvent('input');
          await (input as any).dispatchEvent('change');
          await (input as any).blur();
        } catch (_) {}
      }
    }
  }

  console.log('フォーム入力完了');

  // フォーム入力後の検証（デバッグ用）
  console.log('フォーム入力結果を検証中...');
  const inputElements = formDocument.locator('input, textarea');
  const inputCount = await inputElements.count();

  for (let i = 0; i < Math.min(inputCount, 10); i++) { // 最初の10要素のみチェック
    const element = inputElements.nth(i);
    if (await element.isVisible()) {
      const tagName = await element.evaluate((el: Element) => el.tagName);
      const type = await element.getAttribute('type') || 'text';
      const name = await element.getAttribute('name') || '';
      const value = await element.inputValue();

      if (value.trim() !== '') {
        console.log(`入力確認: ${tagName}[${type}] ${name} = "${value.substring(0, 50)}${value.length > 50 ? '...' : ''}"`);
      }
    }
  }
}

// ====================================
// 送信ボタン特定とクリック（強化版）
// ====================================

export async function clickSubmitButton(page: any): Promise<void> {
  // フォームドキュメントとアクティブフォームを特定
  const formDocument = await findFormDocument(page);
  if (!formDocument) {
    console.log('フォームドキュメントが見つからないため送信ボタンを探せません');
    return;
  }
  const activeForm = await findActiveForm(formDocument);
  const scope = activeForm || formDocument;

  // 1) 送信系キーワードを含む候補を最優先でクリック（確認→送信の順に優先）
  const textKeywords = [...SUBMIT_KEYWORDS.text];
  // 確認を優先して押し、その後の handleConfirmationPage で送信を行うサイトに最適化
  const confirmFirst = ['確認', '確 認', '確　認'];
  const sendWords = textKeywords.filter(t => !confirmFirst.includes(t));
  const ordered = [...confirmFirst, ...sendWords];
  for (const text of ordered) {
    const elements = scope.locator('button, input[type="button"], span, a').filter({ hasText: text });
    const count = await elements.count();
    for (let i = 0; i < count; i++) {
      const el = elements.nth(i);
      if (!(await el.isVisible().catch(() => false))) continue;
      try { await (el as any).scrollIntoViewIfNeeded?.(); } catch (_) {}
      try { await el.click({ timeout: 10000 }); } catch { try { await el.click({ timeout: 10000, force: true }); } catch { continue; } }
      console.log(`送信ボタンクリック成功: text="${text}" (要素番号: ${i})`);
      return;
    }
  }

  // 2) input[value]/[alt] に送信系キーワード
  const valueSelectors = [
    ...SUBMIT_KEYWORDS.value.map(v => `input[value*="${v}"]`),
    ...SUBMIT_KEYWORDS.alt.map(v => `input[alt*="${v}"]`)
  ];
  for (const selector of valueSelectors) {
    const els = scope.locator(selector);
    const count = await els.count();
    for (let i = 0; i < count; i++) {
      const el = els.nth(i);
      if (!(await el.isVisible().catch(() => false))) continue;
      const disabled = await el.getAttribute('disabled');
      if (disabled !== null) continue;
      try { await (el as any).scrollIntoViewIfNeeded?.(); } catch (_) {}
      try { await el.click({ timeout: 10000 }); } catch { try { await el.click({ timeout: 10000, force: true }); } catch { continue; } }
      console.log(`送信ボタンクリック成功: ${selector} (要素番号: ${i})`);
      return;
    }
  }

  // 3) アンカー型ボタン（役割/URLヒント）
  const anchorSelectors = ['a[role="button"]', 'a[href*="confirm"]', 'a[href*="send"]', 'a[href*="submit"]'];
  for (const selector of anchorSelectors) {
    const els = scope.locator(selector);
    const count = await els.count();
    for (let i = 0; i < count; i++) {
      const el = els.nth(i);
      if (!(await el.isVisible().catch(() => false))) continue;
      const text = (await el.textContent())?.trim() || '';
      const val = text;
      if (EXCLUDE_SUBMIT_KEYWORDS.some(k => text.includes(k))) continue;
      try { await (el as any).scrollIntoViewIfNeeded?.(); } catch (_) {}
      try { await el.click({ timeout: 10000 }); } catch { try { await el.click({ timeout: 10000, force: true }); } catch { continue; } }
      console.log(`送信ボタンクリック成功: ${selector} text="${val}" (要素番号: ${i})`);
      return;
    }
  }

  // 4) 一般的な submit 要素。ただし除外語を含むものはスキップ
  const genericSelectors = ['input[type="submit"]', 'button[type="submit"]', 'input[type="image"]'];
  for (const selector of genericSelectors) {
    const els = scope.locator(selector);
    const count = await els.count();
    for (let i = 0; i < count; i++) {
      const el = els.nth(i);
      if (!(await el.isVisible().catch(() => false))) continue;
      const disabled = await el.getAttribute('disabled');
      if (disabled !== null) continue;
      const text = (await el.textContent())?.trim() || (await el.getAttribute('value')) || (await el.getAttribute('alt')) || '';
      if (EXCLUDE_SUBMIT_KEYWORDS.some(k => (text || '').includes(k))) continue;
      try { await (el as any).scrollIntoViewIfNeeded?.(); } catch (_) {}
      try { await el.click({ timeout: 10000 }); } catch { try { await el.click({ timeout: 10000, force: true }); } catch { continue; } }
      console.log(`送信ボタンクリック成功: ${selector} text/value="${text}" (要素番号: ${i})`);
      return;
    }
  }

  // 5) フォーム submit() フォールバック（アクティブフォームのみ）
  try {
    const submitted = await (scope as any).evaluate((node: any) => {
      const form = (node as Element).closest ? (node as Element).closest('form') : null;
      if (form && typeof (form as HTMLFormElement).submit === 'function') {
        (form as HTMLFormElement).submit();
        return true;
      }
      const forms = Array.from(document.getElementsByTagName('form')) as HTMLFormElement[];
      if (forms.length > 0) { forms[forms.length - 1].submit(); return true; }
      return false;
    });
    if (submitted) {
      console.log('送信ボタンが見つからないため、form.submit() を実行しました');
      return;
    }
  } catch (_) {}

  console.log('有効な送信ボタンが見つかりませんでした');
}

// ====================================
// 確認画面対応（@salesbot/ のconfirm.jsから移植・強化版）
// ====================================

export async function handleConfirmationPage(page: any): Promise<{ success: boolean; message: string }> {
  try {
    // 1秒待機（ページ読み込み完了を待つ）
    await page.waitForTimeout(1000);

    // フォームドキュメントを探索
    const formDocument = await findFormDocument(page);
    const finalUrlNow = page.url();
    const successUrlPattern = /(thanks|complete|completed|done|finish|finished|sent|success|ok)/i;
    const successTextPattern = /(ありがとうございました|送信完了|送信しました|受付完了|受け付けました|ありがとう|complete|success|thank|done)/i;
    const failurePattern = /(エラー|失敗|error|invalid|必須|未入力|もう一度|再入力|入力してください|不正)/i;
    const searchPattern = /(\/?\?s=|\/?search|[?&]s=)/i;

    if (!formDocument) {
      const content = await page.content();
      if (failurePattern.test(content) || searchPattern.test(finalUrlNow)) {
        return { success: false, message: '送信失敗を確認（エラー/検索を検知）' };
      }
      if (successTextPattern.test(content) || successUrlPattern.test(finalUrlNow)) {
        return { success: true, message: '送信成功を確認（成功キーワード/URL検知）' };
      }
      // AJAX系成功UIの遅延表示を待機
      const ajaxResult = await waitForAjaxSubmissionResult(page, 12000);
      if (ajaxResult) return ajaxResult;
      const hasFormUi = (await page.locator('form, textarea, input[type="submit"], button[type="submit"]').count()) > 0;
      if (!hasFormUi) {
        return { success: false, message: '確認UI不在かつ成功根拠不足（失敗扱い）' };
      }
      // フォームUIが残っている場合は後続処理へ（確認画面の可能性）
    }

    // ====================================
    // textareaの確認処理（送信後の状態チェック）
    // ====================================

    // まず、現在のページが確認画面かどうかをチェック
    // 確認画面の特徴的な要素（確認、送信完了などのキーワード）を探す
    const currentPageContent = await page.content();
    const isConfirmationPage = /確認(画面|ページ)?|確認へ|内容確認|最終確認/i.test(currentPageContent) && !successTextPattern.test(currentPageContent);

    if (isConfirmationPage) {
      // 確認画面の場合、textareaの値チェックは行わない（確認画面で内容表示される場合がある）
      console.log('確認画面を検知しました。textareaチェックをスキップします。');
    } else {
      // 確認画面ではない場合（依然としてフォーム）
      const textareas = formDocument.locator('textarea');
      const textareaCount = await textareas.count();
      if (textareaCount > 0) {
        // まずAJAX成功UIの遅延表示を待機
        const ajaxResult = await waitForAjaxSubmissionResult(page, 12000);
        if (ajaxResult) return ajaxResult;
        return { success: false, message: '送信後もフォームが残存（失敗の可能性）' };
      }
    }

    // ====================================
    // 送信ボタンの検索処理（@salesbot/ のロジックから移植・強化）
    // ====================================

    // テキストベースのボタン（span, button）を検索
    const textButtons = formDocument.locator('span, button');
    const textButtonCount = await textButtons.count();

    const textSubmitButtons = [];
    for (let i = 0; i < textButtonCount; i++) {
      const button = textButtons.nth(i);
      const buttonText = await button.innerText();

      if (buttonText && (
        buttonText.includes('送信') ||
        buttonText.includes('送 信') ||
        buttonText.includes('送　信') ||
        buttonText.includes('はい') ||
        buttonText.includes('OK') ||
        buttonText.includes('同意する') ||
        buttonText.includes('続行')
      )) {
        textSubmitButtons.push(button);
      }
    }

    // input要素のボタンを検索
    const inputButtons = formDocument.locator('input[type="submit"], input[type="button"]');
    const inputButtonCount = await inputButtons.count();

    const inputSubmitButtons = [];
    for (let i = 0; i < inputButtonCount; i++) {
      const button = inputButtons.nth(i);
      const buttonValue = await button.getAttribute('value');

      if (buttonValue && (
        buttonValue.includes('送信') ||
        buttonValue.includes('送 信') ||
        buttonValue.includes('送　信') ||
        buttonValue.includes('問い合') ||
        buttonValue.includes('問合') ||
        buttonValue.includes('はい') ||
        buttonValue.includes('OK') ||
        buttonValue.includes('同意する') ||
        buttonValue.includes('続行')
      )) {
        inputSubmitButtons.push(button);
      }
    }

    // 画像ボタンを検索
    const imageButtons = formDocument.locator('input[type="image"]');
    const imageButtonCount = await imageButtons.count();

    const imageSubmitButtons = [];
    for (let i = 0; i < imageButtonCount; i++) {
      const button = imageButtons.nth(i);
      const buttonAlt = await button.getAttribute('alt');

      if (buttonAlt && (
        buttonAlt.includes('送信') ||
        buttonAlt.includes('確認') ||
        buttonAlt.includes('はい') ||
        buttonAlt.includes('OK') ||
        buttonAlt.includes('同意する') ||
        buttonAlt.includes('続行')
      )) {
        imageSubmitButtons.push(button);
      }
    }

    // 全ての送信ボタンを統合
    const allSubmitButtons = [...textSubmitButtons, ...imageSubmitButtons, ...inputSubmitButtons];

    // ====================================
    // ボタンクリック処理（@salesbot/ のロジックから移植）
    // ====================================

    // 送信ボタンが見つからない場合は成功として処理（既に送信完了済み）
    if (allSubmitButtons.length === 0) {
      // 確認ボタンがない → 既に完了ページの可能性を再確認
      const content = await page.content();
      const finalUrl = page.url();
      if (successTextPattern.test(content) || successUrlPattern.test(finalUrl)) {
        return { success: true, message: '送信成功を確認（ボタン無/成功兆候）' };
      }
      // AJAX成功UIの遅延表示を待機
      const ajaxResult = await waitForAjaxSubmissionResult(page, 12000);
      if (ajaxResult) return ajaxResult;
      return { success: false, message: '確認ボタン不在で成功兆候なし（失敗）' };
    }

    // 最後のボタンをクリック（@salesbot/ のロジック）
  const targetButton = allSubmitButtons[allSubmitButtons.length - 1];
  try { await (targetButton as any).scrollIntoViewIfNeeded?.(); } catch (_) {}
  try {
    await (targetButton as any).click({ timeout: 10000 });
  } catch {
    await (targetButton as any).click({ timeout: 10000, force: true });
  }

    // 5秒待機（送信処理完了を待つ）
    await page.waitForTimeout(5000);

    // ====================================
    // 最終的な状態検証（@salesbot/ のロジックから拡張）
    // ====================================

    // ページの最終的なURLを確認（リダイレクトされたかチェック）
    const finalUrl = page.url();

    // ページ遷移をログ出力（実際のURL比較は簡易的に）
    console.log(`最終ページ確認: ${finalUrl}`);

    // ページコンテンツから成功/失敗の兆候をチェック
    const finalPageContent = await page.content();
    if (failurePattern.test(finalPageContent) || searchPattern.test(finalUrl)) {
      return { success: false, message: '送信失敗を確認（エラー/検索を検知）' };
    }
    if (successTextPattern.test(finalPageContent) || successUrlPattern.test(finalUrl)) {
      return { success: true, message: '送信成功を確認（成功キーワード/URL検知）' };
    }
    // AJAX成功UIの遅延表示を最後にもう一度待機
    const ajaxResult = await waitForAjaxSubmissionResult(page, 8000);
    if (ajaxResult) return ajaxResult;
    // 明確な成功根拠がない場合は失敗扱い（false positive回避）
    return { success: false, message: '最終検証で成功根拠なし（失敗扱い）' };

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `確認画面処理エラー: ${errorMessage}`
    };
  }
}

// ====================================
// AJAX送信の成功/失敗UI待機（CF7/WPForms/Ninja対応）
// ====================================

async function waitForAjaxSubmissionResult(page: any, timeoutMs: number): Promise<{ success: boolean; message: string } | null> {
  const successSelectors = [
    // Contact Form 7
    '.wpcf7 form.sent',
    '.wpcf7-mail-sent-ok',
    '.wpcf7 .wpcf7-response-output.wpcf7-mail-sent-ok',
    // WPForms
    '.wpforms-confirmation-container',
    '.wpforms-confirmation-scroll',
    // Ninja Forms
    '.nf-response-msg',
    '.ninja-forms-success-msg',
    '.nf-form-cont .nf-response-msg',
  ];
  const failureSelectors = [
    // Contact Form 7
    '.wpcf7 form.invalid',
    '.wpcf7-not-valid',
    '.wpcf7 .wpcf7-response-output.wpcf7-validation-errors',
    // WPForms
    '.wpforms-error',
    '.wpforms-error-container',
    // Ninja Forms
    '.nf-error',
    '.ninja-forms-error-msg',
  ];
  const successTextPattern = /(ありがとうございました|送信完了|送信しました|受付完了|受け付けました|ありがとう|complete|success|thank|done)/i;
  const failureTextPattern = /(エラー|失敗|error|invalid|必須|未入力|もう一度|再入力|入力してください|不正)/i;

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const foundSuccess = await page.evaluate((sels: string[], re: string) => {
        const success = sels.some(sel => document.querySelector(sel));
        if (success) return true;
        const txt = document.body?.innerText || '';
        return new RegExp(re, 'i').test(txt);
      }, successSelectors, successTextPattern.source);
      if (foundSuccess) {
        return { success: true, message: 'AJAX成功UIを検知' };
      }
      const foundFailure = await page.evaluate((sels: string[], re: string) => {
        const failure = sels.some(sel => document.querySelector(sel));
        if (failure) return true;
        const txt = document.body?.innerText || '';
        return new RegExp(re, 'i').test(txt);
      }, failureSelectors, failureTextPattern.source);
      if (foundFailure) {
        return { success: false, message: 'AJAX失敗UIを検知' };
      }
    } catch {}
    await page.waitForTimeout(300);
  }
  return null;
}

