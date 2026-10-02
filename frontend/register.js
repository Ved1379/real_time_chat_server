const registerForm = document.getElementById("registerForm");
const message = document.getElementById("message");
const submitBtn = document.getElementById("submitBtn");
const sessionNotice = document.getElementById("sessionNotice");

// Check if user is already logged in
const existingUser = localStorage.getItem("instaGo_username");
const existingToken = localStorage.getItem("token");
if (existingUser && existingToken && sessionNotice) {
    sessionNotice.style.display = "block";
    sessionNotice.innerHTML = `You are currently logged in as <strong>${escapeHtml(existingUser)}</strong>. <a href="/">Open Chat →</a>`;
}

function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

registerForm.addEventListener("submit", async function (event) {
    event.preventDefault();

    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;
    const confirmPassword = document.getElementById("confirmPassword").value;

    if (!username) {
        message.style.color = "#f43f5e";
        message.textContent = "Please enter a valid username";
        return;
    }

    if (password.length < 4) {
        message.style.color = "#f43f5e";
        message.textContent = "Password must be at least 4 characters";
        return;
    }

    if (password !== confirmPassword) {
        message.style.color = "#f43f5e";
        message.textContent = "Passwords do not match";
        return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span>Creating Account...</span>`;
    message.style.color = "#94a3b8";
    message.textContent = "Connecting to server...";

    try {
        const response = await fetch("/register", {
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
            // Clear any previous user's session data to avoid cross-account bleeding
            try {
                localStorage.removeItem("token");
                localStorage.removeItem("instaGo_username");
                localStorage.removeItem("instaGo_activeRecipient");
                localStorage.removeItem("instaGo_contacts");
            } catch (e) {}

            message.style.color = "#10b981";
            message.textContent = "Account registered successfully! Redirecting to Step 2 (Login)...";
            registerForm.reset();
            setTimeout(() => {
                window.location.href = `login.html?registered=${encodeURIComponent(username)}`;
            }, 900);
        } else {
            message.style.color = "#f43f5e";
            message.textContent = result.trim() || "Registration failed. Please try again.";
            submitBtn.disabled = false;
            submitBtn.innerHTML = `<span>Create Account & Continue</span><span>→</span>`;
        }

    } catch (error) {
        message.style.color = "#f43f5e";
        message.textContent = "Could not connect to the server";
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<span>Create Account & Continue</span><span>→</span>`;
        console.error(error);
    }
});