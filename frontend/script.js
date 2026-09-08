let socket;

let currentUsername = "";


// =========================
// CONNECT
// =========================

function connect() {

    const username =
        document.getElementById("username")
            .value
            .trim();


    if (!username) {

        alert("Please enter a username");

        return;
    }


    currentUsername = username;


    socket = new WebSocket(
        "ws://localhost:8080/ws?username=" +
        encodeURIComponent(username)
    );


    // =========================
    // CONNECTION OPEN
    // =========================

    socket.onopen = function() {

        document.getElementById("status")
            .innerText = "Online";


        document.getElementById("connectionStatus")
            .innerText = "Connected";


        document.getElementById("statusDot")
            .classList.add("online");


        document.getElementById("connectButton")
            .innerText = "Connected";

    };


    // =========================
    // RECEIVE MESSAGE
    // =========================

    socket.onmessage = function(event) {

        const output =
            document.getElementById("output");


        try {

            const data =
                JSON.parse(event.data);


            // =========================
            // CHAT HISTORY
            // =========================

            if (Array.isArray(data)) {

                output.innerHTML = "";


                data.forEach(function(msg) {

                    addMessage(
                        msg.from,
                        msg.message,
                        msg.from === currentUsername
                    );

                });

            }


            // =========================
            // JSON OBJECT
            // =========================

            else {

                output.innerHTML +=
                    "<div class='message'>" +

                    "<div class='message-text'>" +
                    event.data +
                    "</div>" +

                    "</div>";

            }

        }


        // =========================
        // NORMAL TEXT MESSAGE
        // =========================

        catch (error) {

            output.innerHTML +=
                "<div class='message'>" +

                "<div class='message-text'>" +
                event.data +
                "</div>" +

                "</div>";

        }


        output.scrollTop =
            output.scrollHeight;

    };


    // =========================
    // CONNECTION CLOSED
    // =========================

    socket.onclose = function() {

        document.getElementById("status")
            .innerText = "Offline";


        document.getElementById("connectionStatus")
            .innerText = "Disconnected";


        document.getElementById("statusDot")
            .classList.remove("online");


        document.getElementById("connectButton")
            .innerText = "Connect";

    };


    // =========================
    // ERROR
    // =========================

    socket.onerror = function(error) {

        console.log(
            "WebSocket error:",
            error
        );

    };

}


// =========================
// SEND MESSAGE
// =========================

function sendMessage() {

    const recipient =
        document.getElementById("recipient")
            .value
            .trim();


    const messageInput =
        document.getElementById("message");


    const message =
        messageInput
            .value
            .trim();


    if (!socket ||
        socket.readyState !== WebSocket.OPEN) {

        alert("Connect first!");

        return;
    }


    if (!recipient || !message) {

        return;
    }


    const data = {

        type: "message",

        to: recipient,

        message: message

    };


    socket.send(
        JSON.stringify(data)
    );


    // Show the message on sender's side

    addMessage(
        currentUsername,
        message,
        true,
        "✓ Sent"
    );


    messageInput.value = "";

}


// =========================
// GET CHAT HISTORY
// =========================

function getHistory() {

    const recipient =
        document.getElementById("recipient")
            .value
            .trim();


    if (!socket ||
        socket.readyState !== WebSocket.OPEN) {

        alert("Connect first!");

        return;
    }


    if (!recipient) {

        return;
    }


    // Update chat header

    document.getElementById("chatTitle")
        .innerText =
        "Chat with " + recipient;


    document.getElementById("chatSubtitle")
        .innerText =
        "Conversation history";


    // Request history

    const data = {

        type: "history",

        to: recipient

    };


    socket.send(
        JSON.stringify(data)
    );

}


// =========================
// RECIPIENT ENTER
// =========================

function handleRecipient(event) {

    if (event.key === "Enter") {

        getHistory();

    }

}


// =========================
// ADD MESSAGE
// =========================

function addMessage(
    username,
    message,
    mine = false,
    status = ""
) {

    const output =
        document.getElementById("output");


    // Remove welcome screen

    const welcome =
        output.querySelector(".welcome");


    if (welcome) {

        welcome.remove();

    }


    const div =
        document.createElement("div");


    div.className =
        "message" +
        (mine ? " mine" : "");


    const name =
        document.createElement("div");


    name.className =
        "message-name";


    name.innerText =
        username;


    const text =
        document.createElement("div");


    text.className =
        "message-text";


    text.innerText =
        message;


    div.appendChild(name);

    div.appendChild(text);


    // Add status for sender

    if (status) {

        const statusElement =
            document.createElement("div");


        statusElement.className =
            "message-status";


        statusElement.innerText =
            status;


        div.appendChild(statusElement);

    }


    output.appendChild(div);


    output.scrollTop =
        output.scrollHeight;

}


// =========================
// ENTER TO SEND
// =========================

function handleEnter(event) {

    if (event.key === "Enter") {

        sendMessage();

    }

}