# 習慣化ツール設計メモ

添付資料の結論と追加確認した一次情報・研究系ソースをもとに、MVPでは「気合いを増やす」よりも「開始摩擦を下げ、既存文脈に結びつけ、失敗後に戻れる」体験を優先する。

## 実装に採用した要点

1. 最小版
   - 通常版とは別に「最低これだけならできる」行動を必須入力にした。
   - 低負荷時でも記録できるよう、今日のカードに「最小版」ボタンを置いた。

2. If-Then と既存ルーティン
   - 習慣作成時に「既存ルーティン」を必須にし、「もしXならYする」という文を自動生成した。
   - 時刻だけではなく、朝食後、帰宅後、寝る準備後のような生活文脈に寄せた。

3. 自己モニタリング
   - 完了、最小版、後で、休むを1タップで記録できるようにした。
   - ローカル保存で、すぐ使えることとプライバシーを優先した。

4. 復帰導線
   - 昨日未完了または後回しだった習慣がある場合、今日のホームに「再開チケット」を出す。
   - 連続記録の喪失ではなく、ミス後の再開を評価する。

5. 週次レビュー
   - 直近7日のコンシステンシー指数、曜日別傾向、次の調整案を表示する。
   - 21日で定着のような短期前提にせず、8〜12週間の反復を前提にしている。

6. アクセシビリティ
   - スマホ幅、48px以上の主要タップ領域、色だけに依存しない状態表示を基本にした。
   - 文字サイズ拡大とダークテーマを設定に置いた。

## 追加確認した主なソース

- Lally et al. "How are habits formed: Modelling habit formation in the real world"
  - https://openresearch.surrey.ac.uk/esploro/outputs/journalArticle/How-are-habits-formed-Modelling-habit/99783513802346
- Gollwitzer & Sheeran "Implementation intentions and goal achievement"
  - https://www.socmot.uni-konstanz.de/publications/implementation-intentions-and-goal-achievement-meta-analysis-effects-and-processes
- Fogg Behavior Model
  - https://www.behaviormodel.org/
- Michie et al. "The behaviour change wheel"
  - https://pubmed.ncbi.nlm.nih.gov/21513547/
- mHealth apps and behavior change techniques engagement review
  - https://pmc.ncbi.nlm.nih.gov/articles/PMC10545861/
- Habit formation interventions and physical activity habit strength
  - https://pubmed.ncbi.nlm.nih.gov/37700303/
- Apple Human Interface Guidelines: Managing notifications
  - https://developer.apple.com/design/human-interface-guidelines/managing-notifications
- WCAG 2.2
  - https://www.w3.org/TR/WCAG22/
