package authentication

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"realtime-chat/database"
)

var user struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func RegisterHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {

		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		err := json.NewDecoder(r.Body).Decode(&user)

		if err != nil {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}

		if user.Username == "" || user.Password == "" {
			http.Error(w, "Username and password required", http.StatusBadRequest)
			return
		}

		err = database.RegisterUser(db, user.Username, user.Password)
		if err != nil {
			http.Error(w, "could not register user", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusCreated)
		fmt.Fprintln(w, "User registered successfully")
	}

}
