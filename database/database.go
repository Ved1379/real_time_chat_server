package database

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/joho/godotenv"
	_ "github.com/lib/pq"
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

	fmt.Println("Message table ready")
}

type Message struct {
	From      string
	To        string
	Message   string
	CreatedAt time.Time
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