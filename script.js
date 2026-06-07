import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
    getAuth,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    onAuthStateChanged,
    signOut,
    updatePassword,
    EmailAuthProvider,
    reauthenticateWithCredential
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
    getFirestore,
    doc,
    onSnapshot,
    updateDoc,
    setDoc,
    arrayUnion,
    deleteField,
    getDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ====================== FIREBASE CONFIG ======================
// !! REPLACE with your own Firebase project config !!
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    
    appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// ====================== TELEGRAM CONFIG ======================
// !! REPLACE these with your own bot token and chat ID !!
// How to get:
//   1. Create bot via @BotFather → get BOT_TOKEN
//   2. Message your bot, then visit:
//      https://api.telegram.org/bot<BOT_TOKEN>/getUpdates
//      to find your CHAT_ID


// ====================== YOUR ESEWA QR NUMBER ======================
const ESEWA_DISPLAY_NUMBER = "9827260865"; // Shown to users on payment screen

// ====================== APP INIT ======================
const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

let currentUID       = null;
let currentUserEmail = null;
let realtimeListener = null;
let purchaseData     = null;

// ====================== AUTH STATE ======================
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUID       = user.uid;
        currentUserEmail = user.email;
        document.getElementById('displayEmail').innerText = user.email || "User";
        showMainUI('storeUI');
        startSync(user.uid);
        startTime();
    } else {
        if (realtimeListener) realtimeListener();
        currentUID       = null;
        currentUserEmail = null;
        purchaseData     = null;
        showMainUI('authSection');
    }
});

// ====================== AUTH ACTIONS ======================
document.getElementById('loginBtn').onclick = async () => {
    const email = document.getElementById('loginEmail').value.trim();
    const pass  = document.getElementById('loginPass').value;
    if (!email || !pass) return showToast("Please enter email and password", "error");
    try {
        await signInWithEmailAndPassword(auth, email, pass);
    } catch (err) {
        showToast("Login Failed: " + err.message, "error");
    }
};

document.getElementById('signupBtn').onclick = async () => {
    const email = document.getElementById('regEmail').value.trim();
    const pass  = document.getElementById('regPass').value;
    if (!email || !pass) return showToast("Please fill all fields", "error");
    if (pass.length < 6) return showToast("Password must be at least 6 characters", "error");
    try {
        await createUserWithEmailAndPassword(auth, email, pass);
        showToast("Account created successfully!", "success");
    } catch (err) {
        showToast("Signup Failed: " + err.message, "error");
    }
};

window.handleLogout = () => signOut(auth);

// ====================== SIDE MENU ======================
const menuBtn     = document.getElementById('menuBtn');
const sideDrawer  = document.getElementById('sideDrawer');
const menuOverlay = document.getElementById('menuOverlay');

const toggleMenu = () => {
    const isOpen = sideDrawer.classList.toggle('active');
    menuBtn.classList.toggle('active');
    menuOverlay.style.display = isOpen ? 'block' : 'none';
};
menuBtn.onclick     = toggleMenu;
menuOverlay.onclick = toggleMenu;

function closeMenu() {
    sideDrawer.classList.remove('active');
    menuBtn.classList.remove('active');
    menuOverlay.style.display = 'none';
}

// ====================== PROFILE ======================
window.saveProfile = async () => {
    const name  = document.getElementById('profileName').value.trim();
    const phone = document.getElementById('profilePhone').value.trim();
    if (!name || !phone) return showToast("Please fill both fields", "error");
    if (!currentUID) return showToast("Not logged in", "error");
    try {
        await updateDoc(doc(db, "users", currentUID), { profileName: name, profilePhone: phone });
        showToast("Profile saved!", "success");
        closeModals();
    } catch (e) {
        showToast("Failed: " + e.message, "error");
    }
};

function loadProfileToModal(data) {
    if (data.profileName)  document.getElementById('profileName').value  = data.profileName;
    if (data.profilePhone) document.getElementById('profilePhone').value = data.profilePhone;
}

