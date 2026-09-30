/**
 * InstaGo Real-time Reactive Chat Engine
 * High-performance WebSocket messenger with reactive state management.
 */

// ==========================================================================
// REACTIVE APP STATE
// ==========================================================================
const state = {
    socket: null,
    currentUser: localStorage.getItem("instaGo_username") || "",
    activeRecipient: localStorage.getItem("instaGo_activeRecipient") || "",
    connectionStatus: "disconnected", // "disconnected" | "connecting" | "connected" | "reconnecting"
    reconnectAttempts: 0,
    reconnectTimer: null,
    contacts: JSON.parse(localStorage.getItem("instaGo_contacts") || "[]"),
    messages: {}, // { [username]: [ { id, from, to, message, timestamp, isMine, status } ] }
    soundEnabled: localStorage.getItem("instaGo_sound") !== "false",
    isUserDrawerOpen: false,
    searchContactTerm: "",
    searchMessageTerm: "",
    isScrolledUp: false,
    unreadWhileScrolled: 0,
    audioCtx: null
};

// ==========================================================================
// AUDIO SYNTHESIS (Zero External Asset Dependency)
// ==========================================================================
function getAudioContext() {
    if (!state.audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
            state.audioCtx = new AudioContext();
        }
    }
    if (state.audioCtx && state.audioCtx.state === "suspended") {
        state.audioCtx.resume();
    }
    return state.audioCtx;
}

