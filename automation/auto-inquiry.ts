// お問い合わせ送信のメインスクリプト（salesbotのexplore.jsとsend.jsから移植・強化版）
import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import csv from 'csv-parser';
import { fillForm, clickSubmitButton, handleConfirmationPage, findFormDocument } from './dom-fill';
import { handleRecaptchaFree, detectAndSolveCaptchaImage, simulateHumanInput } from './captcha-solver';

// 型定義
interface Profile {
  name: string;
  company: string;
  department: string;
  position: string;
  email: string;
  tel: string;
  fullAddress: string;
  message: string;
  [key: string]: string | undefined;
}

interface Target {
  企業名: string;
  url: string;
}

interface ExploreResult {
  success: boolean;
  currentForm: boolean;
  contactLink: string;
  message?: string;
}

type ReasonCode =
  | 'OK_SUCCESS_KEYWORD'
  | 'OK_NO_FORM_UI'
  | 'OK_CONFIRM_CLICKED'
  | 'SKIP_REFUSAL'
  | 'ERR_NO_FORM'
  | 'ERR_CONTACT_PAGE_NO_FORM'
  | 'ERR_NO_SUBMIT'
  | 'ERR_REQUIRED_UNFILLED'
  | 'ERR_EXCEPTION'
  | 'ERR_UNKNOWN';

interface TargetOutcome {
  target: Target;
  success: boolean;
  reason: ReasonCode;
  detail?: string;
  finalUrl?: string;
}

// ====================================
// 定数定義（salesbotから移植・最適化）
// ====================================

const WAIT_TIMEOUT = 15000; // 15秒
const PAGE_LOAD_DELAY = 1000; // 1秒

// 営業お断り関連キーワード（使用頻度が高いもののみ）
const REFUSAL_KEYWORDS = ['遠慮', '断り', '禁止', '控え', '営業権'];

// ====================================
// フォーム探索関数（salesbotのexplore.jsから移植）
// ====================================

/**
 * フォーム探索処理（salesbotのexplore.jsから移植・Playwright対応版）
 * @param {any} page - Playwrightページオブジェクト
 * @returns {Promise<ExploreResult>} 探索結果
 */
