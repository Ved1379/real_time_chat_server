package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"realtime-chat/authentication"
	"realtime-chat/database"
	"realtime-chat/websocket"

	gorilla "github.com/gorilla/websocket"
)

type Message struct {
	Type      string    `json:"type"`
	Token     string    `json:"token,omitempty"`
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

var upgrade = gorilla.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		return origin == "http://localhost:8080"
	},
}

func main() {

	db = database.Connect()

	database.CreateTables(db)

	http.HandleFunc("/ws", handleWebSocket)
	http.HandleFunc("/check-user", handleCheckUser)
	http.HandleFunc("/conversations", handleConversations)
	http.Handle("/register", authentication.RegisterHandler(db))
	http.Handle("/login", authentication.LoginHandler(db))
	http.Handle("/", http.FileServer(http.Dir("./frontend")))

	fmt.Println("Server is running on port 8080")

	http.ListenAndServe(":8080", nil)
}

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	username := ""

	tokenString := r.URL.Query().Get("token")

	if tokenString != "" {
		claims, err := authentication.ValidateToken(tokenString)

		if err == nil && claims.Username != "" {
			username = claims.Username
		}
	}

	if username == "" {
		http.Error(w, "Unauthorized: valid token required", http.StatusUnauthorized)
		return
	}

	conn, err := upgrade.Upgrade(w, r, nil)
	if err != nil {
		http.Error(w, "Could not upgrade connection", http.StatusInternalServerError)
		return
	}

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

		_, message, err := conn.ReadMessage()

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
			var recipientExists bool
			err = db.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE LOWER(username) = LOWER($1))", ChatMessage.To).Scan(&recipientExists)
			if err != nil || !recipientExists {
				_ = client.Conn.WriteMessage(
					gorilla.TextMessage,
					[]byte("User "+ChatMessage.To+" does not exist"),
				)
				continue
			}

			err = database.SaveMessage(
				db,
				ChatMessage.From,
				ChatMessage.To,
				ChatMessage.Message,
			)

			if err != nil {
				fmt.Println("Error saving message:", err)
			}

			response := []byte(client.Username + ": " + ChatMessage.Message)

			var recipients []*websocket.Client

			hub.Mu.Lock()
			for recipient := range hub.Clients {
				if recipient.Username == ChatMessage.To {
					recipients = append(recipients, recipient)
				}
			}
			hub.Mu.Unlock()

			found := len(recipients) > 0

			for _, recipient := range recipients {
				err := recipient.Conn.WriteMessage(gorilla.TextMessage, response)
				if err != nil {
					fmt.Println("Error sending message:", err)
				}
			}

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
			history, err := database.GetChatHistory(
				db,
				client.Username,
				ChatMessage.To,
			)

			if err != nil {
				fmt.Println("Error getting chat history:", err)
				return
			}

			if history == nil {
				history = []database.Message{}
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

func handleConversations(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	tokenString := r.URL.Query().Get("token")
	if tokenString == "" {
		authHeader := r.Header.Get("Authorization")
		if strings.HasPrefix(authHeader, "Bearer ") {
			tokenString = strings.TrimPrefix(authHeader, "Bearer ")
		}
	}

	if tokenString == "" {
		http.Error(w, "Unauthorized: valid token required", http.StatusUnauthorized)
		return
	}

	claims, err := authentication.ValidateToken(tokenString)
	if err != nil || claims.Username == "" {
		http.Error(w, "Unauthorized: invalid token", http.StatusUnauthorized)
		return
	}

	conversations, err := database.GetRecentConversations(db, claims.Username)
	if err != nil {
		http.Error(w, "Failed to retrieve conversations: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(conversations)
}

func handleCheckUser(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	username := strings.TrimSpace(r.URL.Query().Get("username"))
	if username == "" {
		http.Error(w, "Username parameter is required", http.StatusBadRequest)
		return
	}

	var dbUsername string
	err := db.QueryRow("SELECT username FROM users WHERE LOWER(username) = LOWER($1)", username).Scan(&dbUsername)
	if err != nil {
		if err == sql.ErrNoRows {
			http.Error(w, "User not found", http.StatusNotFound)
			return
		}
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"exists":   true,
		"username": dbUsername,
	})
}

