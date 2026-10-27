// Cấu hình Firebase chính xác của dự án DUE Smart Locker
const firebaseConfig = {
  apiKey: "AIzaSyB1qtSFNNFmVWAo0r0lqIU5cEfCGOKX59M",
  authDomain: "due-smart-locker.firebaseapp.com",
  projectId: "due-smart-locker",
  storageBucket: "due-smart-locker.firebasestorage.app",
  messagingSenderId: "639064006349",
  appId: "1:639064006349:web:ea10677c76872b13989384",
  measurementId: "G-078Z3QDM27"
};

// 1. Khởi tạo Firebase App nếu chưa có
if (!firebase.apps || !firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

// 2. Khởi tạo dịch vụ Authentication
const auth = firebase.auth();

// 3. Hàm đăng nhập đa năng (Nhập MSSV hoặc Email đều được)
async function loginWithFirebase(identifier, password) {
  let email = identifier.trim();
  // Nếu sinh viên chỉ nhập MSSV số, tự động gắn thêm đuôi trường
  if (!email.includes("@")) {
    email = `${email}@due.udn.vn`;
  }
  
  const userCredential = await auth.signInWithEmailAndPassword(email, password);
  const token = await userCredential.user.getIdToken();
  return {
    user: userCredential.user,
    token: token
  };
}

// 4. Hàm lấy Token ID hiện tại để gửi kèm request lên backend FastAPI
async function getAuthToken() {
  const user = auth.currentUser;
  if (user) {
    return await user.getIdToken();
  }
  return null;
}

// 5. Hàm đăng xuất an toàn
async function logoutFirebase() {
  await auth.signOut();
  sessionStorage.clear();
}