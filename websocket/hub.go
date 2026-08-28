package websocket

import "sync"

type Hub struct {
	Mu sync.Mutex
	Clients map[*Client]bool
}

func NewHub() *Hub 	{
	return &Hub{
		Clients: make(map[*Client]bool),
	}
}
