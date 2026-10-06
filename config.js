// ===== 設定ファイル（基本的にここだけ書き換えます） =====
window.APP_CONFIG = {
  // Firebase コンソール → プロジェクトの設定 → 「マイアプリ（ウェブ）」の値を貼り付け
  // apiKey / databaseURL が空のままだと「デモモード」
  // （同じPC・同じブラウザのタブ同士だけで動く、お試し用）になります
  firebase: {
    apiKey: "AIzaSyCOXPvUkcdvT_du7-ChME_w4TuBBVFKq3g",
    authDomain: "nomikai-quiz-8b0d5.firebaseapp.com",
    databaseURL: "https://nomikai-quiz-8b0d5-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "nomikai-quiz-8b0d5",
    appId: "1:595615026736:web:6fd34a92fe25c5898a27f5"
  },

  ROOM_ID: "nomikai",     // 部屋名（英数字）。変えると別の部屋（別データ）になります
  ADMIN_PIN: "1234",      // 管理者PIN：開催を新しく作るとき・パスワードを忘れたときに使用
  APP_TITLE: "EGクイズアプリ" // アプリ名（開催ごとのタイトルは問題作成画面で設定）
};
