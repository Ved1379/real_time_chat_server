package websocket

import "sync"

type hub struct {
	Mu sync.Mutex
	Client map[*Client]bool
}

func Newhub() {
	return &Hub{
		Client: make(map[Client]bool),
	}
}
