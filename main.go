package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

type Message struct {
	From    string `json:"from"`
	To      string `json:"to"`
	Message string `json:"message"`
}

type client struct {
	conn     *websocket.Conn
	username string
}

type Hub struct {
	mu      sync.Mutex
	clients map[*client]bool
}

var hub = Hub{
	clients: make(map[*client]bool),
}

var messages []Message

var upgrade = websocket.Upgrader{}

func main() {
	http.HandleFunc("/ws", handleWebSocket)
	http.Handle("/", http.FileServer(http.Dir("./frontend")))

	fmt.Println("Server is running on port 8080")

	http.ListenAndServe(":8080", nil)
}

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrade.Upgrade(w, r, nil)

	if err != nil {
		http.Error(w, "Could not upgrade connection", http.StatusInternalServerError)
		return
	}

	username := r.URL.Query().Get("username")

	client := &client{
		conn:     conn,
		username: username,
	}

	hub.mu.Lock()
	hub.clients[client] = true
	hub.mu.Unlock()

	defer func() {
		hub.mu.Lock()
		delete(hub.clients, client)
		hub.mu.Unlock()
	}()

	for {

		messageType, message, err := conn.ReadMessage()

		if err != nil {
			fmt.Println("Disconnected", err)
			return
		}

		var ChatMessage Message

		err = json.Unmarshal(message, &ChatMessage)

		if err != nil {
			fmt.Println("Invalid message:", err)
			continue
		}

		ChatMessage.From = client.username

		messages = append(messages, ChatMessage)

		response := []byte(client.username + ":" + ChatMessage.Message)

		found := false
		hub.mu.Lock()
		for recipient := range hub.clients {
			if recipient.username == ChatMessage.To {
				found = true
				recipient.conn.WriteMessage(messageType, response)
			}
		}

		hub.mu.Unlock()

		if !found {
			err := client.conn.WriteMessage(
				websocket.TextMessage,
				[]byte("user "+ChatMessage.To+" is not connected"),
			)

			if err != nil {
				fmt.Println("Error sending notification:", err)
			}
		}
	}

}
func getChatHistory(username1 string, username2 string) []Message {
	var history []Message

	for _, msg := range messages {
		if (msg.From == username1 && msg.To == username2) ||
		(msg.From == username2 && msg.To == username1)

		history = append(history, msg)
	}

}
