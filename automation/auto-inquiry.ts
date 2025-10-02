// お問い合わせ送信のメインスクリプト（salesbotのexplore.jsとsend.jsから移植・強化版）
import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import csv from 'csv-parser';
import { fillForm, clickSubmitButton, handleConfirmationPage, findFormDocument } from './dom-fill';
import { handleRecaptchaFree, detectAndSolveCaptchaImage } from './captcha-solver';

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
    // メインドキュメントでtextarea探索
    // ====================================

    const textareas = page.locator('textarea');
    const textareaCount = await textareas.count();

    if (textareaCount > 0) {
      // 表示されているtextareaのみをチェック
      for (let i = 0; i < textareaCount; i++) {
        const textarea = textareas.nth(i);
        const isVisible = await textarea.isVisible();
        if (isVisible) {
          log(`フォーム発見: 現在のページにtextareaが存在`);
          return {
            success: true,
            currentForm: true,
            contactLink: ""
          };
        }
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
        const iframeTextareaCount = await iframeTextareas.count();

        if (iframeTextareaCount > 0) {
          log(`フォーム発見: iframe内にtextareaが存在`);
          return {
            success: true,
            currentForm: true,
            contactLink: ""
          };
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

        // 現在のURLと異なり、かつHTTPで始まるリンクを返す
        if (currentUrl !== normalizedHref && normalizedHref.startsWith('http')) {
          log(`コンタクトリンク発見: ${normalizedHref}`);
          return {
            success: true,
            currentForm: false,
            contactLink: normalizedHref
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
// ログ関数（グローバル定義）
// ====================================

const logFile = path.join(__dirname, '../logs', `run-${Date.now()}.log`);
function log(message: string) {
  const timestamp = new Date().toISOString();
  try {
    fs.appendFileSync(logFile, `[${timestamp}] ${message}\n`);
  } catch (error) {
    // ログファイル書き込みエラー時はコンソールのみ出力
    console.error('ログ書き込みエラー:', error);
  }
  console.log(message);
}

async function main() {
  log('お問い合わせ送信プロセスを開始します...');

  try {
    // データ読み込み
    const targetsPath = path.join(__dirname, 'data', 'targets.csv');
    const profilesPath = path.join(__dirname, 'data', 'profiles.json');

    const targets: Target[] = await loadTargetsFromCsv(targetsPath);
    const profiles: Profile[] = JSON.parse(fs.readFileSync(profilesPath, 'utf-8'));

    log(`ターゲット数: ${targets.length}, プロフィール数: ${profiles.length}`);

    // ブラウザ起動
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    // プロフィール選択とタグ置換（一度だけ）
    const profile = getSelectedProfile(profiles);
    if (!profile) {
      log('プロフィールが選択されていません');
      await browser.close();
      return;
    }
    const processedProfile: Profile = { ...profile, message: processTagReplacements(profile.message, profile) };

    // 各ターゲットに対して処理（最適化: エラーハンドリング強化）
    for (const target of targets) {
      try {
        await processTarget(page, target, processedProfile);
      } catch (targetError) {
        const errorMessage = targetError instanceof Error ? targetError.message : String(targetError);
        log(`ターゲット処理エラー (${target.url}): ${errorMessage}`);
      }
    }

    await browser.close();
    log('プロセス完了');
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`エラー発生: ${errorMessage}`);
    console.error('エラー発生:', error);
  }
}

// ====================================
// ターゲット処理関数（salesbotのexecutor.jsから移植・強化版）
// ====================================

async function processTarget(page: any, target: Target, profile: Profile) {
  log(`ターゲット処理中: ${target.url} (${target.企業名})`);

  try {
    // ページ読み込み
    await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: WAIT_TIMEOUT });
    await page.waitForTimeout(PAGE_LOAD_DELAY);

    // ====================================
    // フォーム探索（salesbotのexplore.jsから移植）
    // ====================================

    const exploreResult = await exploreForm(page);

    if (!exploreResult.success) {
      log(`フォーム探索失敗: ${target.url} - ${exploreResult.message}`);
      return;
    }

    // お断りキーワードチェック（簡易）
    const pageContent = await page.content();
    if (REFUSAL_KEYWORDS.some(keyword => pageContent.includes(keyword))) {
      log(`お断りキーワード検知: ${target.url} をスキップ`);
      return;
    }

    // ====================================
    // コンタクトリンクへの遷移が必要な場合
    // ====================================

    if (!exploreResult.currentForm && exploreResult.contactLink) {
      log(`コンタクトリンクに遷移: ${exploreResult.contactLink}`);
      await page.goto(exploreResult.contactLink, { waitUntil: 'domcontentloaded', timeout: WAIT_TIMEOUT });
      await page.waitForTimeout(PAGE_LOAD_DELAY);

      // 遷移後に再度フォーム探索
      const secondExploreResult = await exploreForm(page);
      if (!secondExploreResult.success || !secondExploreResult.currentForm) {
        log(`コンタクトページでフォームが見つかりませんでした: ${exploreResult.contactLink}`);
        return;
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

    // 送信ボタンクリック
    await clickSubmitButton(page);

    // 確認画面対応
    await handleConfirmationPage(page);

    log(`ターゲット処理完了: ${target.url}`);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`ターゲット処理エラー (${target.url}): ${errorMessage}`);
  }
}

// ====================================
// スクリプト実行
// ====================================

main();


