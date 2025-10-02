// お問い合わせ送信のメインスクリプト（send.jsから移植・強化版）
import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import csv from 'csv-parser';
import { fillForm, clickSubmitButton, handleConfirmationPage } from './dom-fill';
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

// ====================================
// 定数定義（salesbotから移植・最適化）
// ====================================

const WAIT_TIMEOUT = 15000; // 15秒
const PAGE_LOAD_DELAY = 1000; // 1秒

// 営業お断り関連キーワード（使用頻度が高いもののみ）
const REFUSAL_KEYWORDS = ['遠慮', '断り', '禁止', '控え', '営業権'];

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

async function main() {
  const logFile = path.join(__dirname, '../logs', `run-${Date.now()}.log`);
  function log(message: string) {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logFile, `[${timestamp}] ${message}\n`);
    console.log(message);
  }

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
        await processTarget(page, target, processedProfile, log);
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
// ターゲット処理関数（強化版）
// ====================================

async function processTarget(page: any, target: Target, profile: Profile, log: (message: string) => void) {
  log(`ターゲット処理中: ${target.url} (${target.企業名})`);

  try {
    // ページ読み込み
    await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: WAIT_TIMEOUT });
    await page.waitForTimeout(PAGE_LOAD_DELAY);

    // ブラウザダイアログの無効化（salesbotから移植）
    await page.evaluate(() => {
      window.alert = () => {};
      window.confirm = () => true;
      window.prompt = () => null;
    });

    // お断りキーワードチェック（簡易）
    const pageContent = await page.content();
    if (REFUSAL_KEYWORDS.some(keyword => pageContent.includes(keyword))) {
      log(`お断りキーワード検知: ${target.url} をスキップ`);
      return;
    }

    // フォーム入力
    await fillForm(page, profile);

    // CAPTCHA画像解決（無料オプション）
    await detectAndSolveCaptchaImage(page);

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


