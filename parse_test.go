package main

import (
	"fmt"
	"strings"
	"unicode"
)

func parseRedisCommand(cmd string) []string {
	var args []string
	var current strings.Builder
	inQuotes := false
	var quoteChar rune

	runes := []rune(cmd)
	for i := 0; i < len(runes); i++ {
		r := runes[i]
		if inQuotes {
			if r == quoteChar {
				if i+1 < len(runes) && runes[i+1] == quoteChar {
					current.WriteRune(quoteChar)
					i++
				} else {
					inQuotes = false
				}
			} else {
				current.WriteRune(r)
			}
		} else {
			if unicode.IsSpace(r) {
				if current.Len() > 0 {
					args = append(args, current.String())
					current.Reset()
				}
			} else if r == '\'' || r == '"' {
				inQuotes = true
				quoteChar = r
			} else {
				current.WriteRune(r)
			}
		}
	}
	if current.Len() > 0 {
		args = append(args, current.String())
	}
	return args
}

func main() {
	fmt.Printf("%q\n", parseRedisCommand(`SET mykey "Hello World"`))
	fmt.Printf("%q\n", parseRedisCommand(`HSET user:1 name 'John Doe' age 30`))
}
