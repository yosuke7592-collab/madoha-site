# MADOHA 9結果無料 → 完全版 販売開始チェックリスト

この文書は操作順だけを示します。秘密値はGitへ保存しません。現在のコードは販売導線を既定で無効にし、Stripe Liveキーを拒否します。

## 1. StagingでのTest Mode E2E

1. Cloudflare Turnstile Freeでstagingドメイン用widgetを作成する。
2. Stripe Test ModeでWebhook endpointを作成する。送信先は `https://<staging-host>/api/stripe/webhook`、対象イベントは `checkout.session.completed` と `checkout.session.expired`。
3. staging Workerへ次のsecretを登録する。
   - `TURNSTILE_SECRET_KEY`
   - `FREE_DIAGNOSIS_IP_HASH_SECRET`（十分に長いランダム値）
   - `STRIPE_SECRET_KEY`（`sk_test_`）
   - `STRIPE_WEBHOOK_SECRET`（`whsec_`）
   - 既存の `OPENAI_API_KEY` / `GEMINI_API_KEY` / `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD`
4. `TURNSTILE_SITE_KEY` と `PUBLIC_SITE_URL` をstagingの環境変数へ設定する。
5. staging D1へmigration `0006_free_upgrade.sql` を適用する。
6. 最初は `MADOHA_MEASUREMENT_MODE=mock`、`MADOHA_ENABLE_LIVE_MEASUREMENT=false` のまま、`MADOHA_ENABLE_SALES_FLOW=true` にしてTest Mode E2Eを行う。
7. 対象入力 → 10問 → Turnstile → 無料9結果 → Stripe Test Checkout → Webhook → 30結果 → Web/PDF保存まで確認する。
8. 終了後は `MADOHA_ENABLE_SALES_FLOW=false` へ戻す。

## 2. Productionへ進む前の承認ゲート

- production D1 / Queue bindingを既存構成へ明示する。
- production D1へmigration 0006を適用する。
- Turnstile production widgetと上記secretをproductionへ設定する。
- 無料診断の日次予算と1診断上限を最終承認する。
- `MADOHA_MEASUREMENT_MODE=live` と `MADOHA_ENABLE_LIVE_MEASUREMENT=true` は、無料実測の費用発生を承認した後だけ設定する。
- Stripe Live化は別承認とし、その時点でLiveキーを許可するコード変更、Live Webhook、実カード確認を行う。
- 一般公開は、Test Mode E2Eとlive 9測定の限定確認が完了してから行う。

## 3. 監視する値

- `free_started` → `free_completed` → `paid_cta_viewed` → `checkout_started` → `payment_completed` → `full_diagnosis_completed`
- `free_budget` の日次予約合計
- `paid_measurements` が無料9件から完全版30件になり、無料9件のmeasurement JSONが不変であること
- `diagnosis_outbox` の未送信行、`pipeline_state` の失敗・費用上限停止
