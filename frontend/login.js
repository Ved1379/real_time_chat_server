const loginForm = document.getElementById("loginForm");
const message = document.getElementById("message");
const submitBtn = document.getElementById("submitBtn");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const welcomeBanner = document.getElementById("welcomeBanner");
const sessionNotice = document.getElementById("sessionNotice");

function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

// 1. Detect if returning from Step 1 (Registration)
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has("registered")) {
    const registeredName = urlParams.get("registered");
    if (registeredName) {
        usernameInput.value = registeredName;
        welcomeBanner.innerHTML = `🎉 Account <strong>${escapeHtml(registeredName)}</strong> created! Enter your password to sign in.`;
        welcomeBanner.style.display = "block";
        passwordInput.focus();
    }
} else {
    usernameInput.focus();
}

// 2. Detect existing session
const existingUser = localStorage.getItem("instaGo_username");
const existingToken = localStorage.getItem("token");
if (existingUser && existingToken && sessionNotice && !urlParams.has("registered")) {
    sessionNotice.style.display = "block";
    sessionNotice.innerHTML = `You are currently logged in as <strong>${escapeHtml(existingUser)}</strong>. <a href="/">Enter Chat →</a>`;
}

// 3. Handle Login Submit
loginForm.addEventListener("submit", async function (event) {
    event.preventDefault();

    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!username || !password) {
        message.style.color = "#f43f5e";
        message.textContent = "Please fill in both fields";
        return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span>Authenticating...</span>`;
    message.style.color = "#94a3b8";
    message.textContent = "Verifying credentials...";

    try {
        const response = await fetch("/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                username: username,
                password: password
            })
        });

        const result = await response.text();

        if (response.ok) {
            localStorage.setItem("token", result.trim());
            localStorage.setItem("instaGo_username", username);
            message.style.color = "#10b981";
            message.textContent = "Login successful! Launching chat...";

            setTimeout(() => {
                window.location.href = "/";
            }, 700);
        } else {
            message.style.color = "#f43f5e";
            message.textContent = result.trim() || "Invalid username or password";
            submitBtn.disabled = false;
            submitBtn.innerHTML = `<span>Sign In & Launch Chat</span><span>→</span>`;
        }

    } catch (error) {
        message.style.color = "#f43f5e";
        message.textContent = "Could not connect to server";
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<span>Sign In & Launch Chat</span><span>→</span>`;
        console.error(error);
    }
});