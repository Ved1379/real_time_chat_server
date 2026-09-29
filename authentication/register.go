package authentication

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"realtime-chat/database"
	"strings"
)

func RegisterHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {

		var user struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}

		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		err := json.NewDecoder(r.Body).Decode(&user)

		if err != nil {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}

		user.Username = strings.TrimSpace(user.Username)
		if user.Username == "" || user.Password == "" {
			http.Error(w, "Username and password required", http.StatusBadRequest)
			return
		}

		err = database.RegisterUser(db, user.Username, user.Password)
		if err != nil {
			if strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "unique constraint") {
				http.Error(w, "Username already exists. Please choose another username or sign in.", http.StatusConflict)
				return
			}
			http.Error(w, "Could not register user", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusCreated)
		fmt.Fprintln(w, "User registered successfully")
	}

}