// ====================== REAL-TIME SYNC ======================
function startSync(uid) {
    const userRef = doc(db, "users", uid);
    realtimeListener = onSnapshot(userRef, (snap) => {
        if (!snap.exists()) {
            setDoc(userRef, {
                history: [],
                adminMessage: "Welcome! Pay via eSewa and submit your transaction ID to get your key 🔑",
                requestStatus: "Active"
            }, { merge: true });
            return;
        }
        const data = snap.data();

        // Status pill
        const statusEl  = document.getElementById('userStatus');
        const statusDot = document.querySelector('.status-dot');
        statusEl.innerText = data.requestStatus || "Active";
        const status = (data.requestStatus || "Active").toLowerCase();
        if      (status.includes("approved") || status === "active") statusDot.style.background = "#00e87a";
        else if (status.includes("pending"))                          statusDot.style.background = "#ffb020";
        else if (status.includes("reject") || status.includes("ban")) statusDot.style.background = "#ff3b5c";
        else                                                           statusDot.style.background = "#00e87a";

        document.getElementById('adminMsg').innerText = data.adminMessage || "No messages.";
        renderHistory(data.history || []);
        loadProfileToModal(data);

        // Check if a new key was just delivered by admin
        checkForNewKey(data.history || []);
    });
}

// Track last seen key count to detect new deliveries
let lastKeyCount = 0;
function checkForNewKey(history) {
    const keysDelivered = history.filter(h => h.key && h.status === 'SUCCESS');
    if (keysDelivered.length > lastKeyCount && lastKeyCount !== 0) {
        // New key delivered by admin!
        const newest = keysDelivered[keysDelivered.length - 1];
        showKeyDelivered(newest.key, newest.item || 'Your product');
    }
    lastKeyCount = keysDelivered.length;
}

// ====================== HISTORY ======================
function renderHistory(history) {
    const container = document.getElementById('historyList');
    if (!history || history.length === 0) {
        container.innerHTML = `<p class="empty-msg">No orders yet.</p>`;
        return;
    }
    container.innerHTML = history.slice().reverse().map(item => `
        <div class="history-item">
            <small>${item.date || ''}</small>
            <p>${item.msg || item}</p>
            ${item.status === 'PENDING_APPROVAL'
                ? `<div class="pending-badge">⏳ Waiting for admin approval</div>`
                : ''}
            ${item.key ? `
            <div class="key-display">
                <i class="fas fa-key"></i>
                <span class="key-text">${item.key}</span>
                <button class="key-copy-inline" onclick="copyKey('${item.key}')">
                    <i class="fas fa-copy"></i>
                </button>
            </div>` : ''}
        </div>
    `).join('');
}

window.confirmDeleteHistory = () => document.getElementById('deleteWarning').classList.remove('hidden');
window.hideDeleteWarning    = () => document.getElementById('deleteWarning').classList.add('hidden');

window.processHistoryDelete = async () => {
    if (!currentUID) return;
    try {
        await updateDoc(doc(db, "users", currentUID), { history: deleteField() });
        hideDeleteWarning();
        closeModals();
        showToast("History cleared!", "success");
    } catch (e) {
        showToast("Failed to clear history", "error");
    }
};

// ====================== PASSWORD UPDATE ======================
window.processPassUpdate = async () => {
    const oldP = document.getElementById('oldPass').value.trim();
    const newP = document.getElementById('newPass').value.trim();
    const user = auth.currentUser;
    if (!oldP || !newP)   return showToast("Please fill both fields", "error");
    if (newP.length < 6)  return showToast("Min 6 characters", "error");
    try {
        const credential = EmailAuthProvider.credential(user.email, oldP);
        await reauthenticateWithCredential(user, credential);
        await updatePassword(user, newP);
        showToast("Password updated!", "success");
        closeModals();
        document.getElementById('oldPass').value = '';
        document.getElementById('newPass').value = '';
    } catch (error) {
        showToast(error.code === 'auth/wrong-password' ? "Wrong current password!" : "Failed: " + error.message, "error");
    }
};

