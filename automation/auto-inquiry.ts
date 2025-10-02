// お問い合わせ送信のメインスクリプト（send.jsから移植・強化版）
// 元のsalesbotのクオリティレベルに戻す

import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as csv from 'csv-parser';
import { fillForm, clickSubmitButton, handleConfirmationPage } from './dom-fill';
import { handleRecaptchaFree, detectAndSolveCaptchaImage } from './captcha-solver';

// ====================================
// 定数定義（salesbotから移植）
// ====================================

const WAIT_TIMEOUT = 15000; // 15秒
const FORM_TIMEOUT = 5000; // 5秒
const PAGE_LOAD_DELAY = 1000; // 1秒
const RECAPTCHA_WAIT = 20000; // 20秒

// 営業お断り関連キーワード
const REFUSAL_KEYWORDS = ['遠慮', '断り', '禁止', '控え', '営業権'];
const SALES_REFUSAL_KEYWORDS = ['営業', '宣伝', 'セールス', '売り込み'];

// ====================================
// データ読み込み関数
// ====================================

/**
 * CSVからターゲットリストを読み込み
 * @param {string} csvPath - CSVファイルのパス
 * @returns {Promise<any[]>} ターゲットリスト
 */
async function loadTargetsFromCsv(csvPath: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const targets = [];
    fs.createReadStream(csvPath)
      .pipe(csv())
      .on('data', (data) => targets.push(data))
      .on('end', () => resolve(targets))
      .on('error', reject);
  });
}

/**
 * プロフィールを選択（強化版）
 * @param {any[]} profiles - プロフィールリスト
 * @returns {any} 選択されたプロフィール
 */
function getSelectedProfile(profiles: any[]): any {
  // デフォルトで最初のプロフィールを使用（拡張時は選択ロジック追加）
  return profiles[0] || null;
}

/**
 * タグ置換処理（salesbotから移植）
 * @param {string} message - 元のメッセージ
 * @param {any} tags - タグデータ
 * @returns {string} 置換後のメッセージ
 */
function processTagReplacements(message: string, tags: any): string {
  let processedMessage = message;
  // タグの例: {{name}} -> 実際の値に置換（拡張時は実装）
  // ここでは簡易的にそのまま
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

    const targets = await loadTargetsFromCsv(targetsPath);
    const profiles = JSON.parse(fs.readFileSync(profilesPath, 'utf-8'));

    log(`ターゲット数: ${targets.length}, プロフィール数: ${profiles.length}`);

    // ブラウザ起動
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    // 各ターゲットに対して処理
    for (const target of targets) {
      const profile = getSelectedProfile(profiles);
      if (!profile) {
        log('プロフィールが選択されていません');
        continue;
      }

      // タグ置換
      const processedProfile = { ...profile, message: processTagReplacements(profile.message, {}) };

      await processTarget(page, target, processedProfile, log);
    }

    await browser.close();
    log('プロセス完了');
  } catch (error) {
    log(`エラー発生: ${error.message}`);
    console.error('エラー発生:', error);
  }
}

// ====================================
// ターゲット処理関数（強化版）
// ====================================

async function processTarget(page: any, target: any, profile: any, log: (message: string) => void) {
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
  } catch (error) {
    log(`ターゲット処理エラー (${target.url}): ${error.message}`);
  }
}

// ====================================
// スクリプト実行
// ====================================

main();