function playSound(type) {
    if (!state.soundEnabled) return;
    try {
        const ctx = getAudioContext();
        if (!ctx) return;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        const now = ctx.currentTime;

        if (type === "send") {
            // Gentle high pop
            osc.type = "sine";
            osc.frequency.setValueAtTime(580, now);
            osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);
            gain.gain.setValueAtTime(0.12, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
            osc.start(now);
            osc.stop(now + 0.08);
        } else if (type === "receive") {
            // Pleasant double chime
            osc.type = "sine";
            osc.frequency.setValueAtTime(523.25, now); // C5
            osc.frequency.setValueAtTime(659.25, now + 0.06); // E5
            gain.gain.setValueAtTime(0.14, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
            osc.start(now);
            osc.stop(now + 0.16);
        } else if (type === "notify") {
            // Soft alert tone
            osc.type = "triangle";
            osc.frequency.setValueAtTime(440, now);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
            osc.start(now);
            osc.stop(now + 0.2);
        }
    } catch (e) {
        console.warn("Audio playback disabled or blocked by browser:", e);
    }
}

// ==========================================================================
// COLOR & AVATAR GENERATION
// ==========================================================================
const AVATAR_PALETTE = [
    "#2563eb", // blue
    "#0d9488", // teal
    "#7c3aed", // violet
    "#d97706", // amber
    "#059669", // emerald
    "#e11d48", // rose
    "#4f46e5", // indigo
    "#0284c7", // sky
    "#9333ea", // purple
    "#475569"  // slate
];

function getAvatarGradient(name) {
    if (!name) return "#475569";
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const idx = Math.abs(hash) % AVATAR_PALETTE.length;
    return AVATAR_PALETTE[idx];
}

function getInitials(name) {
    if (!name) return "?";
    return name.slice(0, 2).toUpperCase();
}

// ==========================================================================
// DATE & TIME FORMATTERS
// ==========================================================================
function formatTime(dateObj) {
    const d = new Date(dateObj);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatRelativeTime(dateObj) {
    const d = new Date(dateObj);
    if (isNaN(d.getTime())) return "";
    const now = new Date();
    const diffSec = Math.floor((now - d) / 1000);

    if (diffSec < 60) return "Just now";
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return formatTime(d);
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatDateHeader(dateObj) {
    const d = new Date(dateObj);
    if (isNaN(d.getTime())) return "Today";
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    if (d.toDateString() === now.toDateString()) {
        return "Today";
    }
    if (d.toDateString() === yesterday.toDateString()) {
        return "Yesterday";
    }
    return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

// ==========================================================================
// TOAST NOTIFICATIONS
// ==========================================================================
function showToast(message, type = "info") {
    const container = document.getElementById("toastContainer");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;

    let icon = "ℹ️";
    if (type === "success") icon = "✅";
    if (type === "warning") icon = "⚠️";
    if (type === "error") icon = "❌";

    toast.innerHTML = `<span>${icon}</span><span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateX(20px)";
        setTimeout(() => toast.remove(), 250);
    }, 3500);
}

function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// ==========================================================================
// WEBSOCKET LIFECYCLE & AUTO-RECONNECT
// ==========================================================================
function getWebSocketUrl(username) {
    const protocol = window.location.protocol === "https:" ? "wss://" : "ws://";
    const host = window.location.host || "localhost:8080";
    const token = localStorage.getItem("token") || "";
    return `${protocol}${host}/ws?username=${encodeURIComponent(username)}&token=${encodeURIComponent(token)}`;
}

function setConnectionStatus(status) {
    state.connectionStatus = status;

    const statusDot = document.getElementById("myStatusDot");
    const statusText = document.getElementById("myStatusText");
    const connectButton = document.getElementById("connectButton");
    const headerStatus = document.getElementById("connectionStatus");
    const myAvatar = document.getElementById("myAvatar");

    if (!statusDot || !statusText || !headerStatus) return;

    statusDot.className = "live-dot";
    if (myAvatar) myAvatar.className = "user-avatar status-indicator";
    headerStatus.className = "header-status-badge";

    if (status === "connected") {
        statusDot.classList.add("online");
        if (myAvatar) myAvatar.classList.add("online");
        headerStatus.classList.add("online");
        statusText.innerText = "Online";
        headerStatus.innerText = "Connected";
        if (connectButton) {
            connectButton.innerText = "Disconnect";
            connectButton.className = "btn-secondary";
        }
        state.reconnectAttempts = 0;
    } else if (status === "connecting" || status === "reconnecting") {
        statusDot.classList.add("connecting");
        if (myAvatar) myAvatar.classList.add("connecting");
        headerStatus.classList.add("connecting");
        statusText.innerText = status === "connecting" ? "Connecting..." : "Reconnecting...";
        headerStatus.innerText = statusText.innerText;
        if (connectButton) {
            connectButton.innerText = "Connecting...";
            connectButton.className = "btn-secondary";
        }
    } else {
        statusText.innerText = "Offline";
        headerStatus.innerText = "Offline";
        if (connectButton) {
            connectButton.innerText = "Connect";
            connectButton.className = "btn-primary";
        }
    }
}

function connect() {
    const token = localStorage.getItem("token");
    const username = (state.currentUser || localStorage.getItem("instaGo_username") || "").trim();

    if (!username || !token) {
        window.location.replace("register.html");
        return;
    }

    state.currentUser = username;
    updateProfileUI();

    if (state.socket && (state.socket.readyState === WebSocket.OPEN || state.socket.readyState === WebSocket.CONNECTING)) {
        state.socket.close();
    }

    setConnectionStatus("connecting");

    const wsUrl = getWebSocketUrl(username);

    try {
        state.socket = new WebSocket(wsUrl);
    } catch (e) {
        console.error("WebSocket init error:", e);
        setConnectionStatus("disconnected");
        showToast("Could not open WebSocket connection", "error");
        return;
    }

    state.socket.onopen = function () {
        setConnectionStatus("connected");
        showToast(`Connected as ${username}`, "success");
        playSound("notify");

        // Send JWT authentication over the WebSocket
        const jwtToken = (localStorage.getItem("token") || "").trim();
        if (jwtToken) {
            state.socket.send(JSON.stringify({
                type: "auth",
                token: jwtToken,
                username: username
            }));
        }

        if (typeof toggleUserDrawer === "function") {
            toggleUserDrawer(false);
        }

        // If there's an active recipient, request chat history
        if (state.activeRecipient) {
            requestHistory(state.activeRecipient);
        }
    };

    state.socket.onmessage = function (event) {
        handleIncomingMessage(event.data);
    };

    state.socket.onclose = function (event) {
        setConnectionStatus("disconnected");

        // Attempt reconnection if disconnected unintentionally and username exists
        if (state.currentUser && !event.wasClean && state.reconnectAttempts < 5) {
            state.reconnectAttempts++;
            const timeout = Math.min(3000 * state.reconnectAttempts, 10000);
            setConnectionStatus("reconnecting");
            clearTimeout(state.reconnectTimer);
            state.reconnectTimer = setTimeout(() => {
                connect();
            }, timeout);
        }
    };

    state.socket.onerror = function (error) {
        console.warn("WebSocket error:", error);
        setConnectionStatus("disconnected");
    };
}

function disconnect() {
    clearTimeout(state.reconnectTimer);
    state.reconnectAttempts = 99; // prevent auto-reconnect
    if (state.socket) {
        state.socket.close();
    }
    setConnectionStatus("disconnected");
    showToast("Disconnected from chat server", "info");
}

function logout() {
    if (confirm("Are you sure you want to sign out?")) {
        clearTimeout(state.reconnectTimer);
        state.reconnectAttempts = 99; // prevent auto-reconnect
        if (state.socket) {
            state.socket.close();
        }
        localStorage.removeItem("token");
        localStorage.removeItem("instaGo_username");
        localStorage.removeItem("instaGo_activeRecipient");
        showToast("Signed out successfully", "info");
        setTimeout(() => {
            window.location.href = "login.html";
        }, 300);
    }
}

function toggleConnect() {
    if (state.connectionStatus === "connected") {
        disconnect();
    } else {
        connect();
    }
}

// ==========================================================================
// MESSAGE PROCESSING & DISPATCH
// ==========================================================================
function handleIncomingMessage(rawData) {
    if (!rawData) return;

    try {
        const parsed = JSON.parse(rawData);

        // CASE 1: Chat History Array
        if (Array.isArray(parsed)) {
            handleHistoryResponse(parsed);
            return;
        }
    } catch (e) {
        // Not a JSON object/array - process as raw text
    }

    // CASE 2: System notification: "User <username> is not connected" or "does not exist"
    const notExistMatch = rawData.match(/^User\s+(.+)\s+does not exist$/i);
    if (notExistMatch) {
        const missingUser = notExistMatch[1].trim();
        showToast(`User "${missingUser}" does not exist`, "error");
        appendSystemMessage(`User "${missingUser}" does not exist in the database.`, "error");
        return;
    }

    const offlineMatch = rawData.match(/^User\s+(.+)\s+is not connected$/i);
    if (offlineMatch) {
        const offlineUser = offlineMatch[1].trim();
        showToast(`User "${offlineUser}" is currently offline`, "warning");
        appendSystemMessage(`User ${offlineUser} is not connected right now. They'll see your message when they connect.`);
        return;
    }

    // CASE 3: Normal chat message: "sender: message"
    const colonIndex = rawData.indexOf(":");
    if (colonIndex > 0) {
        const sender = rawData.slice(0, colonIndex).trim();
        const content = rawData.slice(colonIndex + 1).trim();

        processReceivedChatMessage(sender, content);
        return;
    }

    // Fallback unformatted message
    appendSystemMessage(rawData);
}

function processReceivedChatMessage(sender, content) {
    const isMine = sender === state.currentUser;
    const chatPartner = isMine ? state.activeRecipient : sender;

    if (!chatPartner) return;

    const messageObj = {
        id: "msg_" + Date.now() + "_" + Math.random().toString(36).substr(2, 4),
        from: sender,
        to: isMine ? state.activeRecipient : state.currentUser,
        message: content,
        timestamp: new Date().toISOString(),
        isMine: isMine,
        status: "received"
    };

    // Store in message cache
    if (!state.messages[chatPartner]) {
        state.messages[chatPartner] = [];
    }
    state.messages[chatPartner].push(messageObj);

    // Update contacts list
    updateContactSummary(chatPartner, content, new Date().toISOString(), !isMine && chatPartner !== state.activeRecipient);

    // Render if currently viewing this conversation
    if (chatPartner === state.activeRecipient) {
        renderSingleMessage(messageObj);
        playSound("receive");

        if (state.isScrolledUp) {
            state.unreadWhileScrolled++;
            updateScrollButton();
        } else {
            scrollToBottom(false);
        }
    } else {
        // Notification for background conversation
        playSound("notify");
        showToast(`New message from ${sender}`, "info");
    }
}

function handleHistoryResponse(historyArray) {
    if (!state.activeRecipient) return;

    // Transform into standard format
    const formattedMessages = historyArray.map(item => ({
        id: "hist_" + (item.id || Date.now() + Math.random()),
        from: item.from,
        to: item.to,
        message: item.message,
        timestamp: item.created_at || new Date().toISOString(),
        isMine: item.from === state.currentUser,
        status: "delivered"
    }));

    state.messages[state.activeRecipient] = formattedMessages;

    // Update last message in contact list
    if (formattedMessages.length > 0) {
        const last = formattedMessages[formattedMessages.length - 1];
        updateContactSummary(state.activeRecipient, last.message, last.timestamp, false);
    }

    renderCurrentConversation();
    scrollToBottom(false);
}

function appendSystemMessage(text, type = "info") {
    const output = document.getElementById("output");
    if (!output) return;

    const eventEl = document.createElement("div");
    eventEl.className = `system-event ${type}`;
    eventEl.innerHTML = `<span>ℹ️</span> <span>${escapeHtml(text)}</span>`;
    output.appendChild(eventEl);
    scrollToBottom(false);
}

// ==========================================================================
// SENDING MESSAGES
// ==========================================================================
function sendMessage() {
    const messageInput = document.getElementById("message");
    if (!messageInput) return;

    const text = messageInput.value.trim();
    if (!text) return;

    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
        showToast("Please connect to the server first", "warning");
        toggleUserDrawer(true);
        return;
    }

    if (!state.activeRecipient) {
        showToast("Select a conversation from the sidebar to chat", "warning");
        focusSearch();
        return;
    }

    const jwtToken = (localStorage.getItem("token") || "").trim();
    const payload = {
        type: "message",
        token: jwtToken,
        to: state.activeRecipient,
        message: text
    };

    // Optimistic UI addition
    const optimisticMsg = {
        id: "msg_" + Date.now(),
        from: state.currentUser,
        to: state.activeRecipient,
        message: text,
        timestamp: new Date().toISOString(),
        isMine: true,
        status: "sent"
    };

    if (!state.messages[state.activeRecipient]) {
        state.messages[state.activeRecipient] = [];
    }
    state.messages[state.activeRecipient].push(optimisticMsg);

    // Update contacts list summary
    updateContactSummary(state.activeRecipient, `You: ${text}`, optimisticMsg.timestamp, false);

    // Send payload through WebSocket
    state.socket.send(JSON.stringify(payload));

    // Render immediately & play sound
    renderSingleMessage(optimisticMsg);
    playSound("send");
    scrollToBottom(true);

    // Reset input
    messageInput.value = "";
    handleTextareaInput({ target: messageInput });
}

function sendQuickReaction(emoji) {
    if (!state.activeRecipient) {
        showToast("Select a conversation to send reaction", "info");
        return;
    }
    const messageInput = document.getElementById("message");
    if (messageInput) {
        messageInput.value = emoji;
        sendMessage();
    }
}

function requestHistory(recipient) {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    if (!recipient) return;

    const jwtToken = (localStorage.getItem("token") || "").trim();
    const payload = {
        type: "history",
        token: jwtToken,
        to: recipient
    };
    state.socket.send(JSON.stringify(payload));
}

function refreshHistory() {
    if (!state.activeRecipient) {
        showToast("Select a conversation first", "info");
        return;
    }
    showToast(`Refreshing history with ${state.activeRecipient}...`, "info");
    requestHistory(state.activeRecipient);
}

// ==========================================================================
// CONTACTS MANAGEMENT & SIDEBAR
// ==========================================================================
function updateContactSummary(username, lastMessage, timestamp, incrementUnread = false) {
    if (!username || username === state.currentUser) return;

    let contact = state.contacts.find(c => c.username.toLowerCase() === username.toLowerCase());

    if (!contact) {
        contact = {
            username: username,
            lastMessage: lastMessage || "Started conversation",
            timestamp: timestamp || new Date().toISOString(),
            unread: incrementUnread ? 1 : 0
        };
        state.contacts.unshift(contact);
    } else {
        contact.lastMessage = lastMessage || contact.lastMessage;
        contact.timestamp = timestamp || new Date().toISOString();
        if (incrementUnread) {
            contact.unread = (contact.unread || 0) + 1;
        }
        // Move to top of list
        state.contacts = [contact, ...state.contacts.filter(c => c !== contact)];
    }

    saveContacts();
    renderContactsList();
}

function saveContacts() {
    localStorage.setItem("instaGo_contacts", JSON.stringify(state.contacts));
}

function renderContactsList() {
    const listEl = document.getElementById("conversationList");
    const countEl = document.getElementById("contactsCount");
    if (!listEl) return;

    const query = state.searchContactTerm.toLowerCase().trim();
    const filtered = state.contacts.filter(c => c.username.toLowerCase().includes(query));

    if (countEl) {
        countEl.innerText = state.contacts.length;
    }

    if (filtered.length === 0) {
        listEl.innerHTML = `
            <div class="sidebar-empty-state">
                <div class="sidebar-empty-icon">💬</div>
                <div>${query ? "No chats found" : "No active chats yet"}</div>
                <div style="font-size: 11px;">${query ? `No chats match "${escapeHtml(query)}"` : "Click '+' above to start a conversation"}</div>
            </div>
        `;
        return;
    }

    listEl.innerHTML = "";

    filtered.forEach(contact => {
        const isActive = contact.username.toLowerCase() === state.activeRecipient.toLowerCase();
        const unreadCount = contact.unread || 0;

        const item = document.createElement("div");
        item.className = `conversation-item ${isActive ? "active" : ""} ${unreadCount > 0 ? "unread" : ""}`;
        item.setAttribute("role", "listitem");
        item.onclick = () => selectContact(contact.username);

        item.innerHTML = `
            <div class="contact-avatar" style="background: ${getAvatarGradient(contact.username)}">
                ${getInitials(contact.username)}
            </div>
            <div class="contact-info">
                <div class="contact-top-row">
                    <span class="contact-name">${escapeHtml(contact.username)}</span>
                    <span class="contact-time">${formatRelativeTime(contact.timestamp)}</span>
                </div>
                <div class="contact-bottom-row">
                    <span class="contact-snippet">${escapeHtml(contact.lastMessage || "No messages")}</span>
                    ${unreadCount > 0 ? `<span class="unread-badge">${unreadCount}</span>` : ""}
                    <button class="item-delete-btn" onclick="deleteContact(event, '${escapeHtml(contact.username)}')" title="Remove chat">✕</button>
                </div>
            </div>
        `;

        listEl.appendChild(item);
    });
}

function selectContact(username) {
    if (!username) {
        state.activeRecipient = "";
        localStorage.removeItem("instaGo_activeRecipient");
        updateHeaderUI();
        renderContactsList();
        renderEmptyState();
        return;
    }

    state.activeRecipient = username;
    localStorage.setItem("instaGo_activeRecipient", username);

    // Reset unread count for this contact
    const contact = state.contacts.find(c => c.username.toLowerCase() === username.toLowerCase());
    if (contact && contact.unread) {
        contact.unread = 0;
        saveContacts();
    }

    updateHeaderUI();
    renderContactsList();

    // Close mobile sidebar if open
    toggleMobileSidebar(false);

    // If we have messages cached, render them; otherwise request history
    if (state.messages[username] && state.messages[username].length > 0) {
        renderCurrentConversation();
        scrollToBottom(false);
    } else {
        renderEmptyChatLoading();
    }

    // Always fetch fresh history from backend
    requestHistory(username);
}

function renderEmptyState() {
    const output = document.getElementById("output");
    if (!output) return;
    output.innerHTML = `
        <div class="chat-welcome">
            <div class="welcome-badge">💬</div>
            <h2 class="welcome-title">InstaGo Messenger</h2>
            <p class="welcome-desc">
                Select a conversation from the sidebar or click '+' to start a new chat.
            </p>
            <div class="welcome-suggestions">
                <button class="btn-primary" onclick="startNewChatDialog()" style="padding: 8px 16px; font-size: 13px;">
                    + Start New Chat
                </button>
            </div>
        </div>
    `;
}

function deleteContact(event, username) {
    event.stopPropagation();
    state.contacts = state.contacts.filter(c => c.username.toLowerCase() !== username.toLowerCase());
    delete state.messages[username];
    saveContacts();

    if (state.activeRecipient.toLowerCase() === username.toLowerCase()) {
        state.activeRecipient = state.contacts.length > 0 ? state.contacts[0].username : "";
        selectContact(state.activeRecipient);
    } else {
        renderContactsList();
    }
}

function focusSearch() {
    const input = document.getElementById("searchContactsInput");
    if (input) {
        input.focus();
        input.select();
    }
}

function handleSearchKeydown(event) {
    if (event.key === "Enter") {
        event.preventDefault();
        const query = state.searchContactTerm.toLowerCase().trim();
        if (!query) return;

        const filtered = state.contacts.filter(c => c.username.toLowerCase().includes(query));
        if (filtered.length > 0) {
            selectContact(filtered[0].username);
        }
    }
}

async function startNewChatDialog() {
    const rawUsername = prompt("Enter the username to chat with:");
    if (!rawUsername) return;

    const username = rawUsername.trim();
    if (!username) return;

    if (username.toLowerCase() === state.currentUser.toLowerCase()) {
        showToast("You cannot start a chat with yourself", "warning");
        return;
    }

    // Check if conversation already exists in contacts
    const existing = state.contacts.find(c => c.username.toLowerCase() === username.toLowerCase());
    if (existing) {
        selectContact(existing.username);
        return;
    }

    // Verify user exists in database before creating any chat!
    showToast(`Checking if @${username} exists...`, "info");

    try {
        const response = await fetch(`/check-user?username=${encodeURIComponent(username)}`);
        if (response.ok) {
            const data = await response.json();
            const verifiedUsername = data.username || username;
            updateContactSummary(verifiedUsername, "Conversation started", new Date().toISOString(), false);
            selectContact(verifiedUsername);
            showToast(`Started conversation with @${verifiedUsername}`, "success");
        } else if (response.status === 404) {
            showToast(`User "${username}" does not exist. No chat created.`, "error");
        } else {
            showToast(`Could not verify user "${username}"`, "error");
        }
    } catch (e) {
        console.error("User check error:", e);
        showToast("Could not verify username with server", "error");
    }
}

async function quickSelectUser(name) {
    if (!name) return;
    const cleanName = name.trim();
    if (cleanName.toLowerCase() === state.currentUser.toLowerCase()) {
        showToast("You cannot start a chat with yourself", "warning");
        return;
    }

    const existing = state.contacts.find(c => c.username.toLowerCase() === cleanName.toLowerCase());
    if (existing) {
        selectContact(existing.username);
        return;
    }

    try {
        const response = await fetch(`/check-user?username=${encodeURIComponent(cleanName)}`);
        if (response.ok) {
            const data = await response.json();
            const verified = data.username || cleanName;
            updateContactSummary(verified, "Conversation started", new Date().toISOString(), false);
            selectContact(verified);
        } else {
            showToast(`User "${cleanName}" does not exist`, "error");
        }
    } catch (e) {
        console.error("User check error:", e);
        showToast("Could not verify user with server", "error");
    }
}

function handleStartChat(event) {
    if (event) event.preventDefault();
    startNewChatDialog();
}

// ==========================================================================
// RENDERING MESSAGES
// ==========================================================================
function renderEmptyChatLoading() {
    const output = document.getElementById("output");
    if (!output) return;

    output.innerHTML = `
        <div class="chat-welcome">
            <div class="welcome-badge">💬</div>
            <h2 class="welcome-title">Loading Chat with ${escapeHtml(state.activeRecipient)}</h2>
            <p class="welcome-desc">Fetching conversation history from database...</p>
        </div>
    `;
}

function renderCurrentConversation() {
    const output = document.getElementById("output");
    if (!output) return;

    const list = state.messages[state.activeRecipient] || [];

    if (list.length === 0) {
        output.innerHTML = `
            <div class="chat-welcome">
                <div class="welcome-badge">💬</div>
                <h2 class="welcome-title">No messages yet</h2>
                <p class="welcome-desc">Say hello to ${escapeHtml(state.activeRecipient)} to start the conversation.</p>
                <div class="welcome-suggestions">
                    <span class="suggestion-chip" onclick="sendQuickReaction('👋')">Say Hello 👋</span>
                    <span class="suggestion-chip" onclick="sendQuickReaction('👍')">Thumbs up 👍</span>
                    <span class="suggestion-chip" onclick="sendQuickReaction('Hello!')">Hello!</span>
                </div>
            </div>
        `;
        return;
    }

    output.innerHTML = "";

    // Search query filter
    const query = state.searchMessageTerm.toLowerCase().trim();
    let lastDate = "";

    list.forEach(msg => {
        if (query && !msg.message.toLowerCase().includes(query)) {
            return;
        }

        // Date divider
        const msgDate = formatDateHeader(msg.timestamp);
        if (msgDate !== lastDate) {
            lastDate = msgDate;
            const divider = document.createElement("div");
            divider.className = "date-divider";
            divider.innerHTML = `<span class="date-pill">${msgDate}</span>`;
            output.appendChild(divider);
        }

        output.appendChild(createMessageElement(msg));
    });
}

function renderSingleMessage(msg) {
    const output = document.getElementById("output");
    if (!output) return;

    // Remove welcome card if present
    const welcome = output.querySelector(".chat-welcome");
    if (welcome) welcome.remove();

    output.appendChild(createMessageElement(msg));
}

function createMessageElement(msg) {
    const row = document.createElement("div");
    row.className = `message-row ${msg.isMine ? "mine" : "theirs"}`;
    row.id = msg.id;

    const author = msg.from || (msg.isMine ? state.currentUser : state.activeRecipient);
    const timeStr = formatTime(msg.timestamp);

    row.innerHTML = `
        <div class="bubble-avatar" style="background: ${getAvatarGradient(author)}">
            ${getInitials(author)}
        </div>
        <div class="message-bubble-wrapper">
            <div class="message-bubble">
                <div class="bubble-author">${escapeHtml(author)}</div>
                <div class="bubble-content">${escapeHtml(msg.message)}</div>
                <div class="bubble-meta">
                    <span>${timeStr}</span>
                    ${msg.isMine ? `<span class="receipt-icon" title="Delivered">✓✓</span>` : ""}
                </div>
            </div>
        </div>
        <div class="bubble-actions">
            <button class="bubble-action-btn" onclick="copyMessageText('${escapeHtml(msg.message)}')" title="Copy message">📋</button>
            <button class="bubble-action-btn" onclick="sendQuickReaction('❤️')" title="Heart">❤️</button>
            <button class="bubble-action-btn" onclick="sendQuickReaction('👍')" title="Thumbs up">👍</button>
        </div>
    `;

    return row;
}

function copyMessageText(text) {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => {
            showToast("Message copied to clipboard", "success");
        });
    }
}

