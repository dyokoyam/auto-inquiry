# 🚀 お問い合わせ送信自動化ツール

Chrome Extensionから抽出されたお問い合わせフォーム送信機能を、Node.js + Playwrightでバックグラウンド自動実行するツールです。GitHub Actionsで定期スケジュール化可能。

## 概要

このツールは、Chrome Extensionから抽出されたお問い合わせフォーム送信機能を、Node.jsとPlaywrightでバックグラウンド自動実行するものです。ターゲットURLリストからフォームを自動探索・入力・送信し、CAPTCHA対応も可能です。GitHub Actionsで定期スケジュール化して運用できます。

## 主な機能

- **フォーム自動探索**: URLリストに基づき、お問い合わせフォーム（textarea）を自動探索。コンタクトリンクも検知して遷移。
- **高度なDOMヒューリスティクス**: ラベルテキストとフィールド名から適切な値を自動入力（salesbotのFIELD_KEYWORDSを基に）。
- **iframe対応**: iframe内にあるフォームも自動検知して処理。
- **無料CAPTCHA解決**: Tesseract.jsを使った画像認識でCAPTCHAを自動解決（精度はサイトによる）。
- **確認画面対応**: 送信後の確認ページを自動処理。
- **タグ置換処理**: メッセージ内のタグをプロフィール値に置換。
- **お断りキーワード検知**: ページ内容から営業拒否キーワードを検知してスキップ。
- **スケジュール実行**: GitHub Actionsでcronジョブとして定期実行。
- **詳細ログ出力**: logs/ディレクトリに実行ログを記録。

## 実装詳細

このツールは、Chrome Extensionの`salesbot`から以下の機能を移植・強化して実装されています：

- **explore.js**: フォーム（textarea）とコンタクトリンクの自動探索機能
- **send.js**: フォーム入力・送信・確認画面処理機能
- **executor.js**: URLナビゲーションと全体の実行フロー制御機能

これにより、元の`salesbot`と全く同じ機能と成功率を維持しています。

## 必要要件

- Node.js 18以上
- npmまたはyarn
- GitHubリポジトリ（GitHub Actions使用時）

## セットアップ

1. **依存関係のインストール**:
   ```bash
   npm install
   ```
   - Playwright、csv-parser、tesseract.jsがインストールされます。

2. **Playwrightブラウザのインストール**:
   ```bash
   npx playwright install
   ```

3. **データファイルの編集**:
   - `automation/data/targets.csv`: ターゲットURLリストを編集（企業名,url形式）。すべてのターゲットに対して同じプロフィールを使用。
   - `automation/data/profiles.json`: 送信プロフィール（名前、会社、メール、電話、住所、メッセージなど）を編集。タグ置換（{{name}}など）対応。

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
- **CAPTCHA解決**: 無料のTesseract.jsを使った画像認識で解決しますが、精度が低い場合があります。複雑なCAPTCHAは手動対応を推奨。
- **エラー対応**: サイトの変更で動作しなくなる可能性あり。定期的にテスト実行を推奨。
- **責任**: ツールの使用による損害は自己責任でお願いします。

## カスタマイズ

- **ターゲット追加**: `targets.csv`に新しいURLを追加。
- **プロフィール変更**: `profiles.json`で送信データをカスタマイズ。
- **スケジュール調整**: `.github/workflows/scheduled-run.yml`のcronを変更。

## トラブルシューティング

- **依存関係エラー**: `npm ci`でクリーンインストールを試す。
- **Playwrightエラー**: `npx playwright install --force`でブラウザを再インストール。
- **CAPTCHA解決失敗**: Tesseract.jsの精度が低い場合、手動でCAPTCHAを解決するか、サイトのCAPTCHAタイプを確認。
- **フォーム入力失敗**: サイトのフォーム構造が変更された場合、dom-fill.tsのセレクタを調整。

## 開発

- TypeScriptで記述。ビルドは`npm run build`。
- テストはPlaywrightで実施。