async function exploreForm(page: any): Promise<ExploreResult> {
  try {
    // 1秒待機（ページ読み込み完了を待つ）
    await page.waitForTimeout(1000);

    let currentUrl = page.url();

    // ====================================
    // メインドキュメントでtextarea/フォーム要素探索
    // ====================================

    const textareas = page.locator('textarea');
    const inputsOrSelects = page.locator('form input, form select');
    const textareaCount = await textareas.count();
    const inputSelectCount = await inputsOrSelects.count();

    if (textareaCount > 0 || inputSelectCount > 2) {
      // 表示されているフォーム要素があれば「現在のページにフォームあり」
      const visibleTextarea = await textareas.first().isVisible().catch(() => false);
      const visibleField = await inputsOrSelects.first().isVisible().catch(() => false);
      if (visibleTextarea || visibleField) {
        log(`フォーム発見: 現在のページにフォーム要素が存在`);
        return { success: true, currentForm: true, contactLink: "" };
      }
    }

    // ====================================
    // iframe内での探索（メインで見つからない場合）
    // ====================================

    const iframes = page.locator('iframe');
    const iframeCount = await iframes.count();

    for (let i = 0; i < iframeCount; i++) {
      const iframe = iframes.nth(i);
      try {
        const frame = page.frameLocator(`iframe:nth-of-type(${i + 1})`);
        const iframeTextareas = frame.locator('textarea');
        const iframeInputsOrSelects = frame.locator('form input, form select');
        const iframeTextareaCount = await iframeTextareas.count();
        const iframeFieldCount = await iframeInputsOrSelects.count();

        if (iframeTextareaCount > 0 || iframeFieldCount > 2) {
          const hasVisible = await iframeTextareas.first().isVisible().catch(() => false)
            || await iframeInputsOrSelects.first().isVisible().catch(() => false);
          if (hasVisible) {
            log(`フォーム発見: iframe内にフォーム要素が存在`);
            return { success: true, currentForm: true, contactLink: "" };
          }
        }
      } catch (iframeError) {
        // iframe アクセスエラーを無視
        continue;
      }
    }

    // ====================================
    // コンタクトリンクの探索
    // ====================================

    const links = page.locator('a');
    const linkCount = await links.count();

    // URL内にコンタクト関連のキーワードが含まれるリンクを探索
    const urlBasedContactLinks = [];
    for (let i = 0; i < linkCount; i++) {
      const link = links.nth(i);
      const href = await link.getAttribute('href');

      if (href && (
        href.includes('inq') ||
        href.includes('Inq') ||
        href.includes('INQ') ||
        href.includes('contact') ||
        href.includes('Contact') ||
        href.includes('CONTACT')
      )) {
        urlBasedContactLinks.push({ element: link, href });
      }
    }

    // テキスト内にコンタクト関連のキーワードが含まれるリンクを探索
    const textBasedContactLinks = [];
    for (let i = 0; i < linkCount; i++) {
      const link = links.nth(i);
      const text = await link.innerText();

      if (text && (
        text.includes('問い合') ||
        text.includes('問合') ||
        text.includes('CONTACT') ||
        text.includes('Contact')
      )) {
        textBasedContactLinks.push({ element: link, href: await link.getAttribute('href') });
      }
    }

    // 全てのコンタクトリンクを統合
    const allContactLinks = [...urlBasedContactLinks, ...textBasedContactLinks];

    // ====================================
    // コンタクトリンクの処理
    // ====================================

    if (allContactLinks.length > 0) {
      // 最後のリンクから順番にチェック（逆順でチェック）
      for (let i = allContactLinks.length - 1; i >= 0; i--) {
        const contactLink = allContactLinks[i];

        // 末尾のスラッシュを削除（URL比較のため）
        let normalizedHref = contactLink.href || '';
        if (normalizedHref.endsWith('/')) {
          normalizedHref = normalizedHref.slice(0, -1);
        }
        if (currentUrl.endsWith('/')) {
          currentUrl = currentUrl.slice(0, -1);
        }

        // 現在のURLと異なり、かつ有効なリンクを返す
        if (currentUrl !== normalizedHref) {
          // 相対パスを絶対パスに変換
          const absoluteUrl = normalizedHref.startsWith('http')
            ? normalizedHref
            : new URL(normalizedHref, currentUrl).href;

          log(`コンタクトリンク発見: ${absoluteUrl}`);
          return {
            success: true,
            currentForm: false,
            contactLink: absoluteUrl
          };
        }
      }

      // 条件に合うリンクが見つからなかった場合
      return {
        success: false,
        currentForm: false,
        contactLink: "",
        message: "contactLink.href.startsWith('http') is false"
      };
    }

    // コンタクトリンクが全く見つからなかった場合
    return {
      success: false,
      currentForm: false,
      contactLink: "",
      message: "contactLinks.length === 0"
    };

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      currentForm: false,
      contactLink: "",
      message: errorMessage
    };
  }
}

// 追加: 複数のコンタクトリンク候補を収集（末尾優先）
async function collectContactLinks(page: any): Promise<string[]> {
  try {
    const base = page.url().replace(/\/$/, '');
    const links = page.locator('a');
    const n = await links.count();
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const link = links.nth(i);
      const href = (await link.getAttribute('href')) || '';
      const text = (await link.innerText().catch(() => '')) || '';
      const isContact = /inq|contact/i.test(href) || /問い合|問合|CONTACT|Contact/.test(text);
      if (isContact) {
        const abs = href.startsWith('http') ? href : new URL(href, base).href;
        const normalized = abs.replace(/\/$/, '');
        if (normalized !== base) out.push(normalized);
      }
    }
    // 重複排除 + 末尾（より具体的リンクが多い傾向）を優先
    return Array.from(new Set(out)).reverse();
  } catch (_) {
    return [];
  }
}

