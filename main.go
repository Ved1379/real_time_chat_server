package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/joho/godotenv"
	_ "github.com/lib/pq"
)

type Message struct {
	Type      string    `json:"type"`
	From      string    `json:"from"`
	To        string    `json:"to"`
	Message   string    `json:"message"`
	CreatedAt time.Time `json:"created_at"`
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
var db *sql.DB

var upgrade = websocket.Upgrader{}

func main() {
	err := godotenv.Load()

	if err != nil {
		log.Fatal("Error loading .env file", err)
	}

	dbHost := os.Getenv("POSTGRES_HOST")
	dbport := os.Getenv("POSTGRES_PORT")
	dbUser := os.Getenv("POSTGRES_USER")
	dbpassword := os.Getenv("POSTGRES_PASSWORD")
	dbName := os.Getenv("POSTGRES_DB")

	connStr := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		dbHost,
		dbport,
		dbUser,
		dbpassword,
		dbName,
	)

	db, err = sql.Open("postgres", connStr)

	if err != nil {
		log.Fatal("Error connecting to database:", err)
	}

	err = db.Ping()

	if err != nil {
		log.Fatal("Error pinging database:", err)
	}

	createTableQuery := `
	CREATE TABLE IF NOT EXISTS messages (
	id SERIAL PRIMARY KEY,
	from_user TEXT NOT NULL,
	to_user TEXT NOT NULL,
	message TEXT NOT NULL,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`

	_, err = db.Exec(createTableQuery)

	if err != nil {
		log.Fatal("Error creating messages table:", err)
	}

	fmt.Println("Message table ready")

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

		switch ChatMessage.Type {

		case "message":

			ChatMessage.From = client.username

			query := `
					INSERT INTO messages (from_user, to_user, message)
					VALUES ($1, $2, $3)
				`

			_, err = db.Exec(
				query,
				ChatMessage.From,
				ChatMessage.To,
				ChatMessage.Message,
			)
			if err != nil {
				fmt.Println("Error saving message", err)
			}

			response := []byte(client.username + ": " + ChatMessage.Message)

			found := false

			hub.mu.Lock()

			for recipient := range hub.clients {
				if recipient.username == ChatMessage.To {
					found = true

					err := recipient.conn.WriteMessage(
						messageType,
						response,
					)

					if err != nil {
						fmt.Println("Error sending message:", err)
					}
				}
			}

			hub.mu.Unlock()

			if !found {
				err := client.conn.WriteMessage(
					websocket.TextMessage,
					[]byte("User "+ChatMessage.To+" is not connected"),
				)

				if err != nil {
					fmt.Println("Error sending notification:", err)
				}
			}

		case "history":
			history, err := getChatHistory(client.username, ChatMessage.To)
			historyJSON, err := json.Marshal(history)

			if err != nil {
				fmt.Println("Error creating history:", err)
				return
			}

			err = client.conn.WriteMessage(
				websocket.TextMessage,
				historyJSON,
			)

			if err != nil {
				fmt.Println("Error sending history:", err)
				return
			}
		}
	}

}
func getChatHistory(username1, username2 string) ([]Message, error) {

	query := `SELECT from_user, to_user, message, created_at
		FROM messages
		WHERE (from_user = $1 AND to_user = $2)
		   OR (from_user = $2 AND to_user = $1)
		ORDER BY created_at ASC
		`

	rows, err := db.Query(query, username1, username2)

	if err != nil {
		return nil, err
	}

	defer rows.Close()

	var history []Message

	for rows.Next() {

		var msg Message

		err := rows.Scan(
			&msg.From,
			&msg.To,
			&msg.Message,
			&msg.CreatedAt,
		)

		if err != nil {
			return nil, err
		}

		history = append(history, msg)
	}

	if err = rows.Err(); err != nil {
		return nil, err
	}

	return history, nil
}