// ==========================================================================
// SCROLL MANAGEMENT & STICKY SCROLL
// ==========================================================================
function setupScrollListener() {
    const output = document.getElementById("output");
    if (!output) return;

    output.addEventListener("scroll", () => {
        const threshold = 120;
        const fromBottom = output.scrollHeight - output.scrollTop - output.clientHeight;

        state.isScrolledUp = fromBottom > threshold;

        if (!state.isScrolledUp) {
            state.unreadWhileScrolled = 0;
            updateScrollButton();
        }
    });
}

function scrollToBottom(force = false) {
    const output = document.getElementById("output");
    if (!output) return;

    if (force || !state.isScrolledUp) {
        output.scrollTop = output.scrollHeight;
        state.isScrolledUp = false;
        state.unreadWhileScrolled = 0;
        updateScrollButton();
    }
}

function updateScrollButton() {
    const btn = document.getElementById("scrollBottomBtn");
    const badge = document.getElementById("newMsgBadge");
    if (!btn || !badge) return;

    if (state.isScrolledUp) {
        btn.classList.add("visible");
        if (state.unreadWhileScrolled > 0) {
            badge.style.display = "block";
            badge.innerText = state.unreadWhileScrolled;
        } else {
            badge.style.display = "none";
        }
    } else {
        btn.classList.remove("visible");
        badge.style.display = "none";
    }
}