// ====================================
// データ読み込み関数
// ====================================

/**
 * CSVからターゲットリストを読み込み
 * @param {string} csvPath - CSVファイルのパス
 * @returns {Promise<Target[]>} ターゲットリスト
 */
async function loadTargetsFromCsv(csvPath: string): Promise<Target[]> {
  return new Promise((resolve, reject) => {
    const targets: Target[] = [];
    fs.createReadStream(csvPath)
      .pipe(csv())
      .on('data', (data: Target) => targets.push(data))
      .on('end', () => resolve(targets))
      .on('error', (error: Error) => reject(error));
  });
}

/**
 * プロフィールを取得（常に最初のプロフィールを使用）
 * @param {Profile[]} profiles - プロフィールリスト
 * @returns {Profile | null} プロフィールオブジェクト
 */
function getSelectedProfile(profiles: Profile[]): Profile | null {
  return profiles[0] || null;
}

/**
 * タグ置換処理（salesbotから移植・強化版）
 * @param {string} message - 元のメッセージ
 * @param {Profile} profile - プロフィールデータ
 * @returns {string} 置換後のメッセージ
 */
function processTagReplacements(message: string, profile: Profile): string {
  let processedMessage = message;

  // プロフィールの主要フィールドをタグとして置換
  const replacements = {
    '{{name}}': profile.name || '',
    '{{company}}': profile.company || '',
    '{{department}}': profile.department || '',
    '{{position}}': profile.position || '',
    '{{email}}': profile.email || '',
    '{{tel}}': profile.tel || '',
    '{{fullAddress}}': profile.fullAddress || ''
  };

  // すべてのタグを置換
  for (const [tag, value] of Object.entries(replacements)) {
    processedMessage = processedMessage.replace(new RegExp(tag, 'g'), value);
  }

  return processedMessage;
}

// ====================================
// メイン関数
// ====================================

// ====================================
// ログ関数（グローバル定義・強化版）
// ====================================

const logFile = path.join(__dirname, '../logs', `run-${Date.now()}.log`);

// console.* をファイルへミラーする（重複防止のため log() はファイル追記しない）
function enableConsoleMirroring(targetFile: string) {
  try { fs.mkdirSync(path.dirname(targetFile), { recursive: true }); } catch (_) {}
  const orig = {
    log: console.log.bind(console),
    info: console.info ? console.info.bind(console) : console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  } as const;

  function writeLine(args: any[]) {
    const timestamp = new Date().toISOString();
    const line = args.map(a => {
      try { return typeof a === 'string' ? a : JSON.stringify(a); } catch { return String(a); }
    }).join(' ');
    try { fs.appendFileSync(targetFile, `[${timestamp}] ${line}\n`); } catch (_) {}
  }

  console.log = (...args: any[]) => { writeLine(args); (orig.log as any)(...args); };
  console.info = (...args: any[]) => { writeLine(args); (orig.info as any)(...args); };
  console.warn = (...args: any[]) => { writeLine(args); (orig.warn as any)(...args); };
  console.error = (...args: any[]) => { writeLine(args); (orig.error as any)(...args); };
}

enableConsoleMirroring(logFile);

function log(message: string) {
  // コンソール出力で視認性を向上（ファイル追記は console ミラーに任せる）
  if (message.includes('✅ 送信成功')) {
    console.log('\x1b[32m%s\x1b[0m', message); // 緑色
  } else if (message.includes('❌ 送信失敗')) {
    console.log('\x1b[31m%s\x1b[0m', message); // 赤色
  } else if (message.includes('ターゲット処理エラー')) {
    console.log('\x1b[33m%s\x1b[0m', message); // 黄色
  } else {
    console.log(message);
  }
}

