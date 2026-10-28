
/* Cấu hình Firebase dùng chung cho DUE Smart Locker */
const firebaseConfig = {
  apiKey: "AIzaSyB1qtSFNNFmVWAo0r0lqIU5cEfCGOKX59M",
  authDomain: "due-smart-locker.firebaseapp.com",
  projectId: "due-smart-locker",
  storageBucket: "due-smart-locker.firebasestorage.app",
  messagingSenderId: "639064006349",
  appId: "1:639064006349:web:ea10677c76872b13989384",
  measurementId: "G-078Z3QDM27"
};

// Khởi tạo Firebase một lần
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

// Dùng chung Authentication và Firestore
window.auth = firebase.auth();
window.db = firebase.firestore();

// Đăng nhập bằng MSSV hoặc email
window.loginWithFirebase = async function (identifier, password) {
  const value = String(identifier || "").trim();

  if (!value || !password) {
    throw new Error("Vui lòng nhập tài khoản và mật khẩu.");
  }

  const email = value.includes("@")
    ? value
    : `${value}@due.udn.vn`;

  const credential = await window.auth.signInWithEmailAndPassword(
    email,
    password
  );

  const token = await credential.user.getIdToken();

  return {
    user: credential.user,
    token
  };
};

// Lấy Firebase ID Token
window.getAuthToken = async function () {
  const user = window.auth.currentUser;
  return user ? await user.getIdToken() : null;
};

// Đăng xuất Firebase
window.logoutFirebase = async function () {
  await window.auth.signOut();
  sessionStorage.removeItem("due_student_user");
};