// ====================== PRODUCT SELECTION ======================
window.togglePrices = (id) => {
    const section = document.getElementById(id);
    if (!section) return;
    section.classList.toggle('hidden');
    if (navigator.vibrate) navigator.vibrate(10);
};

window.selectItem = (el, name, price) => {
    document.querySelectorAll('.price-item').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
    purchaseData = { name, price, selectedAt: new Date().toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' }) };
    const buyBtn = el.closest('.price-list').querySelector('.buy-btn');
    if (buyBtn) buyBtn.classList.remove('hidden');
    if (navigator.vibrate) navigator.vibrate(15);
};

// ====================== CHECKOUT — STEP 1 ======================
window.startCheckout = () => {
    if (!purchaseData) return showToast("Please select a product first!", "error");
    openModal('checkoutModal');

    document.getElementById('orderSummaryBox').innerHTML = `
        <span class="item-name">${purchaseData.name}</span>
        <span class="item-price">Rs ${purchaseData.price}</span>
    `;

    if (currentUID) {
        getDoc(doc(db, "users", currentUID)).then(snap => {
            if (!snap.exists()) return;
            const data = snap.data();
            if (data.profileName)  document.getElementById('payName').value = data.profileName;
            if (data.profilePhone) document.getElementById('payWA').value   = data.profilePhone;
            const note = document.getElementById('autofillNote');
            if (data.profileName || data.profilePhone) {
                note.innerHTML = '<i class="fas fa-check-circle"></i> Auto-filled from profile';
            } else {
                note.innerHTML = '<i class="fas fa-info-circle" style="color:var(--text3)"></i> <span style="color:var(--text3)">Set profile to auto-fill next time</span>';
            }
        });
    }

    showStep(1);
};

// ====================== CHECKOUT — STEP 2 (QR / Pay) ======================
window.showQR = () => {
    const name = document.getElementById('payName').value.trim();
    const wa   = document.getElementById('payWA').value.trim();
    if (!name || !wa) return showToast("Please enter your Name and WhatsApp!", "error");

    document.getElementById('esewaAmount').textContent   = `Rs ${purchaseData.price}`;
    document.getElementById('esewaMerchant').textContent = ESEWA_DISPLAY_NUMBER;

    showStep(2);

    // Countdown to unlock "I Have Paid"
    let sec = 15;
    const btn = document.getElementById('finalPayBtn');
    btn.disabled = true;
    btn.classList.add('disabled');
    document.getElementById('timerSec').innerText = sec;

    const clock = setInterval(() => {
        sec--;
        document.getElementById('timerSec').innerText = sec;
        if (sec <= 0) {
            clearInterval(clock);
            btn.disabled = false;
            btn.classList.remove('disabled');
        }
    }, 1000);
};

// ====================== CHECKOUT — STEP 3 (Submit TX) ======================
window.showVerifyStep = () => {
    document.getElementById('esewaTransCode').value = '';
    document.getElementById('esewaUserId').value    = '';

    // Pre-fill from WhatsApp field
    const waVal = document.getElementById('payWA').value.trim();
    if (waVal) document.getElementById('esewaUserId').value = waVal;

    showStep(3);
};

function showStep(n) {
    ['checkoutStep1','checkoutStep2','checkoutStep3'].forEach((id, i) => {
        document.getElementById(id).classList.toggle('hidden', i + 1 !== n);
    });
}

// ====================== SUBMIT ORDER → TELEGRAM NOTIFY ======================
window.submitOrder = async () => {
    if (!currentUID)   return showToast("Please login again.", "error");
    if (!purchaseData) return showToast("No item selected!", "error");

    const esewaId = document.getElementById('esewaUserId').value.trim();
    const txCode  = document.getElementById('esewaTransCode').value.trim().toUpperCase();

    if (!txCode)  return showToast("Enter your eSewa transaction ID!", "error");
    if (!esewaId) return showToast("Enter your eSewa ID (phone/email)!", "error");

    const submitBtn = document.getElementById('verifyPayBtn');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>SUBMITTING...</span>';

    // Check for duplicate transaction code
    try {
        const userSnap = await getDoc(doc(db, "users", currentUID));
        if (userSnap.exists()) {
            const existing = (userSnap.data().history || []);
            const duplicate = existing.some(h => h.txCode && h.txCode.toUpperCase() === txCode);
            if (duplicate) {
                showToast("This transaction ID was already submitted!", "error");
                resetSubmitBtn(submitBtn);
                return;
            }
        }
    } catch (e) { /* continue */ }

    const name   = document.getElementById('payName').value.trim();
    const waNum  = document.getElementById('payWA').value.trim();
    const date   = getDate();

    // 1. Save pending order to Firebase
    try {
        await updateDoc(doc(db, "users", currentUID), {
            requestStatus: "Key Pending",
            history: arrayUnion({
                date,
                uid:    currentUID,
                email:  currentUserEmail,
                msg:    `⏳ PENDING: ${purchaseData.name} — Rs ${purchaseData.price} — TX: ${txCode}`,
                item:   purchaseData.name,
                price:  purchaseData.price,
                txCode, esewaId,
                name,   waNum,
                status: 'PENDING_APPROVAL'
            })
        });
    } catch (e) {
        showToast("Failed to save order: " + e.message, "error");
        resetSubmitBtn(submitBtn);
        return;
    }

    // 2. Send Telegram notification to admin
    const tgMessage =
`🔔 *NEW PAYMENT RECEIVED*

🛍 *Product:* ${purchaseData.name}
💰 *Amount:* Rs ${purchaseData.price}
📋 *TX Code:* \`${txCode}\`
📱 *eSewa ID:* ${esewaId}

👤 *Customer:*
  Name: ${name}
  WhatsApp: ${waNum}
  Email: ${currentUserEmail}
  UID: \`${currentUID}\`

📅 ${date}

➡️ Go to Admin Panel to verify & deliver key.`;

    try {
        await fetch("http://localhost:3000/send-order", {
    method: "POST",
    headers: {
        "Content-Type": "application/json"
    },
    body: JSON.stringify({
        message: tgMessage
    })
});
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id:    TELEGRAM_CHAT_ID,
                text:       tgMessage,
                parse_mode: 'Markdown'
            })
        });
    } catch (e) {
        // Telegram failed but order is saved — not critical
        console.warn("Telegram notify failed:", e.message);
    }

    // 3. Show success screen
    closeModals();
    showOrderSubmitted(txCode);
    resetAfterPurchase();
};