// ==========================================================================
// INPUT CONTROLS & EVENT HANDLERS
// ==========================================================================
function handleTextareaKeydown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
}

function handleTextareaInput(event) {
    const textarea = event.target;
    const sendBtn = document.getElementById("sendBtn");
    const charCounter = document.getElementById("charCounter");

    // Auto grow textarea
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + "px";

    const length = textarea.value.length;
    if (charCounter) {
        charCounter.innerText = `${length} / 2000`;
    }

    if (sendBtn) {
        sendBtn.disabled = length === 0;
    }
}

function toggleEmojiPicker() {
    const popover = document.getElementById("emojiPopover");
    if (!popover) return;
    popover.classList.toggle("open");
}

function insertEmoji(emoji) {
    const textarea = document.getElementById("message");
    if (!textarea) return;

    const start = textarea.selectionStart || 0;
    const end = textarea.selectionEnd || 0;
    const text = textarea.value;

    textarea.value = text.substring(0, start) + emoji + text.substring(end);
    textarea.selectionStart = textarea.selectionEnd = start + emoji.length;
    textarea.focus();

    handleTextareaInput({ target: textarea });
    toggleEmojiPicker();
}

function initEmojiGrid() {
    const grid = document.getElementById("emojiGrid");
    if (!grid) return;

    const emojis = [
        "😀", "😂", "🤣", "😊", "😍", "🤩", "😎",
        "🥳", "😏", "🥺", "😭", "😤", "🤯", "🥶",
        "👍", "👎", "👏", "🙌", "🤝", "🙏", "✌️",
        "🔥", "✨", "💯", "🎉", "🚀", "❤️", "💜",
        "💡", "⚡", "🌟", "💬", "👀", "🫡", "☕"
    ];

    grid.innerHTML = "";
    emojis.forEach(emoji => {
        const cell = document.createElement("button");
        cell.className = "emoji-cell";
        cell.type = "button";
        cell.innerText = emoji;
        cell.onclick = () => insertEmoji(emoji);
        grid.appendChild(cell);
    });

    // Close emoji popover on outside click
    document.addEventListener("click", e => {
        const popover = document.getElementById("emojiPopover");
        const trigger = document.getElementById("emojiTriggerBtn");
        if (popover && popover.classList.contains("open")) {
            if (!popover.contains(e.target) && !trigger.contains(e.target)) {
                popover.classList.remove("open");
            }
        }
    });
}

