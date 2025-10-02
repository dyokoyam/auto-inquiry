# 🚀 お問い合わせ送信自動化ツール

Chrome Extensionから抽出されたお問い合わせフォーム送信機能を、Node.js + Playwrightでバックグラウンド自動実行するツールです。GitHub Actionsで定期スケジュール化可能。

## 概要

このツールは、Chrome Extensionから抽出されたお問い合わせフォーム送信機能を、Node.jsとPlaywrightでバックグラウンド自動実行するものです。ターゲットURLリストからフォームを自動探索・入力・送信し、CAPTCHA対応も可能です。GitHub Actionsで定期スケジュール化して運用できます。

## 主な機能

- **自動フォーム送信**: URLリストに基づき、お問い合わせフォームを自動入力・送信。
- **DOMヒューリスティクス**: フォーム要素の優先順位（textarea優先、ラベルキーワードなど）で入力。
- **スケジュール実行**: GitHub Actionsでcronジョブとして定期実行。
- **エラーハンドリング**: タイムアウト、失敗時のログ出力とリトライ。

## 必要要件

- Node.js 18以上
- npmまたはyarn
- GitHubリポジトリ（GitHub Actions使用時）

## セットアップ

1. **依存関係のインストール**:
   ```bash
   npm install
   ```

2. **Playwrightブラウザのインストール**:
   ```bash
   npx playwright install
   ```

3. **データファイルの編集**:
   - `automation/data/targets.csv`: ターゲットURLリストを編集。
   - `automation/data/profiles.json`: 送信プロフィール（名前、メールなど）を編集。

## 使い方

1. **ローカル実行**:
   ```bash
   npm start
   ```
   - 指定されたターゲットURLに対してフォーム送信を実行。

2. **GitHub Actionsで定期実行**:
   - リポジトリにプッシュ後、自動でスケジュール実行（毎日午前9時）。
   - 環境変数（SUPABASE_URLなど）はGitHub Secretsで設定。

3. **テスト実行**:
   ```bash
   npm test
   ```
   - Playwrightテストでシナリオ検証。

## ファイル構成

```
Sales_Bot/auto-inquiry/
├── automation/
│   ├── auto-inquiry.ts          # メインスクリプト（フォーム送信処理）
│   ├── dom-fill.ts              # DOM操作のヒューリスティクス
│   └── data/
│       ├── targets.csv          # ターゲットURLリスト（CSV形式）
│       └── profiles.json        # 送信プロフィールデータ
├── .github/workflows/
│   └── scheduled-run.yml        # GitHub Actionsワークフロー
├── .gitignore                   # 無視ファイル設定
├── logs/                        # ログ出力ディレクトリ
├── package.json                 # 依存関係とスクリプト
├── tsconfig.json                # TypeScript設定
└── README.md                    # このファイル
```

## 注意事項

- **コンプライアンス**: 各ウェブサイトの利用規約を遵守してください。スパム行為は避け、適切な頻度で使用。
- **エラー対応**: サイトの変更で動作しなくなる可能性あり。定期的にテスト実行を推奨。
- **責任**: ツールの使用による損害は自己責任でお願いします。

## カスタマイズ

- **ターゲット追加**: `targets.csv`に新しいURLを追加。
- **プロフィール変更**: `profiles.json`で送信データをカスタマイズ。
- **スケジュール調整**: `.github/workflows/scheduled-run.yml`のcronを変更。

## トラブルシューティング

- **依存関係エラー**: `npm ci`でクリーンインストールを試す。
- **Playwrightエラー**: `npx playwright install --force`でブラウザを再インストール。
- **CAPTCHA失敗**: APIキーを確認し、サイトのCAPTCHAタイプに合わせて調整。

## 開発

- TypeScriptで記述。ビルドは`npm run build`。
- テストはPlaywrightで実施。