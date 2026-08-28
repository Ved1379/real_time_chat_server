package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"realtime-chat/database"
	"realtime-chat/websocket"

	gorilla "github.com/gorilla/websocket"
)

type Message struct {
	Type      string    `json:"type"`
	From      string    `json:"from"`
	To        string    `json:"to"`
	Message   string    `json:"message"`
	CreatedAt time.Time `json:"created_at"`
}

type client struct {
	conn     *gorilla.Conn
	username string
}

var hub = websocket.NewHub()

var messages []Message
var db *sql.DB

var upgrade = gorilla.Upgrader{}

func main() {

	db = database.Connect()

	database.CreateTables(db)

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

	client := &websocket.Client{
		Conn:     conn,
		Username: username,
	}

	hub.Mu.Lock()
	hub.Clients[client] = true
	hub.Mu.Unlock()

	defer func() {
		hub.Mu.Lock()
		delete(hub.Clients, client)
		hub.Mu.Unlock()
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

		switch ChatMessage.Type {

		case "message":

			ChatMessage.From = client.Username

			err := database.SaveMessage(
				db,
				ChatMessage.From,
				ChatMessage.To,
				ChatMessage.Message,
			)

			if err != nil {
				fmt.Println("Error saving message:", err)
			}

			response := []byte(client.Username + ": " + ChatMessage.Message)

			found := false

			hub.Mu.Lock()

			for recipient := range hub.Clients {
				if recipient.Username == ChatMessage.To {
					found = true

					err := recipient.Conn.WriteMessage(
						messageType,
						response,
					)

					if err != nil {
						fmt.Println("Error sending message:", err)
					}
				}
			}

			hub.Mu.Unlock()

			if !found {
				err := client.Conn.WriteMessage(
					gorilla.TextMessage,
					[]byte("User "+ChatMessage.To+" is not connected"),
				)

				if err != nil {
					fmt.Println("Error sending notification:", err)
				}
			}

		case "history":
			history, err := database.GetChatHistory(db, client.Username, ChatMessage.To)

			if err != nil {
				fmt.Println("Error getting chat history:", err)
				return
			}
			
			historyJSON, err := json.Marshal(history)

			if err != nil {
				fmt.Println("Error creating history:", err)
				return
			}

			err = client.Conn.WriteMessage(
				gorilla.TextMessage,
				historyJSON,
			)

			if err != nil {
				fmt.Println("Error sending history:", err)
				return
			}
		}
	}

}