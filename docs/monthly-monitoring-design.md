# 月次AI検索モニタリング — 将来設計（未提供）

初回診断で確定した10質問を基準線として固定し、掲載・推薦・競合・参照元の変化を時系列で確認する。初回診断とは別商品であり、現時点では申込み・請求・自動実行を実装しない。

## 想定測定

- 初回診断の確定10質問 × 3AI
- 頻度候補は週1回、月間目安は約120結果
- 質問変更は新しい基準線として扱う

## 比較項目

- 前月比の掲載回数・推薦回数・明示順位
- 月内の出現率・安定性（1回だけの掲載と継続掲載を分ける）
- 質問別・AI別の出現変化
- 新たに登場／消失した競合
- 参照ドメインと企業理解の変化
- 測定条件、モデル、地域、言語、取得時刻

独自スコアやMADOHA独自ランキングは作らず、実測値とAI回答の差分を表示する。

## データモデル案

- `monitoring_subscriptions`: diagnosis_id, baseline_version, status, cadence, timezone, next_run_at
- `monitoring_customers`: customer_id, buyer identity, contact policy
- `monitoring_targets`: target_id, customer_id, canonical identity, official domain
- `monitoring_baselines`: baseline_id, diagnosis_id, target_id, confirmed_questions_json, provider_config_json, valid_from
- `monitoring_runs`: run_id, baseline_id, period_key, started_at, completed_at, state, cost_usd, market, country, location, language
- 既存 `paid_measurements`: run_idを用いて測定保存
- `monitoring_monthly_reports`: report_id, subscription_id, period_key, aggregation_json, previous_month_comparison_json
- `monitoring_comparisons`: run_id, previous_run_id, comparison_json

各measurementでは `question_id / provider / measured_at / market / country / location / language` を明示的に保存する。日本向けでも `Japan / ja` を暗黙値だけにしない。

## 月内集計・前月比較・時系列

- 週次結果を月単位に束ね、掲載率、会社名なし掲載率、AI別掲載率、推薦率、質問別掲載率、競合登場率を集計する。
- 新規／消失競合、新規／消失参照ドメインを前月と比較する。
- 3・6・12か月のグラフ用に、月次集計値を上書きせずスナップショットとして保持する。
- run単位、customer単位、月単位の費用上限を持つ。

## 運用・メール要件

- 同意済み購入者のみ。開始・停止・質問変更を記録する。
- 月次費用上限、再試行、重複防止を診断単位で持つ。
- baseline変更前後を同じ系列として誤比較しない。
- メールは測定完了、重要な変化、処理失敗、支払い通知に限定する。
- 送信元ドメイン認証、配信停止、バウンス管理、送信履歴を用意する。
- メールには対象期間、変化の概要、認証済み結果画面リンクを記載する。

## 未決定事項

提供価格、正式な測定頻度、申込み・解約・請求方式、通知しきい値。初回診断販売後の利用意向と実原価を確認して決定する。
