# LEARNINGS

## 2026-09-23 公開前

- viewport に `maximum-scale=1.0` と `user-scalable=no` を入れ、文書全体のダブルタップと長押しメニューを抑止した
- 描画は DOM のまま。Canvas は足していない
- 公開判定は harness の exit code と本番 URL の HTTP ステータスで行う
- harness: FAIL。Canvas なし（DOM が本体）。ダミー Canvas は置いていない。この FAIL のまま公開完了にはしない

## 2026-09-24 3Dリニューアル

- 推理のルール、得点、`tg.252.best` と `tg.252.mute`（旧 `usotsuki-best` は読み替えのみ）はそのまま
- 取調室はソフトウェア3D。内部 160×112 を整数倍表示。面はフラットシェード、色は36刻み、ディザは明度段の境界だけ
- ブラウザ（幅390×高さ844）で、キャンバス表示 320×224、描画約52fps。十字キーで選択、ウソ的中のあと犯人選択、不正解でハート減少、ポーズ、ミュートが `tg.252.mute=1` になること、次の事件へ進むことを操作して確認した。的中1件のスコアは 000201
- iPhone実機では未検証
- harness: PASS（exit 0）。Canvas 160×112、61 RAF/秒、タップ成功、コンソールエラー 0、0.04MB。レポート `docs/harness-reports/252-usotsuki-torishirabe-2026-09-24T11-57-18-873Z.md`