function showOrderSubmitted(txCode) {
    const popup   = document.getElementById('autoPopup');
    const msgArea = document.getElementById('popupMsg');
    if (!popup || !msgArea) return;

    msgArea.innerHTML = `
        <div class="popup-status status-pending">⏳ ORDER SUBMITTED!</div>
        <p style="font-size:13px;margin:10px 0;color:var(--text2)">Your payment is being verified by admin.</p>
        <div style="background:#0d1220;border:1px solid #ffb02033;border-radius:8px;padding:10px;margin:10px 0;">
            <p style="font-size:11px;color:var(--text3);margin:0 0 4px 0;">TRANSACTION ID</p>
            <p style="font-size:14px;color:#ffb020;font-weight:700;margin:0;">${txCode}</p>
        </div>
        <p style="font-size:11px;color:var(--text3);margin-top:8px;">
            ✅ You'll receive your key in Order History once approved.<br>
            Usually within a few minutes during service hours (8AM–10PM).
        </p>
    `;
    popup.classList.remove('hidden');
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
}

function resetAfterPurchase() {
    purchaseData = null;
    document.querySelectorAll('.price-item').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.buy-btn').forEach(b => b.classList.add('hidden'));
    document.getElementById('payName').value = '';
    document.getElementById('payWA').value   = '';
}

