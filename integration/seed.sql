DELETE FROM paid_measurements;
DELETE FROM diagnosis_questions;
DELETE FROM diagnosis_orders;

INSERT INTO diagnosis_orders (id,target_url,amount_jpy,payment_status,diagnosis_status,stripe_session_id,created_at,updated_at,paid_at,pipeline_state,entity_json,locale,location)
VALUES
('a1111111-1111-4111-8111-111111111111','https://www.kyoudo.jp/',4980,'paid','paid','cs_integration_kyoudo',datetime('now'),datetime('now'),datetime('now'),'pending','{"id":"kyoudo","name":"株式会社協同住宅","official_url":"https://www.kyoudo.jp/","aliases":["協同住宅"],"category":"不動産・建築・住宅相談","mock_google_wait":true}','ja-JP','千葉県浦安市・市川市'),
('b2222222-2222-4222-8222-222222222222','https://www.kyoudo.jp/',4980,'paid','paid','cs_integration_resume',datetime('now'),datetime('now'),datetime('now'),'pending','{"id":"kyoudo","name":"株式会社協同住宅","official_url":"https://www.kyoudo.jp/","aliases":["協同住宅"],"category":"不動産・建築・住宅相談"}','ja-JP','千葉県浦安市・市川市'),
('c3333333-3333-4333-8333-333333333333','https://www.kyoudo.jp/',4980,'paid','paid','cs_integration_missing',datetime('now'),datetime('now'),datetime('now'),'pending','{"id":"kyoudo","name":"株式会社協同住宅","official_url":"https://www.kyoudo.jp/"}','ja-JP','千葉県浦安市・市川市'),
('d4444444-4444-4444-8444-444444444444','https://www.kyoudo.jp/',4980,'paid','paid','cs_integration_cost',datetime('now'),datetime('now'),datetime('now'),'pending','{"id":"kyoudo","name":"株式会社協同住宅","official_url":"https://www.kyoudo.jp/","mock_cost_usd":0.5}','ja-JP','千葉県浦安市・市川市'),
('e5555555-5555-4555-8555-555555555555','https://www.kyoudo.jp/',4980,'paid','paid','cs_integration_fatal',datetime('now'),datetime('now'),datetime('now'),'pending','{"id":"kyoudo","name":"株式会社協同住宅","official_url":"https://www.kyoudo.jp/","mock_fatal_channel":"gemini"}','ja-JP','千葉県浦安市・市川市');

INSERT INTO diagnosis_questions (diagnosis_id,question_id,question_order,question_text,intent,selection_reason,source_signals_json,question_kind,created_at) VALUES
('a1111111-1111-4111-8111-111111111111','nb-buy',1,'浦安で家を買うとき相談できる不動産会社は？','住宅購入','主要サービスと地域の利用場面から選定。','["対象企業のサービス","商圏","地域ページ","比較ページ"]','nonbrand',datetime('now')),
('a1111111-1111-4111-8111-111111111111','nb-rent',2,'浦安駅でおすすめの賃貸不動産会社は？','賃貸','浦安駅周辺の代表的な利用場面から選定。','["対象企業のサービス","商圏","関連検索"]','nonbrand',datetime('now')),
('a1111111-1111-4111-8111-111111111111','nb-build',3,'浦安で注文住宅を相談できる会社は？','注文住宅','公式サイトの建築対応から選定。','["公式サイト","対象企業のサービス","商圏"]','nonbrand',datetime('now')),
('a1111111-1111-4111-8111-111111111111','nb-renovate',4,'浦安で住宅リフォームを頼める地域密着会社は？','リフォーム','地域の建築サービス利用場面から選定。','["公式サイト","対象企業のサービス","地域ページ"]','nonbrand',datetime('now')),
('a1111111-1111-4111-8111-111111111111','nb-sell',5,'浦安市の家を売却するとき、どこへ相談すればよい？','売却','不動産売却の利用場面から選定。','["対象企業のサービス","商圏","関連検索"]','nonbrand',datetime('now')),
('a1111111-1111-4111-8111-111111111111','nb-combined',6,'中古住宅の購入とリフォームをまとめて相談できる浦安の会社は？','中古住宅＋リフォーム','不動産と建築の複合対応から選定。','["公式サイト","対象企業のサービス","比較ページ"]','nonbrand',datetime('now')),
('a1111111-1111-4111-8111-111111111111','br-company',7,'株式会社協同住宅はどんな会社？','会社理解','会社の基本情報と事業内容を確認するため。','["会社名","公式サイト","会社情報"]','branded',datetime('now')),
('a1111111-1111-4111-8111-111111111111','br-reputation',8,'株式会社協同住宅の評判や信頼性は？','評判・信頼性','第三者評価と口コミの扱いを確認するため。','["会社名","口コミ","第三者サイト"]','branded',datetime('now')),
('a1111111-1111-4111-8111-111111111111','br-strength',9,'株式会社協同住宅の強みと、相談前の注意点は？','強み・注意点','強みと不足情報を確認するため。','["会社名","公式サイト","比較ページ"]','branded',datetime('now')),
('a1111111-1111-4111-8111-111111111111','br-decision',10,'株式会社協同住宅に中古住宅の購入とリフォームを相談して大丈夫？','利用判断','利用判断に必要な情報を確認するため。','["会社名","対象企業のサービス","利用場面"]','branded',datetime('now'));

INSERT INTO diagnosis_questions SELECT 'b2222222-2222-4222-8222-222222222222',question_id,question_order,question_text,intent,selection_reason,source_signals_json,question_kind,datetime('now') FROM diagnosis_questions WHERE diagnosis_id='a1111111-1111-4111-8111-111111111111';
INSERT INTO diagnosis_questions SELECT 'd4444444-4444-4444-8444-444444444444',question_id,question_order,question_text,intent,selection_reason,source_signals_json,question_kind,datetime('now') FROM diagnosis_questions WHERE diagnosis_id='a1111111-1111-4111-8111-111111111111';
INSERT INTO diagnosis_questions SELECT 'e5555555-5555-4555-8555-555555555555',question_id,question_order,question_text,intent,selection_reason,source_signals_json,question_kind,datetime('now') FROM diagnosis_questions WHERE diagnosis_id='a1111111-1111-4111-8111-111111111111';
INSERT INTO diagnosis_questions SELECT 'c3333333-3333-4333-8333-333333333333',question_id,question_order,question_text,intent,selection_reason,source_signals_json,question_kind,datetime('now') FROM diagnosis_questions WHERE diagnosis_id='a1111111-1111-4111-8111-111111111111' AND question_order < 10;

