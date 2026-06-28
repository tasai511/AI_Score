# Pending Scorebook Rules

Covered 以外のルールは、今回の内部実装対象から外す。

| ルール | 判定 | 保留理由 |
|---|---|---|
| 3アウト時の斜線と残塁 | Not Covered | 完了済み打席のスコアブック一覧、残塁記号、3アウト斜線の表示が現在UIにない |
| ストライク | Partially Covered | 見逃しと空振りを分けられない |
| バントファウル、バント空振り | Not Covered | バント入力がない |
| 振り逃げ | Partially Covered | 捕手から一塁への送球やアウト/出塁の詳細表記が不足する |
| スリーバント失敗 | Not Covered | バント入力がない |
| 故意四球 | Not Covered | 故意四球を選ぶ入力がない |
| ゴロアウト | Partially Covered | 送球経路やゴロの明示が不足する |
| 先行ランナーのフォースアウト | Partially Covered | フォースアウトや送球間の扱いが不足する |
| タッグアウト | Partially Covered | タッグした守備者とT.O表記が不足する |
| ベース踏みアウト、ベースカバーアウト | Partially Covered | A/B/Cやベースカバー選手の区別が不足する |
| フライアウト | Partially Covered | フライ記号とライナー区別が不足する |
| ライナーアウト | Not Covered | ライナー入力がない |
| ファールフライアウト | Partially Covered | 専用表記とバントフライ区別が不足する |
| 二塁打、三塁打 | Partially Covered | 長打種類、打球位置、線上/頭上の区別が不足する |
| 打点 | Not Covered | 打点入力や自動判定に必要な情報がない |
| 犠打 | Not Covered | バントや犠打の入力がない |
| 犠牲バント失敗 | Not Covered | バント入力がない |
| 内野安打（バントヒット） | Not Covered | バントだったことを入力するUIがないため、BH表記は判定できない |
| 犠飛 | Not Covered | 犠飛入力、打点、打数除外の扱いがない |
| エラー | Partially Covered | 捕球ミス、送球ミス、落球、対象守備者の詳細が不足する |
| 重盗、三重盗 | Partially Covered | DS/TPとして1つのプレーにまとめる表記が不足する |
| 盗塁刺 | Partially Covered | CS表記、送球した守備者、タッグした守備者が不足する |
| 後逸、暴投、捕逸 | Partially Covered | 暴投と捕逸の区別、後逸としてまとめる方針との整合が不足する |
| 打撃妨害 | Too Advanced | 初心者が試合中に判断するには難しい |
| 走塁妨害 | Too Advanced | 初心者向け初期版には重い |
| 守備妨害 | Too Advanced | 妨害種別、対象ランナー、アウト処理が複雑 |
| 野手選択 | Not Covered | FCを選ぶ入力がない |
| 併殺 | Partially Covered | DP表記と連続した送球経路が不足する |
| ランダウンプレー | Too Advanced | 複数送球経路、FC/エラー/帰塁の判断が重い |
| わからない入力 | Not Covered | 「？」として保持する入力とあとから修正する導線がない |
