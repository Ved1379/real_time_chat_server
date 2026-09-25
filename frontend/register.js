const registerForm = document.getElementById("registerForm");
const message = document.getElementById("message");

registerForm.addEventListener("submit", async function (event) {
    event.preventDefault();

    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;
    const confirmPassword = document.getElementById("confirmPassword").value;

    if (password !== confirmPassword) {
        message.textContent = "Passwords do not match";
        return;
    }

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
            message.textContent = result;
            registerForm.reset();
        } else {
            message.textContent = result;
        }

    } catch (error) {
        message.textContent = "Could not connect to server";
        console.error(error);
    }
});