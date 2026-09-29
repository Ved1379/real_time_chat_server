const loginForm = document.getElementById("loginForm");
const message = document.getElementById("message");

loginForm.addEventListener("submit", async function (event) {
    event.preventDefault();

    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;

    message.style.color = "#94a3b8";
    message.textContent = "Authenticating...";

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
            }, 800);
        } else {
            message.style.color = "#f43f5e";
            message.textContent = result || "Invalid username or password";
        }

    } catch (error) {
        message.style.color = "#f43f5e";
        message.textContent = "Could not connect to server";
        console.error(error);
    }
});