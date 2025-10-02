// お問い合わせ送信のメインスクリプト（send.jsから移植）
// 段階的に最適化

import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

// データファイルのパス
const targetsPath = path.join(__dirname, 'data', 'targets.json');
const profilesPath = path.join(__dirname, 'data', 'profiles.json');

// メイン関数
async function main() {
  console.log('お問い合わせ送信プロセスを開始します...');

  try {
    // データ読み込み
    const targets = JSON.parse(fs.readFileSync(targetsPath, 'utf-8'));
    const profiles = JSON.parse(fs.readFileSync(profilesPath, 'utf-8'));

    // ブラウザ起動
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    // 各ターゲットに対して処理
    for (const target of targets) {
      const profile = profiles[0]; // 例: 最初のプロフィールを使用
      await processTarget(page, target, profile);
    }

    await browser.close();
    console.log('プロセス完了');
  } catch (error) {
    console.error('エラー発生:', error);
  }
}

// ターゲット処理関数（send.jsから移植）
async function processTarget(page: any, target: any, profile: any) {
  console.log(`ターゲット処理中: ${target.url}`);

  try {
    await page.goto(target.url, { waitUntil: 'domcontentloaded' });

    // DOM操作（dom-fill.tsから呼び出し）
    await fillForm(page, profile);

    // 送信
    await page.click('input[type="submit"], button[type="submit"]');

    // 確認画面対応（簡易）
    await page.waitForTimeout(2000);
  } catch (error) {
    console.error(`ターゲット処理エラー (${target.url}):`, error);
  }
}

// フォーム入力関数（後でdom-fill.tsに移動）
async function fillForm(page: any, profile: any) {
  // 基本的な入力（最適化後、ヒューリスティクスを追加）
  await page.fill('input[name="name"], input[name="company"]', profile.name);
  await page.fill('input[name="email"]', profile.email);
  // 追加フィールドは後で最適化
}

// スクリプト実行
main();

