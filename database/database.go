package database

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/joho/godotenv"
	_ "github.com/lib/pq"
	"golang.org/x/crypto/bcrypt"
)

func Connect() *sql.DB {

	err := godotenv.Load()

	if err != nil {
		log.Fatal("Error loading .env file:", err)
	}

	dbHost := os.Getenv("POSTGRES_HOST")
	dbPort := os.Getenv("POSTGRES_PORT")
	dbUser := os.Getenv("POSTGRES_USER")
	dbPassword := os.Getenv("POSTGRES_PASSWORD")
	dbName := os.Getenv("POSTGRES_DB")

	connStr := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		dbHost,
		dbPort,
		dbUser,
		dbPassword,
		dbName,
	)

	db, err := sql.Open("postgres", connStr)

	if err != nil {
		log.Fatal("Error opening database:", err)
	}

	err = db.Ping()

	if err != nil {
		log.Fatal("Error pinging database:", err)
	}

	fmt.Println("Database connected successfully")

	return db
}

func CreateTables(db *sql.DB) {

	createTableQuery := `

	CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
	
	CREATE TABLE IF NOT EXISTS messages (
	id SERIAL PRIMARY KEY,
	from_user TEXT NOT NULL,
	to_user TEXT NOT NULL,
	message TEXT NOT NULL,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`

	_, err := db.Exec(createTableQuery)

	if err != nil {
		log.Fatal("Error creating messages table:", err)
	}

	fmt.Println("Tables ready")
}

type Message struct {
	From      string    `json:"from"`
	To        string    `json:"to"`
	Message   string    `json:"message"`
	CreatedAt time.Time `json:"created_at"`
}

func SaveMessage(db *sql.DB, fromUser, toUser, message string) error {

	query := `
		INSERT INTO messages (from_user, to_user, message)
		VALUES ($1, $2, $3)
	`

	_, err := db.Exec(
		query,
		fromUser,
		toUser,
		message,
	)

	return err
}

func RegisterUser(db *sql.DB, username, password string) error {

	hashedPassword, err := bcrypt.GenerateFromPassword(
		[]byte(password),
		bcrypt.DefaultCost,
	)

	if err != nil {
		return err
	}

	query := `
		INSERT INTO users (username, password)
		VALUES ($1, $2)
	`

	_, err = db.Exec(
		query,
		username,
		string(hashedPassword),
	)

	return err
}

func GetUserByUsername(db *sql.DB, username string) (string, string, error) {
	query := `SELECT username, password
				 FROM users
				 WHERE username = $1`
	row := db.QueryRow(query, username)

	var dbUsername string
	var hashedPassword string
	err := row.Scan(&dbUsername, &hashedPassword)

	if err != nil {
		return "", "", err
	}
	return dbUsername, hashedPassword, nil

}

type ConversationSummary struct {
	Username    string    `json:"username"`
	LastMessage string    `json:"lastMessage"`
	Timestamp   time.Time `json:"timestamp"`
}

func GetChatHistory(db *sql.DB, username1, username2 string) ([]Message, error) {

	query := `
		SELECT from_user, to_user, message, created_at
		FROM messages
		WHERE (LOWER(from_user) = LOWER($1) AND LOWER(to_user) = LOWER($2))
		   OR (LOWER(from_user) = LOWER($2) AND LOWER(to_user) = LOWER($1))
		ORDER BY created_at ASC
	`

	rows, err := db.Query(query, username1, username2)

	if err != nil {
		return nil, err
	}

	defer rows.Close()

	history := make([]Message, 0)

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

func GetRecentConversations(db *sql.DB, username string) ([]ConversationSummary, error) {
	query := `
		SELECT 
			COALESCE(u.username, ranked.partner) AS username,
			ranked.message,
			ranked.created_at
		FROM (
			SELECT 
				CASE 
					WHEN LOWER(from_user) = LOWER($1) THEN to_user 
					ELSE from_user 
				END AS partner,
				message,
				created_at,
				ROW_NUMBER() OVER (
					PARTITION BY (
						CASE 
							WHEN LOWER(from_user) = LOWER($1) THEN LOWER(to_user) 
							ELSE LOWER(from_user) 
						END
					) 
					ORDER BY created_at DESC
				) AS rn
			FROM messages
			WHERE LOWER(from_user) = LOWER($1) OR LOWER(to_user) = LOWER($1)
		) ranked
		LEFT JOIN users u ON LOWER(u.username) = LOWER(ranked.partner)
		WHERE ranked.rn = 1
		ORDER BY ranked.created_at DESC;
	`

	rows, err := db.Query(query, username)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	conversations := make([]ConversationSummary, 0)

	for rows.Next() {
		var c ConversationSummary
		err := rows.Scan(&c.Username, &c.LastMessage, &c.Timestamp)
		if err != nil {
			return nil, err
		}
		conversations = append(conversations, c)
	}

	if err = rows.Err(); err != nil {
		return nil, err
	}

	return conversations, nil
}