function resetSubmitBtn(btn) {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-paper-plane"></i> <span>SUBMIT ORDER</span>';
}

// ====================== DATE HELPER ======================
function getDate() {
    return new Date().toLocaleString('en-US', {
        timeZone: 'Asia/Kathmandu', hour12: true,
        hour: '2-digit', minute: '2-digit',
        year: 'numeric', month: 'short', day: 'numeric'
    });
}

// ====================== UI HELPERS ======================
window.toggleAuth = (mode) => {
    document.getElementById('loginBox').classList.toggle('hidden', mode === 'signup');
    document.getElementById('signupBox').classList.toggle('hidden', mode === 'login');
};

function showMainUI(id) {
    document.getElementById('authSection').classList.add('hidden');
    document.getElementById('storeUI').classList.add('hidden');
    document.getElementById(id).classList.remove('hidden');
}

window.openModal = (id) => {
    document.getElementById('modalOverlay').classList.remove('hidden');
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('hidden');
    closeMenu();
    if (id === 'profileModal' && currentUID) {
        getDoc(doc(db, "users", currentUID)).then(snap => {
            if (snap.exists()) loadProfileToModal(snap.data());
        });
    }
};

window.closeModals = () => document.getElementById('modalOverlay').classList.add('hidden');

// ====================== LIVE CLOCK ======================
function startTime() {
    const tick = () => {
        const timeEl = document.getElementById('currentTime');
        if (timeEl) timeEl.innerText = new Date().toLocaleTimeString('en-IN');
    };
    tick();
    setInterval(tick, 1000);
}

// ====================== KEY DELIVERED POPUP ======================
function showKeyDelivered(key, productName) {
    const popup   = document.getElementById('autoPopup');
    const msgArea = document.getElementById('popupMsg');
    if (!popup || !msgArea) return;

    const safeKey = key.replace(/'/g, "\\'");
    msgArea.innerHTML = `
        <div class="popup-status status-approved">🔑 KEY DELIVERED!</div>
        <p style="font-size:12px;margin-bottom:12px;color:var(--text2)">${productName}</p>
        <div class="key-display-popup">
            <i class="fas fa-key"></i>
            <span>${key}</span>
        </div>
        <button onclick="copyKey('${safeKey}')" class="copy-key-btn">
            <i class="fas fa-copy"></i> COPY KEY
        </button>
        <p style="font-size:11px;color:var(--text3);margin-top:12px;">
            ✅ Also saved in Order History
        </p>
    `;
    popup.classList.remove('hidden');
    if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 200]);
}

window.copyKey = (key) => {
    navigator.clipboard.writeText(key)
        .then(() => showToast("Key copied! 🔑", "success"))
        .catch(() => {
            const el = document.createElement('textarea');
            el.value = key;
            document.body.appendChild(el);
            el.select();
            document.execCommand('copy');
            document.body.removeChild(el);
            showToast("Key copied!", "success");
        });
    if (navigator.vibrate) navigator.vibrate(30);
};

// ====================== TOAST ======================
function showToast(message, type = "info") {
    const existing = document.getElementById('srt-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'srt-toast';
    const color = type === 'success' ? '#00e87a' : type === 'error' ? '#ff3b5c' : '#00c8ff';
    toast.style.cssText = `
        position:fixed;bottom:32px;left:50%;
        transform:translateX(-50%) translateY(20px);
        background:#0d1220;color:${color};
        border:1px solid ${color}33;border-radius:10px;
        padding:13px 22px;font-family:'Rajdhani',sans-serif;
        font-size:14px;font-weight:600;letter-spacing:0.3px;
        z-index:9999;box-shadow:0 8px 30px rgba(0,0,0,0.5);
        max-width:320px;text-align:center;opacity:0;
        transition:all 0.3s cubic-bezier(0.4,0,0.2,1);pointer-events:none;
    `;
    toast.innerText = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
    });
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(10px)';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}