function toggleSound() {
    state.soundEnabled = !state.soundEnabled;
    localStorage.setItem("instaGo_sound", state.soundEnabled ? "true" : "false");
    const btn = document.getElementById("soundToggleBtn");
    if (btn) {
        btn.innerText = state.soundEnabled ? "🔊" : "🔇";
        btn.title = `Sound Effects (${state.soundEnabled ? "On" : "Off"})`;
    }
    showToast(`Sound ${state.soundEnabled ? "Enabled" : "Muted"}`, "info");
}

function toggleUserDrawer(force) {
    const drawer = document.getElementById("userConnectDrawer");
    if (!drawer) return;

    const shouldOpen = force !== undefined ? force : drawer.style.display !== "flex";
    drawer.style.display = shouldOpen ? "flex" : "none";
}

function toggleMobileSidebar(open) {
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("sidebarOverlay");
    if (!sidebar || !overlay) return;

    if (open) {
        sidebar.classList.add("open");
        overlay.classList.add("active");
    } else {
        sidebar.classList.remove("open");
        overlay.classList.remove("active");
    }
}

function toggleChatSearch(force) {
    const drawer = document.getElementById("chatSearchDrawer");
    const input = document.getElementById("searchMessagesInput");
    if (!drawer) return;

    const shouldOpen = force !== undefined ? force : !drawer.classList.contains("open");
    if (shouldOpen) {
        drawer.classList.add("open");
        if (input) input.focus();
    } else {
        drawer.classList.remove("open");
        if (input) input.value = "";
        state.searchMessageTerm = "";
        renderCurrentConversation();
    }
}

