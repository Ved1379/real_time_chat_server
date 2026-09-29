package authentication

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"realtime-chat/database"

	"golang.org/x/crypto/bcrypt"
)

func LoginHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var user struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		err := json.NewDecoder(r.Body).Decode(&user)
		if err != nil {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}
		if user.Username == "" || user.Password == "" {
			http.Error(w, "Username and Password are required", http.StatusBadRequest)
			return
		}
		dbUsername, hashedPassword, err := database.GetUserByUsername(db, user.Username)

		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				http.Error(w, "Invalid username or password", http.StatusUnauthorized)
				return
			}

			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}
		err = bcrypt.CompareHashAndPassword(
			[]byte(hashedPassword),
			[]byte(user.Password),
		)
		if err != nil {
			http.Error(w, "Inavlid username or password", http.StatusUnauthorized)
			return
		}
		token, err := GenerateToken(dbUsername)

		if err != nil {
			http.Error(w, "Could not create token", http.StatusInternalServerError)
			return
		}

		fmt.Fprintln(w, token)
	}
}
