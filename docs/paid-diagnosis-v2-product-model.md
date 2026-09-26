# MADOHA 初回AI検索診断 v2 — 商品仕様

## 販売モデル

1. 架空企業の完成版サンプルで納品物全体を確認する。
2. 診断対象を特定し、Question Discoveryで10質問を設計する。
3. 購入者が10質問を確認・編集・確定する。
4. 9,800円（税込・1回払い）をStripe Checkoutで支払う。
5. 署名検証済みWebhookの後だけ10質問 × 3AI = 30測定を開始する。
6. Webダッシュボード、回答・参照元の証拠一覧、PDFを納品する。
7. 完了後に月次AI検索モニタリング（準備中）を案内する。

決済前のAI API測定は0件。Identity ResolutionとQuestion DiscoveryはAI測定から分離する。

## 固定仕様

- 価格: 9,800円（税込）
- 質問: 10問
- チャネル: ChatGPT / Gemini / Google AI Mode
- 結果: 30件
- 決済: 1回払い
- 納品: Webダッシュボード、回答本文、競合、参照元、注意表示、PDF
- 公開サンプル: 完全な架空企業のみ

## セキュリティと費用管理

- TurnstileはCheckout直前で検証する。
- Checkout開始を対象単位でRate Limitする。
- Webhook署名、商品コード、金額、通貨、診断IDを検証する。
- Queueは支払い済み診断だけを処理する。
- Worker 1実行は最大3測定。D1へ逐次保存し、再開時は完了済みをskipする。
- 診断単位の費用上限を維持する。

## ファネルイベント

`identity_confirmed → diagnosis_started → questions_confirmed → checkout_started → payment_completed → measurement_started → diagnosis_completed → report_viewed → monitoring_cta_viewed`

公開サンプル閲覧は診断IDを持たないため、現行D1イベントへ無理に保存しない。将来、同意済みのサイト分析基盤を導入する場合のみ `sample_viewed` を追加する。

## 廃止する旧仕様

- 決済前の無料AI測定
- 無料測定の日次API予算、IP別測定回数、結果キャッシュ再利用
- 「無料診断」「無料9測定」「残り21測定」「4,980円」の購入者向け表現

既存の実在3社の測定結果・QA・PDFは内部検証資産として保持する。
