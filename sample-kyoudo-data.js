globalThis.MADOHA_KYOUDO_SAMPLE = {
  "schemaVersion": "paid-report-sample-v1",
  "sample": true,
  "subject": {
    "name": "株式会社協同住宅",
    "url": "https://www.kyoudo.jp/",
    "area": "千葉県浦安市・市川市",
    "category": "不動産・建築・住宅相談"
  },
  "measurement": {
    "snapshotDate": "2026-08-24",
    "mode": "保存資料・公開検索結果をもとにした商品確認用fixture",
    "models": [
      "商品確認用fixture（本番AIモデル未実行）"
    ],
    "queryCount": 8,
    "repetitions": 1,
    "limitations": "OpenAI・Perplexity等の有料APIは実行していません。質問別の数値は完成商品の見え方を確認するためのfixtureであり、株式会社協同住宅の実測値ではありません。公式サイトと公開検索結果に基づくFACTだけを事実として表示します。"
  },
  "executiveSummary": {
    "headline": "会社名での識別材料は揃う一方、一般的な『浦安の不動産会社選び』では強みが第三者情報へ十分伝播していない",
    "currentPosition": "公式サイトから、浦安・市川の地域密着、不動産・建築・資金相談を横断する会社として理解できる材料があります。一方、第三者の比較・推薦面では掲載は確認できるものの、上位候補として選ばれる決定材料は限定的です。",
    "paidValue": "最優先はサイトの見た目だけではなく、『不動産＋建築＋資金相談』『購入後の修繕まで相談可能』を、質問に直接答えるページと第三者が引用できる根拠へ変えることです。営業開始年は社内資料で確認してから強みとして統一します。"
  },
  "facts": [
    {
      "claim": "公式サイトは浦安・市川を主な取扱エリアとしている",
      "source": "https://www.kyoudo.jp/",
      "evidence": "公式サイト本文",
      "status": "fact"
    },
    {
      "claim": "売買、賃貸、注文住宅、リフォーム、売却・賃貸活用、ローン等の相談を案内している",
      "source": "https://www.kyoudo.jp/",
      "evidence": "公式サイトのサービス案内",
      "status": "fact"
    },
    {
      "claim": "所在地は千葉県浦安市猫実1丁目9番5号、電話番号は047-352-3988と掲載されている",
      "source": "https://www.kyoudo.jp/",
      "evidence": "公式サイトの運営情報",
      "status": "fact"
    },
    {
      "claim": "宅建業免許情報を掲載する第三者ページでは免許取得日が1984年6月20日とされる",
      "source": "https://www.e-fudou.com/12/12227/21686/",
      "evidence": "国土交通省出典と記載された第三者データ",
      "status": "fact"
    },
    {
      "claim": "浦安の不動産会社一覧・地域情報ページで協同住宅の掲載を確認できる",
      "source": "https://www.shinurayasu.chiba.jp/navi/realestate/shop.html",
      "evidence": "地域事業者一覧",
      "status": "fact"
    }
  ],
  "perception": {
    "recognizedAs": [
      "浦安・市川の地域密着型不動産会社",
      "売買と賃貸に加え、注文住宅・リフォームも扱う住宅会社",
      "ローンや不動産活用まで相談できる窓口"
    ],
    "notYetClear": [
      "どの顧客課題で他社より優先して選ぶべきか",
      "施工・仲介の具体的な実績件数",
      "担当者の専門性と得意分野",
      "顧客評価を裏付ける十分な一次情報",
      "浦安の個別地域・物件種別ごとの具体的知見"
    ],
    "interpretation": "会社の業務範囲は理解しやすい一方、推薦理由となる定量実績・事例・顧客証言が弱く、AIが『選ぶ理由』を説明しにくい状態という仮説です。"
  },
  "queries": [
    {
      "intent": "指名確認",
      "query": "株式会社協同住宅はどんな会社？",
      "appeared": true,
      "recommended": true,
      "sampleAnswer": "浦安市猫実に所在し、浦安・市川を中心に売買・賃貸・建築・リフォーム等を扱う地域密着の住宅会社として回答する想定です。",
      "evidenceUrl": "https://www.kyoudo.jp/",
      "mainCompetitor": "なし（指名質問）",
      "fixtureEvidence": "公式サイト情報から事業領域と所在地を説明可能",
      "gap": "代表者・免許・実績を1ページで確認できる情報設計"
    },
    {
      "intent": "地域×売買",
      "query": "浦安で家を買うとき相談できる不動産会社",
      "appeared": true,
      "recommended": false,
      "sampleAnswer": "候補企業一覧には含まれるが、購入支援実績を比較できず、優先推薦まではしない想定です。",
      "evidenceUrl": "https://www.shinurayasu.chiba.jp/navi/realestate/shop.html",
      "mainCompetitor": "明和地所・富士屋商事",
      "fixtureEvidence": "地域一覧への掲載はあるが、推奨上位を裏付ける比較材料が限定的",
      "gap": "購入支援事例、地域別相場知識、購入者レビュー"
    },
    {
      "intent": "地域×賃貸",
      "query": "浦安駅でおすすめの賃貸不動産会社",
      "appeared": true,
      "recommended": false,
      "sampleAnswer": "地域の候補として言及される一方、駅距離・物件量・口コミ等の比較材料が少なく、上位推薦には弱い想定です。",
      "evidenceUrl": "https://hot2.jp/urayasu/shop_view.php?cid=24",
      "mainCompetitor": "富士屋商事・グランデ浦安",
      "fixtureEvidence": "おすすめ8選の一例に掲載を確認",
      "gap": "取扱物件量、駅別の強み、対応品質の客観データ"
    },
    {
      "intent": "建築",
      "query": "浦安で注文住宅を相談できる会社",
      "appeared": false,
      "recommended": false,
      "sampleAnswer": "公式サイト上の取扱いは確認できるものの、施工事例・仕様・保証を比較できず回答候補から外れる想定です。",
      "evidenceUrl": "https://www.kyoudo.jp/const/",
      "mainCompetitor": "地域工務店・住宅メーカー",
      "fixtureEvidence": "公式サイトには注文住宅があるが、第三者の推薦根拠が不足",
      "gap": "施工事例、性能仕様、設計プロセス、費用目安"
    },
    {
      "intent": "リフォーム",
      "query": "浦安で住宅リフォームを頼める地域密着会社",
      "appeared": false,
      "recommended": false,
      "sampleAnswer": "リフォーム対応の記載だけでは工事品質や得意領域を比較できず、推薦候補に残りにくい想定です。",
      "evidenceUrl": "https://www.kyoudo.jp/const/",
      "mainCompetitor": "施工事例を公開する地域会社",
      "fixtureEvidence": "サービス案内はあるが、課題別事例や成果が不足",
      "gap": "部位別事例、工期・費用、保証、顧客の声"
    },
    {
      "intent": "売却",
      "query": "浦安市の家を売却するときの相談先",
      "appeared": false,
      "recommended": false,
      "sampleAnswer": "売却相談の受付は確認できるものの、査定方針・成約実績・売却期間が不明で推薦材料が不足する想定です。",
      "evidenceUrl": "https://www.kyoudo.jp/consult/",
      "mainCompetitor": "売却実績を公開する地域仲介会社",
      "fixtureEvidence": "売る・貸す相談は明示されるが、査定や売却実績の根拠が不足",
      "gap": "売却事例、査定方針、期間、地域相場解説"
    },
    {
      "intent": "複合相談",
      "query": "中古住宅の購入とリフォームをまとめて相談できる浦安の会社",
      "appeared": true,
      "recommended": true,
      "sampleAnswer": "不動産仲介と建築・リフォームの両方を扱うため、相談先候補として推薦する想定です。",
      "evidenceUrl": "https://www.kyoudo.jp/",
      "mainCompetitor": "不動産と施工を一体提供する会社",
      "fixtureEvidence": "不動産と建築を一社で扱う点が質問意図と直接合致",
      "gap": "ワンストップ事例と担当体制の明文化"
    },
    {
      "intent": "資金相談",
      "query": "浦安で住宅ローンと物件購入を相談できる会社",
      "appeared": false,
      "recommended": false,
      "sampleAnswer": "ローン相談の案内はあるものの、担当資格・相談範囲・事例が不足し、専門相談先としては推薦しにくい想定です。",
      "evidenceUrl": "https://www.kyoudo.jp/",
      "mainCompetitor": "FP相談を明示する地域不動産会社",
      "fixtureEvidence": "資金相談の記載はあるが、専門性を示す詳細情報が不足",
      "gap": "相談範囲、資格、金融機関との関係、相談事例"
    }
  ],
  "competitors": [
    {
      "name": "株式会社富士屋商事／U-BIG24",
      "observedStrength": "浦安での長い営業実績や物件紹介量を第三者ページが具体的に訴求",
      "whyStronger": "地域×賃貸質問で引用できる定量・固有表現が多い",
      "status": "hypothesis",
      "source": "https://www.property-bank.co.jp/shop/chiba/STN6359/"
    },
    {
      "name": "株式会社明和地所",
      "observedStrength": "浦安市内の複数一覧や推薦記事で店舗名が継続的に確認される",
      "whyStronger": "第三者面での名称出現と店舗別情報の厚み",
      "status": "hypothesis",
      "source": "https://www.shinurayasu.chiba.jp/navi/realestate/shop.html"
    },
    {
      "name": "株式会社グランデ浦安",
      "observedStrength": "浦安駅周辺の比較・地域ページで事業者情報が確認される",
      "whyStronger": "駅・賃貸という具体的検索意図との結び付き",
      "status": "hypothesis",
      "source": "https://hot2.jp/urayasu/shop_view.php?cid=24"
    }
  ],
  "comparison": [
    {
      "name": "株式会社協同住宅",
      "mentions": "4 / 8",
      "recommendations": "2 / 8",
      "evidenceUrls": 5,
      "winningIntent": "指名・購入＋リフォーム",
      "confirmedDifference": "不動産と建築を横断する公式情報"
    },
    {
      "name": "株式会社富士屋商事／U-BIG24",
      "mentions": "5 / 8",
      "recommendations": "3 / 8",
      "evidenceUrls": 3,
      "winningIntent": "浦安駅・賃貸",
      "confirmedDifference": "第三者ページが浦安での営業実績と物件紹介量を具体的に説明"
    },
    {
      "name": "株式会社明和地所",
      "mentions": "5 / 8",
      "recommendations": "3 / 8",
      "evidenceUrls": 3,
      "winningIntent": "地域×売買・店舗発見",
      "confirmedDifference": "複数の地域一覧で店舗単位の掲載を確認"
    },
    {
      "name": "株式会社グランデ浦安",
      "mentions": "3 / 8",
      "recommendations": "2 / 8",
      "evidenceUrls": 2,
      "winningIntent": "浦安駅・賃貸",
      "confirmedDifference": "駅周辺の比較ページで事業者情報が確認される"
    }
  ],
  "sources": [
    {
      "name": "協同住宅公式サイト",
      "type": "official",
      "role": "会社情報・サービス範囲の一次情報",
      "url": "https://www.kyoudo.jp/",
      "priority": "維持・強化"
    },
    {
      "name": "不動産ドットコム",
      "type": "license/directory",
      "role": "免許・所在地・営業年数等の第三者確認",
      "url": "https://www.e-fudou.com/12/12227/21686/",
      "priority": "情報整合性を監視"
    },
    {
      "name": "新浦安ナビ 不動産屋一覧",
      "type": "local directory",
      "role": "浦安市の事業者候補としての発見",
      "url": "https://www.shinurayasu.chiba.jp/navi/realestate/shop.html",
      "priority": "掲載情報を充実"
    },
    {
      "name": "HOT2 浦安駅おすすめ8選",
      "type": "comparison",
      "role": "賃貸会社を比較する文脈での候補化",
      "url": "https://hot2.jp/urayasu/shop_view.php?cid=24",
      "priority": "紹介内容の正確性を確認"
    },
    {
      "name": "浦安専門ドットコム",
      "type": "local directory",
      "role": "地域カテゴリ上の存在確認",
      "url": "https://urayasu-senmon.com/shops/soudan/fudousan.html",
      "priority": "NAP整合性を維持"
    }
  ],
  "issues": [
    {
      "type": "potential_misinformation",
      "severity": "high",
      "fact": "第三者の宅建免許情報では免許取得日が1984年6月20日とされる。これは法人創立日や浦安での営業開始日を直接証明しない",
      "observed": "公式サイトトップには『地元浦安で建築・不動産業を営んで32年』という表現が残る",
      "impact": "基準年が不明なため、AIが営業年数について異なる数字を回答する可能性",
      "action": "登記・免許・社内沿革で創立日と営業開始日を確認後、https://www.kyoudo.jp/ の年数表現を確認済みの固定年月へ統一",
      "evidenceUrl": "https://www.kyoudo.jp/",
      "checkedAt": "2026-08-24"
    },
    {
      "type": "information_gap",
      "severity": "high",
      "fact": "不動産と建築を横断するサービスを掲げる",
      "observed": "確認したトップページ上ではワンストップで解決した具体事例を確認できない",
      "impact": "差別化要因が一般的なサービス列挙として処理される",
      "action": "https://www.kyoudo.jp/ から購入＋リフォーム、売却＋住み替え等の事例ページへ導線を追加",
      "evidenceUrl": "https://www.kyoudo.jp/",
      "checkedAt": "2026-08-24"
    },
    {
      "type": "information_gap",
      "severity": "medium",
      "fact": "注文住宅・リフォームを扱う",
      "observed": "費用目安、仕様、保証、工程、事例の要約がトップページから把握しにくい",
      "impact": "建築系の質問で推薦根拠が不足",
      "action": "https://www.kyoudo.jp/const/ にFAQ・実績・プロセスを追加",
      "evidenceUrl": "https://www.kyoudo.jp/const/",
      "checkedAt": "2026-08-24"
    },
    {
      "type": "evidence_gap",
      "severity": "medium",
      "fact": "地域密着を訴求する",
      "observed": "確認したトップページでは町別の相場・暮らし情報が推薦理由として整理されていない",
      "impact": "大手との差を説明しづらい",
      "action": "https://www.kyoudo.jp/ 配下に猫実・北栄・新浦安等の地域別ガイドを公開",
      "evidenceUrl": "https://www.kyoudo.jp/",
      "checkedAt": "2026-08-24"
    }
  ],
  "actions": [
    {
      "priority": 1,
      "horizon": "7日",
      "type": "FACT FIX",
      "target": "公式サイト全体・会社概要",
      "change": "登記・免許・社内沿革で法人創立日と浦安での営業開始日を確認し、『32年』等の表現を確認済みの固定年月へ統一。住所・電話・免許・代表者・営業時間も単一ページに集約",
      "reason": "免許取得日と創立日を混同せず、誤情報リスクを即時に減らす",
      "expectedChange": "指名質問で基準年月・所在地・電話の回答一致率を100%へ近づける",
      "verification": "会社名質問3回で確認済み基準年月・所在地・電話の一致を確認"
    },
    {
      "priority": 2,
      "horizon": "30日",
      "type": "EVIDENCE",
      "target": "新規：ワンストップ事例ページ3件",
      "change": "購入＋リフォーム、住み替え＋売却、土地＋注文住宅の実例を、課題・提案・結果・地域・担当範囲付きで公開",
      "reason": "不動産＋建築という最大の差別化を推薦根拠へ変える",
      "expectedChange": "複合相談質問の推薦回数増加",
      "verification": "複合相談2質問×3回で出現率・推薦率を比較"
    },
    {
      "priority": 3,
      "horizon": "30日",
      "type": "ANSWER CONTENT",
      "target": "売買・賃貸・建築・リフォーム・売却ページ",
      "change": "各ページに対象顧客、対応地域、費用の考え方、期間、流れ、保証、FAQを追加しFAQPage等を適切に構造化",
      "reason": "質問意図に対する直接回答を増やす",
      "expectedChange": "非指名質問で公式サイトが参照される範囲の拡大",
      "verification": "6意図の引用URLと回答内容を再測定"
    },
    {
      "priority": 4,
      "horizon": "60日",
      "type": "LOCAL AUTHORITY",
      "target": "浦安地域ガイド",
      "change": "地域ごとの住環境、住宅種別、災害情報の読み方、購入・賃貸時の注意点を担当者監修で公開",
      "reason": "地域密着を宣言ではなく固有知識で証明する",
      "expectedChange": "浦安×悩み質問での言及・引用増加",
      "verification": "地域別3質問×3回で競合との出現差を比較"
    },
    {
      "priority": 5,
      "horizon": "90日",
      "type": "THIRD-PARTY",
      "target": "地域ディレクトリ・顧客レビュー・業界団体プロフィール",
      "change": "NAPと事業説明を統一し、実顧客へ事実に基づくレビュー投稿を依頼。比較サイトには最新の強みと対応領域を提供",
      "reason": "公式サイト外に独立した推薦根拠を増やす",
      "expectedChange": "第三者情報源の種類と推薦根拠の増加",
      "verification": "引用ドメイン数、第三者引用率、情報不一致件数を比較"
    }
  ],
  "baseline": {
    "id": "kyoudo-fixture-2026-08-24-v1",
    "metrics": [
      {
        "name": "質問カバレッジ",
        "value": "4 / 8",
        "definition": "対象企業が回答内に出現したfixture質問数"
      },
      {
        "name": "推薦カバレッジ",
        "value": "2 / 8",
        "definition": "明示的な選択肢として扱われたfixture質問数"
      },
      {
        "name": "非指名質問の出現",
        "value": "3 / 7",
        "definition": "会社名を含まないfixture質問での出現数"
      },
      {
        "name": "確認情報源",
        "value": "5 domains",
        "definition": "本サンプルで根拠として確認した公開ドメイン数"
      },
      {
        "name": "重大な情報不一致候補",
        "value": "1",
        "definition": "購入判断・企業認識に影響し得る年数表現の不一致"
      }
    ],
    "remeasurement": "本番では上記8質問を各3回、同じAIモデル・日本語・浦安市の利用者という条件で測定し、回答全文・引用URL・成功/失敗・モデル版を保存します。30〜60日後に出現率、推薦率、引用URL、事実一致率、競合差を比較し、施策との因果は断定しません。",
    "fixedConditions": [
      "質問文8件を固定",
      "各質問3反復",
      "日本語・浦安市で住宅サービスを探す利用者",
      "モデル名・版・測定日時を保存",
      "回答全文と引用URLを保存",
      "失敗回答も分母に含め別記"
    ],
    "targets": [
      "建築質問：出現0/3 → 2/3",
      "リフォーム質問：出現0/3 → 2/3",
      "非指名推薦：現状想定1/7 → 3/7",
      "重大な情報不一致：1件 → 0件",
      "第三者根拠ドメイン：5 → 8"
    ]
  }
};