async function main() {
  log('🚀 お問い合わせ送信プロセスを開始します...');

  try {
    // データ読み込み
    const targetsPath = path.join(__dirname, 'data', 'targets.csv');
    const profilesPath = path.join(__dirname, 'data', 'profiles.json');

    const targets: Target[] = await loadTargetsFromCsv(targetsPath);
    const profiles: Profile[] = JSON.parse(fs.readFileSync(profilesPath, 'utf-8'));

    log(`📊 ターゲット数: ${targets.length}, プロフィール数: ${profiles.length}`);

    // ブラウザ起動（アンチボット対策: UA/locale/AutomationControlled）
    const envHeadless = process.env.HEADLESS?.toLowerCase?.() || 'true';
    const headless = !(envHeadless === 'false' || envHeadless === '0' || envHeadless === 'no');
    const browser = await chromium.launch({ headless, args: ['--disable-blink-features=AutomationControlled'] });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'ja-JP',
      timezoneId: 'Asia/Tokyo'
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      try {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      } catch {}
    });

    // プロフィール選択とタグ置換（一度だけ）
    const profile = getSelectedProfile(profiles);
    if (!profile) {
      log('❌ プロフィールが選択されていません');
      await browser.close();
      return;
    }
    const processedProfile: Profile = { ...profile, message: processTagReplacements(profile.message, profile) };

    log(`👤 使用プロフィール: ${profile.name} (${profile.company})`);

    const outcomes: TargetOutcome[] = [];

    // 各ターゲットに対して処理（結果を収集し詳細ログ）
    for (const target of targets) {
      try {
        const outcome = await processTarget(page, target, processedProfile);
        outcomes.push(outcome);
      } catch (targetError) {
        const errorMessage = targetError instanceof Error ? targetError.message : String(targetError);
        log(`❌ ターゲット処理エラー (${target.url}): ${errorMessage}`);
        outcomes.push({ target, success: false, reason: 'ERR_EXCEPTION', detail: errorMessage });
      }
    }

    await browser.close();

    // 処理結果サマリー
    log('🏁 プロセス完了');
    const okCount = outcomes.filter(o => o.success).length;
    log(`📈 処理結果サマリー: 成功 ${okCount} / ${outcomes.length}`);
    // 詳細サマリ（1行/ターゲット）
    for (const o of outcomes) {
      log(`- [${o.success ? 'OK' : 'NG'}] ${o.target.url} (${o.target.企業名}) reason=${o.reason}${o.finalUrl ? ` final=${o.finalUrl}` : ''}${o.detail ? ` detail=${o.detail}` : ''}`);
    }

    // ログファイルのパスを表示
    log(`📄 詳細ログ: ${logFile}`);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`💥 エラー発生: ${errorMessage}`);
    console.error('エラー発生:', error);
  }
}

// ====================================
// ターゲット処理関数（salesbotのexecutor.jsから移植・強化版）
// ====================================