function handleSearchContacts(event) {
    state.searchContactTerm = event.target.value;
    renderContactsList();
}

function handleSearchMessages(event) {
    state.searchMessageTerm = event.target.value;
    renderCurrentConversation();
}

// ==========================================================================
// UI STATE UPDATES
// ==========================================================================
function updateProfileUI() {
    const nameEl = document.getElementById("myUsername");
    const avatarEl = document.getElementById("myAvatar");

    if (nameEl) {
        nameEl.innerText = state.currentUser ? `@${state.currentUser}` : "Guest";
    }
    if (avatarEl) {
        avatarEl.innerText = getInitials(state.currentUser);
        avatarEl.style.background = getAvatarGradient(state.currentUser);
    }
}

function updateHeaderUI() {
    const title = document.getElementById("chatTitle");
    const subtitle = document.getElementById("chatSubtitle");
    const avatar = document.getElementById("activeAvatar");

    if (!title || !subtitle || !avatar) return;

    if (state.activeRecipient) {
        title.innerText = state.activeRecipient;
        subtitle.innerText = "Real-time conversation history";
        avatar.innerText = getInitials(state.activeRecipient);
        avatar.style.background = getAvatarGradient(state.activeRecipient);
    } else {
        title.innerText = "InstaGo Messenger";
        subtitle.innerText = "Select or start a conversation from the sidebar";
        avatar.innerText = "💬";
        avatar.style.background = "var(--accent)";
    }
}

// ==========================================================================
// INITIALIZATION
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
    // 1. Auth Guard check: Ensure user is registered & logged in
    const token = localStorage.getItem("token");
    const username = localStorage.getItem("instaGo_username");

    if (!token || !username) {
        window.location.replace("register.html");
        return;
    }

    state.currentUser = username;

    // 2. Initialize UI
    updateProfileUI();
    updateHeaderUI();
    renderContactsList();
    initEmojiGrid();
    setupScrollListener();

    // Check sound setting
    const soundBtn = document.getElementById("soundToggleBtn");
    if (soundBtn) {
        soundBtn.innerText = state.soundEnabled ? "🔊" : "🔇";
    }

    // Automatically connect with authenticated session
    connect();

    // Select active recipient if stored
    if (state.activeRecipient) {
        selectContact(state.activeRecipient);
    }

    // Disable send button initially if empty
    const textarea = document.getElementById("message");
    if (textarea) {
        handleTextareaInput({ target: textarea });
    }
});