async function processTarget(page: any, target: Target, profile: Profile): Promise<TargetOutcome> {
  log(`🔄 ターゲット処理開始: ${target.url} (${target.企業名})`);

  try {
    // ページ読み込み
    await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: WAIT_TIMEOUT });
    await page.waitForTimeout(PAGE_LOAD_DELAY);

    // ====================================
    // フォーム探索（salesbotのexplore.jsから移植）
    // ====================================

    const exploreResult = await exploreForm(page);

    if (!exploreResult.success) {
      log(`❌ フォーム探索失敗: ${target.url} - ${exploreResult.message}`);
      return { target, success: false, reason: 'ERR_NO_FORM', detail: exploreResult.message };
    }

    // お断りキーワードチェック（簡易）
    const pageContent = await page.content();
    if (REFUSAL_KEYWORDS.some(keyword => pageContent.includes(keyword))) {
      log(`🚫 お断りキーワード検知: ${target.url} をスキップ`);
      return { target, success: false, reason: 'SKIP_REFUSAL' };
    }

    // ====================================
    // コンタクトリンクへの遷移が必要な場合
    // ====================================

    if (!exploreResult.currentForm && exploreResult.contactLink) {
      log(`🔗 コンタクトリンクに遷移: ${exploreResult.contactLink}`);
      await page.goto(exploreResult.contactLink, { waitUntil: 'domcontentloaded', timeout: WAIT_TIMEOUT });
      await page.waitForTimeout(PAGE_LOAD_DELAY);

      // 遷移後に再度フォーム探索
      const secondExploreResult = await exploreForm(page);
      if (!secondExploreResult.success || !secondExploreResult.currentForm) {
        // 1) 現在のコンタクトページ内の派生リンク（例: /contact_sell, /contact_rent）を順に辿る
        const currentContactUrl = page.url().replace(/\/$/, '');
        const localCandidates = (await collectContactLinks(page))
          .filter(href => href.replace(/\/$/, '') !== currentContactUrl)
          // 同一オリジン優先 + パスが長いものを優先（より具体的な派生ページを想定）
          .sort((a, b) => {
            try {
              const ua = new URL(a); const ub = new URL(b);
              const sameA = ua.origin === new URL(currentContactUrl).origin ? 1 : 0;
              const sameB = ub.origin === new URL(currentContactUrl).origin ? 1 : 0;
              if (sameA !== sameB) return sameB - sameA;
              return (ua.pathname.length - ub.pathname.length);
            } catch { return 0; }
          });

        let reachedForm = false;
        for (const href of localCandidates) {
          log(`🔁 派生コンタクトリンク遷移: ${href}`);
          try {
            await page.goto(href, { waitUntil: 'domcontentloaded', timeout: WAIT_TIMEOUT });
            await page.waitForTimeout(PAGE_LOAD_DELAY);
          } catch { continue; }
          const r = await exploreForm(page);
          if (r.success && r.currentForm) { reachedForm = true; break; }
        }

        // 2) ダメなら初めて target.url に戻って全候補を再試行
        if (!reachedForm) {
          try {
            await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: WAIT_TIMEOUT });
            await page.waitForTimeout(PAGE_LOAD_DELAY);
          } catch {}
          let candidates = await collectContactLinks(page);
          for (const href of candidates) {
            if (href === exploreResult.contactLink) continue;
            log(`🔁 代替コンタクトリンク再試行: ${href}`);
            try {
              await page.goto(href, { waitUntil: 'domcontentloaded', timeout: WAIT_TIMEOUT });
              await page.waitForTimeout(PAGE_LOAD_DELAY);
            } catch { continue; }
            const r = await exploreForm(page);
            if (r.success && r.currentForm) { reachedForm = true; break; }
          }
        }

        const finalCheck = await exploreForm(page);
        if (!reachedForm && (!finalCheck.success || !finalCheck.currentForm)) {
          log(`❌ コンタクトページでフォームが見つかりませんでした: ${exploreResult.contactLink}`);
          return { target, success: false, reason: 'ERR_CONTACT_PAGE_NO_FORM', detail: exploreResult.contactLink };
        }
      }
    }

    // ====================================
    // フォーム送信処理（salesbotのsend.jsから移植・強化版）
    // ====================================

    // ブラウザダイアログの無効化（salesbotから移植）
    await page.evaluate(() => {
      window.alert = () => {};
      window.confirm = () => true;
      window.prompt = () => null;
    });

    // フォーム入力
    await fillForm(page, profile);

    // CAPTCHA画像解決（無料オプション）- フォームドキュメント対応
    const formDocument = await findFormDocument(page);
    await detectAndSolveCaptchaImage(page, formDocument);

    // reCAPTCHA処理（無料オプション）
    await handleRecaptchaFree(page);

    // フォーム入力状態の確認（デバッグ用）
    log('フォーム入力状態を確認中...');
    const formInputs = await page.locator('input, textarea, select').evaluateAll((elements: Element[]) =>
      elements.map((el: Element) => ({
        tagName: el.tagName,
        type: (el as HTMLInputElement).type || 'N/A',
        name: (el as HTMLInputElement).name || 'N/A',
        value: (el as HTMLInputElement).value || '',
        disabled: (el as HTMLInputElement).disabled,
        visible: (el as HTMLElement).offsetParent !== null
      }))
    );

    // 必須フィールドの入力状態を確認
    const unfilledRequired = formInputs.filter((input: any) =>
      input.visible &&
      !input.disabled &&
      (input.type === 'text' || input.type === 'email' || input.type === 'tel' || input.tagName === 'TEXTAREA') &&
      input.value.trim() === ''
    );

    if (unfilledRequired.length > 0) {
      log(`警告: 未入力の必須フィールドが ${unfilledRequired.length} 個あります`);
      unfilledRequired.forEach((input: any) => {
        log(`  - ${input.tagName} (${input.type}): ${input.name}`);
      });
    }

    // 送信ボタンクリック前にボタンの状態を確認
    log('送信ボタンの状態を確認中...');
    const submitButtons = await page.locator('input[type="submit"], button[type="submit"], button, input[type="image"]').evaluateAll((buttons: Element[]) =>
      buttons.map((btn: Element) => ({
        tagName: btn.tagName,
        type: (btn as HTMLInputElement).type || 'N/A',
        disabled: (btn as HTMLInputElement).disabled,
        visible: (btn as HTMLElement).offsetParent !== null,
        text: (btn as HTMLElement).textContent?.trim() || (btn as HTMLInputElement).value || 'N/A'
      }))
    );

    const enabledButtons = submitButtons.filter((btn: any) => btn.visible && !btn.disabled);
    log(`有効な送信ボタン数: ${enabledButtons.length}`);

    if (enabledButtons.length === 0) {
      log('警告: 有効な送信ボタンが見つかりません');
      return { target, success: false, reason: 'ERR_NO_SUBMIT' };
    }

    // 送信前に人間的インタラクションを挿入（微小ランダムウェイト等）
    await simulateHumanInput(page as any);

    // 送信ボタンクリック
    log('送信ボタンをクリックします...');
    await clickSubmitButton(page);

    // 送信後のページ遷移/AJAX完了を待つ（最大10秒）
    log('送信ボタンをクリックしました。ページ遷移を待機中...');
    try {
      await Promise.race([
        page.waitForLoadState('networkidle', { timeout: 10000 }),
        page.waitForURL(/(thanks|complete|completed|done|finish|finished|sent|success|ok)/i, { timeout: 10000 }).catch(() => {}),
      ]);
    } catch {}
    await page.waitForTimeout(2000);

    // 確認画面対応（送信後の状態でチェック）
    const confirmResult = await handleConfirmationPage(page);

    // 結果ログ出力（成功/失敗の明確な表示）
    if (confirmResult.success) {
      log(`✅ 送信成功: ${target.url} (${target.企業名}) - ${confirmResult.message}`);
      return { target, success: true, reason: /成功|complete|thank|完了|ありがとう|受付|受け付け/.test(confirmResult.message) ? 'OK_SUCCESS_KEYWORD' : 'OK_CONFIRM_CLICKED', detail: confirmResult.message, finalUrl: page.url() };
    } else {
      log(`❌ 送信失敗: ${target.url} (${target.企業名}) - ${confirmResult.message}`);
      // 必須未入力の検出結果がログ済みであれば理由付与
      const failureDetail = confirmResult.message || 'unknown';
      return { target, success: false, reason: /必須|required|未入力|入力してください/.test(failureDetail) ? 'ERR_REQUIRED_UNFILLED' : 'ERR_UNKNOWN', detail: failureDetail, finalUrl: page.url() };
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`💥 ターゲット処理エラー (${target.url}): ${errorMessage}`);
    return { target, success: false, reason: 'ERR_EXCEPTION', detail: errorMessage };
  }
}

// ====================================
// スクリプト実行
// ====================================

main();


